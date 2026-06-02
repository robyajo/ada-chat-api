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
import { PatuihService } from '../patuih/patuih.service';
import type { WsEventPayload } from '../patuih/patuih.interface';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  username?: string;
  roomId?: string;
  tenantId?: string;
}

@WebSocketGateway({
  cors: { origin: '*', credentials: true },
  namespace: '/chat',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ChatGateway.name);

  constructor(
    private chatService: ChatService,
    private patuihService: PatuihService,
  ) {}

  handleConnection(client: AuthenticatedSocket) {
    const userId = client.handshake.auth?.userId as string | undefined;
    const username = client.handshake.auth?.username as string | undefined;
    const tenantId = client.handshake.auth?.tenantId as string | undefined;

    if (!userId || !tenantId) {
      client.emit('error', 'Authentication required: userId and tenantId');
      client.disconnect();
      return;
    }

    client.userId = userId;
    client.username = username ?? 'Anonymous';
    client.tenantId = tenantId;

    this.patuihService.connectToGateway(tenantId);

    this.logger.log(`Client connected: ${userId} (${client.username})`);
  }

  handleDisconnect(client: AuthenticatedSocket) {
    this.logger.log(`Client disconnected: ${client.userId}`);
  }

  @SubscribeMessage('join-room')
  handleJoinRoom(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { roomId: string; username: string },
  ) {
    const { roomId, username } = data;
    if (!roomId) {
      client.emit('error', 'roomId is required');
      return;
    }

    client.roomId = roomId;
    void client.join(roomId);
    client.username = username ?? client.username;

    this.logger.log(`${client.username} joined room ${roomId}`);

    const userId = client.userId!;

    void this.chatService
      .publishEvent(userId, roomId, 'chat.join', {
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

    client.on('disconnect', () => {
      cleanup();
    });
  }

  @SubscribeMessage('send-message')
  async handleSendMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody()
    data: { text: string; id: string; sender: string; timestamp: string },
  ) {
    const roomId = client.roomId;
    const userId = client.userId;

    if (!roomId || !userId) {
      client.emit('error', 'Join a room first');
      return;
    }

    try {
      await this.chatService.publishMessage(userId, roomId, data);
    } catch (err) {
      this.logger.error(`Failed to send message: ${err}`);
      client.emit('error', 'Failed to send message');
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
      await this.chatService.publishEvent(userId, roomId, 'chat.typing', {
        username: client.username,
        isTyping: data.isTyping,
      });
    } catch {
      // silently fail for typing events
    }
  }

  @SubscribeMessage('leave-room')
  async handleLeaveRoom(@ConnectedSocket() client: AuthenticatedSocket) {
    const roomId = client.roomId;
    const userId = client.userId;

    if (roomId && userId) {
      try {
        await this.chatService.publishEvent(userId, roomId, 'chat.leave', {
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
}
