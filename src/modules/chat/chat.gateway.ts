import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import { ChatService } from './chat.service';
import { RedisService } from '../redis/redis.service';
import { PatuihService } from '../patuih/patuih.service';
import type { WsEventPayload } from '../patuih/patuih.interface';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  username?: string;
  roomId?: string;
  tenantId?: string;
}

@WebSocketGateway({
  cors: {
    origin: [
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      process.env.CLIENT_URL,
    ].filter(Boolean) as string[],
    credentials: true,
  },
  namespace: '/chat',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ChatGateway.name);

  public static onlineUsers = new Map<string, string>();

  constructor(
    private chatService: ChatService,
    private redisService: RedisService,
    private patuihService: PatuihService,
  ) {}

  async handleConnection(client: AuthenticatedSocket) {
    const userId = client.handshake.auth?.userId as string | undefined;
    const username = client.handshake.auth?.username as string | undefined;
    let tenantId = client.handshake.auth?.tenantId as string | undefined;

    if (!userId) {
      client.emit('error', { message: 'Authentication required: userId' });
      client.disconnect();
      return;
    }

    if (
      !tenantId ||
      tenantId === 'system' ||
      tenantId === 'null' ||
      tenantId === 'undefined'
    ) {
      tenantId = 'system';
    }

    client.userId = userId;
    client.username = username ?? 'Anonymous';
    client.tenantId = tenantId;

    ChatGateway.onlineUsers.set(userId, client.username);

    // Redis: online + socket mapping
    await this.redisService.setOnline(userId, client.id).catch(() => {});
    await this.redisService.mapSocket(userId, client.id).catch(() => {});
    await this.redisService.mapUserToSocket(client.id, userId).catch(() => {});

    const systemTenantId = await this.patuihService.getSystemTenantId();
    this.patuihService.connectToGateway(systemTenantId);

    void client.join(`user_${userId}`);
    void client.join(`presence_${systemTenantId}`);

    const cleanupUserEvents = this.chatService.onPatuihEvent(
      `user_${userId}`,
      (payload: WsEventPayload) => {
        client.emit('notification', payload);
      },
    );

    const cleanupPresenceEvents = this.chatService.onPatuihEvent(
      `presence_${systemTenantId}`,
      (payload: WsEventPayload) => {
        client.emit('presence', payload);
      },
    );

    (client as any).cleanupFns = [cleanupUserEvents, cleanupPresenceEvents];

    void this.chatService
      .publishEvent(`presence_${systemTenantId}`, 'presence.online', {
        userId,
        username: client.username,
      })
      .catch(() => {});

    this.logger.log(`Client connected: ${userId} (${client.username})`);
  }

  async handleDisconnect(client: AuthenticatedSocket) {
    if (client.userId) {
      ChatGateway.onlineUsers.delete(client.userId);

      await this.redisService.setOffline(client.userId).catch(() => {});
      await this.redisService.setLastSeen(client.userId).catch(() => {});
      await this.redisService.removeSocket(client.id).catch(() => {});

      const systemTenantId = await this.patuihService.getSystemTenantId();
      void this.chatService
        .publishEvent(`presence_${systemTenantId}`, 'presence.offline', {
          userId: client.userId,
          username: client.username,
        })
        .catch(() => {});
    }

    const cleanupFns = (client as any).cleanupFns;
    if (cleanupFns && Array.isArray(cleanupFns)) {
      cleanupFns.forEach((fn: () => void) => fn());
    }

    if ((client as any).roomCleanupFn) {
      (client as any).roomCleanupFn();
    }

    this.logger.log(`Client disconnected: ${client.userId}`);
  }

  @SubscribeMessage('join-room')
  async handleJoinRoom(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string; username: string },
  ) {
    const { roomId, username } = data;
    if (!roomId) {
      client.emit('error', { message: 'roomId is required' });
      return;
    }

    if ((client as any).roomCleanupFn) {
      (client as any).roomCleanupFn();
      (client as any).roomCleanupFn = null;
    }

    client.roomId = roomId;
    void client.join(roomId);
    client.username = username ?? client.username;

    await this.chatService.setLastRoom(client.userId!, roomId).catch(() => {});

    this.logger.log(`${client.username} joined room ${roomId}`);

    void this.chatService
      .publishEvent(roomId, 'chat.join', {
        username: client.username,
      })
      .catch((err: Error) => {
        this.logger.error(`Failed to publish join event: ${err.message}`);
      });

    const cleanup = this.chatService.onPatuihEvent(
      roomId,
      (payload: WsEventPayload) => {
        client.emit('event', payload);
      },
    );

    (client as any).roomCleanupFn = cleanup;
  }

  @SubscribeMessage('send-message')
  async handleSendMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody()
    data: {
      text: string;
      id: string;
      sender: string;
      timestamp: string;
      type?: string;
      replyToId?: string;
    },
  ) {
    const roomId = client.roomId;
    const userId = client.userId;

    if (!roomId || !userId) {
      client.emit('error', { message: 'Join a room first' });
      return;
    }

    try {
      await this.chatService.publishMessage(roomId, data);
    } catch (err) {
      this.logger.error(`Failed to send message: ${err}`);
      client.emit('error', { message: 'Failed to send message' });
    }
  }

  @SubscribeMessage('typing')
  async handleTyping(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { isTyping: boolean },
  ) {
    const roomId = client.roomId;
    const userId = client.userId;

    if (!roomId || !userId) return;

    try {
      if (data.isTyping) {
        await this.redisService.setTyping(roomId, userId, client.username!);
      } else {
        await this.redisService.clearTyping(roomId, userId);
      }

      await this.chatService.publishEvent(roomId, 'chat.typing', {
        username: client.username,
        isTyping: data.isTyping,
      });
    } catch {
      // silently fail
    }
  }

  @SubscribeMessage('leave-room')
  async handleLeaveRoom(@ConnectedSocket() client: AuthenticatedSocket) {
    const roomId = client.roomId;
    const userId = client.userId;

    if ((client as any).roomCleanupFn) {
      (client as any).roomCleanupFn();
      (client as any).roomCleanupFn = null;
    }

    if (roomId && userId) {
      try {
        await this.chatService.publishEvent(roomId, 'chat.leave', {
          username: client.username,
        });
      } catch {
        // silently fail
      }
    }

    if (roomId) {
      void client.leave(roomId);
      client.roomId = undefined;
    }
  }

  // ── New WS Events ──

  @SubscribeMessage('message-delivered')
  async handleMessageDelivered(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { msgId: string },
  ) {
    if (!client.userId || !data.msgId) return;
    await this.chatService.markDelivered(data.msgId, client.userId);

    this.server
      .to(client.roomId!)
      .emit('event', {
        channel: client.roomId,
        event: 'message.delivered',
        data: { msgId: data.msgId, userId: client.userId },
        timestamp: new Date().toISOString(),
      } as any);
  }

  @SubscribeMessage('message-read')
  async handleMessageRead(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { msgId: string },
  ) {
    if (!client.userId || !data.msgId) return;
    await this.chatService.markRead(data.msgId, client.userId);

    this.server
      .to(client.roomId!)
      .emit('event', {
        channel: client.roomId,
        event: 'message.read',
        data: { msgId: data.msgId, userId: client.userId },
        timestamp: new Date().toISOString(),
      } as any);
  }

  @SubscribeMessage('message-edit')
  async handleMessageEdit(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { msgId: string; text: string },
  ) {
    if (!client.userId || !data.msgId) return;
    try {
      await this.chatService.editMessage(client.userId, data.msgId, data.text);
    } catch (err: any) {
      client.emit('error', { message: err.message });
    }
  }

  @SubscribeMessage('message-delete')
  async handleMessageDelete(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { msgId: string; mode?: 'soft' | 'hard' },
  ) {
    if (!client.userId || !data.msgId) return;
    try {
      await this.chatService.deleteMessage(
        client.userId,
        data.msgId,
        data.mode || 'soft',
      );
    } catch (err: any) {
      client.emit('error', { message: err.message });
    }
  }

  @SubscribeMessage('message-reaction')
  async handleMessageReaction(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { msgId: string; emoji: string },
  ) {
    if (!client.userId || !data.msgId) return;
    try {
      await this.chatService.toggleReaction(
        client.userId,
        data.msgId,
        data.emoji,
      );
    } catch (err: any) {
      client.emit('error', { message: err.message });
    }
  }
}
