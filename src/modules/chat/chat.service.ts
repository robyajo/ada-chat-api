import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PatuihService } from '../patuih/patuih.service';
import { RedisService } from '../redis/redis.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { WsEventPayload } from '../patuih/patuih.interface';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private prisma: PrismaService,
    private patuihService: PatuihService,
    private redisService: RedisService,
    private eventEmitter: EventEmitter2,
  ) {}

  // ── Send Message ──

  async publishMessage(
    roomId: string,
    data: {
      text: string;
      id: string;
      sender: string;
      timestamp: string;
      type?: string;
      replyToId?: string;
    },
  ): Promise<void> {
    const msgType = data.type || 'text';

    await this.patuihService
      .publish(roomId, 'chat.message', {
        text: data.text,
        sender: data.sender,
        id: data.id,
        timestamp: data.timestamp,
        type: msgType,
        replyToId: data.replyToId || null,
      })
      .catch(() => {});

    const msg = await this.prisma.message
      .create({
        data: {
          msgId: data.id,
          roomId,
          sender: data.sender,
          text: data.text,
          type: msgType,
          replyToId: data.replyToId || null,
          createdAt: new Date(data.timestamp),
        },
      })
      .catch((err) => {
        this.logger.error(`Failed to save message: ${err.message}`);
        return null;
      });

    if (msg) {
      await this.trackRecentConversation(data.sender, roomId, 'room', data.text);

      const roomMembers = await this.prisma.roomMember.findMany({
        where: { roomId },
        select: { userId: true },
      });

      for (const member of roomMembers) {
        if (member.userId !== data.sender) {
          await this.prisma.messageStatus.create({
            data: {
              messageId: msg!.id,
              roomId,
              userId: member.userId,
              status: 'sent',
            },
          }).catch(() => {});
        }
      }
    }
  }

  async getMessages(roomId: string, limit = 50, before?: string) {
    const where: any = { roomId, deletedAt: null };
    if (before) {
      where.createdAt = { lt: new Date(before) };
    }
    const messages = await this.prisma.message.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: {
        replyTo: {
          select: { id: true, msgId: true, text: true, sender: true, type: true },
        },
        attachments: {
          select: {
            id: true, fileName: true, fileSize: true, mimeType: true,
            url: true, width: true, height: true, duration: true,
          },
        },
        reactions: {
          select: { emoji: true, userId: true, createdAt: true },
        },
        statuses: {
          select: { userId: true, status: true, createdAt: true },
        },
      },
    });

    return messages.reverse();
  }

  // ── Delivery Receipt ──

  async markDelivered(msgId: string, userId: string): Promise<void> {
    const msg = await this.prisma.message.findFirst({ where: { msgId } });
    if (!msg) return;
    const status = await this.prisma.messageStatus.findUnique({
      where: { messageId_userId: { messageId: msg.id, userId } },
    });
    if (status && status.status === 'sent') {
      await this.prisma.messageStatus.update({
        where: { messageId_userId: { messageId: msg.id, userId } },
        data: { status: 'delivered' },
      });
    }
  }

  // ── Read Receipt ──

  async markRead(msgId: string, userId: string): Promise<void> {
    const msg = await this.prisma.message.findFirst({ where: { msgId } });
    if (!msg) return;
    await this.prisma.messageStatus.upsert({
      where: { messageId_userId: { messageId: msg.id, userId } },
      update: { status: 'read' },
      create: { messageId: msg.id, roomId: msg.roomId, userId, status: 'read' },
    });
  }

  async markRoomRead(roomId: string, userId: string): Promise<number> {
    const result = await this.prisma.messageStatus.updateMany({
      where: {
        roomId,
        userId,
        status: { in: ['sent', 'delivered'] },
      },
      data: { status: 'read' },
    });
    return result.count;
  }

  async getMessageStatus(msgId: string): Promise<{
    sent: number;
    delivered: number;
    read: number;
    total: number;
  }> {
    const messages = await this.prisma.message.findMany({ where: { msgId } });
    const ids = messages.map((m) => m.id);
    const statuses = await this.prisma.messageStatus.findMany({
      where: { messageId: { in: ids } },
    });
    return {
      sent: statuses.filter((s) => s.status === 'sent').length,
      delivered: statuses.filter((s) => s.status === 'delivered').length,
      read: statuses.filter((s) => s.status === 'read').length,
      total: statuses.length,
    };
  }

  // ── Message Edit ──

  async editMessage(
    userId: string,
    msgId: string,
    newText: string,
  ): Promise<{ message: string }> {
    const msg = await this.prisma.message.findFirst({ where: { msgId } });
    if (!msg) throw new NotFoundException('Message not found');
    if (msg.sender !== userId) throw new ForbiddenException('You can only edit your own messages');
    if (msg.deletedAt) throw new BadRequestException('Cannot edit a deleted message');

    await this.prisma.message.update({
      where: { id: msg.id },
      data: { text: newText, editedAt: new Date() },
    });

    await this.patuihService
      .publish(msg.roomId, 'chat.edited', {
        id: msgId,
        text: newText,
        editedAt: new Date().toISOString(),
      })
      .catch(() => {});

    return { message: 'Message edited' };
  }

  // ── Message Delete ──

  async deleteMessage(
    userId: string,
    msgId: string,
    mode: 'soft' | 'hard' = 'soft',
  ): Promise<{ message: string }> {
    const msg = await this.prisma.message.findFirst({ where: { msgId } });
    if (!msg) throw new NotFoundException('Message not found');

    const roomMember = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId: msg.roomId, userId } },
    });
    const isOwner = roomMember?.role === 'owner';

    if (msg.sender !== userId && !isOwner) {
      throw new ForbiddenException('Only the sender or room owner can delete messages');
    }

    if (mode === 'hard') {
      await this.prisma.message.delete({ where: { id: msg.id } });
    } else {
      await this.prisma.message.update({
        where: { id: msg.id },
        data: { text: '[message deleted]', deletedAt: new Date() },
      });
    }

    await this.patuihService
      .publish(msg.roomId, 'chat.deleted', {
        id: msgId,
        mode,
      })
      .catch(() => {});

    return { message: 'Message deleted' };
  }

  // ── Message Reactions ──

  async toggleReaction(
    userId: string,
    msgId: string,
    emoji: string,
  ): Promise<{ message: string; active: boolean }> {
    const msg = await this.prisma.message.findFirst({ where: { msgId } });
    if (!msg) throw new NotFoundException('Message not found');

    const existing = await this.prisma.messageReaction.findUnique({
      where: { messageId_userId_emoji: { messageId: msg.id, userId, emoji } },
    });

    if (existing) {
      await this.prisma.messageReaction.delete({ where: { id: existing.id } });
      return { message: 'Reaction removed', active: false };
    }

    await this.prisma.messageReaction.create({
      data: { messageId: msg.id, userId, emoji },
    });

    await this.patuihService
      .publish(msg.roomId, 'chat.reaction', {
        id: msgId,
        userId,
        emoji,
        active: true,
      })
      .catch(() => {});

    return { message: 'Reaction added', active: true };
  }

  // ── Attachments ──

  async saveAttachment(data: {
    msgId: string;
    roomId: string;
    sender: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    url: string;
    width?: number;
    height?: number;
    duration?: number;
  }): Promise<void> {
    const msg = await this.prisma.message.findFirst({ where: { msgId: data.msgId } });
    if (!msg) {
      this.logger.warn(`Message not found for attachment: ${data.msgId}`);
      return;
    }
    await this.prisma.attachment.create({
      data: {
        messageId: msg.id,
        roomId: data.roomId,
        sender: data.sender,
        fileName: data.fileName,
        fileSize: data.fileSize,
        mimeType: data.mimeType,
        url: data.url,
        width: data.width,
        height: data.height,
        duration: data.duration,
      },
    });
  }

  async getAttachments(roomId: string, type?: string) {
    const where: any = { roomId };
    if (type) {
      if (type === 'image') where.mimeType = { startsWith: 'image/' };
      else if (type === 'audio') where.mimeType = { startsWith: 'audio/' };
      else if (type === 'video') where.mimeType = { startsWith: 'video/' };
    }
    return this.prisma.attachment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  // ── User Settings ──

  async getUserSettings(userId: string) {
    let settings = await this.prisma.userSetting.findUnique({
      where: { userId },
    });
    if (!settings) {
      settings = await this.prisma.userSetting.create({
        data: { userId },
      });
    }
    return settings;
  }

  async updateUserSettings(
    userId: string,
    data: Partial<{
      theme: string;
      language: string;
      notificationEnabled: boolean;
      messagePreview: boolean;
      readReceipt: boolean;
      typingIndicator: boolean;
    }>,
  ) {
    await this.prisma.userSetting.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    });
    return { message: 'Settings updated' };
  }

  // ── Recent Conversations ──

  private async trackRecentConversation(
    userId: string,
    targetId: string,
    targetType: 'user' | 'room',
    lastMessage: string,
  ): Promise<void> {
    await this.prisma.recentConversation.upsert({
      where: {
        userId_targetId_targetType: { userId, targetId, targetType },
      },
      update: { lastMessage, lastActivity: new Date() },
      create: { userId, targetId, targetType, lastMessage },
    });
  }

  async getRecentConversations(userId: string) {
    return this.prisma.recentConversation.findMany({
      where: { userId },
      orderBy: { lastActivity: 'desc' },
      take: 20,
    });
  }

  // ── Last Room ──

  async setLastRoom(userId: string, roomId: string): Promise<void> {
    await this.prisma.userLastRoom.upsert({
      where: { userId },
      update: { roomId },
      create: { userId, roomId },
    });
  }

  async getLastRoom(userId: string): Promise<string | null> {
    const entry = await this.prisma.userLastRoom.findUnique({
      where: { userId },
    });
    return entry?.roomId || null;
  }

  // ── Publish / Subscribe Events ──

  async publishEvent(
    roomId: string,
    event: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    return this.patuihService.publish(roomId, event, data);
  }

  onPatuihEvent(
    channel: string,
    callback: (payload: WsEventPayload) => void,
  ): () => void {
    const handler = (payload: WsEventPayload) => {
      if (payload.channel === channel) {
        callback(payload);
      }
    };
    this.eventEmitter.on(`patuih.event.${channel}`, handler);
    return () => this.eventEmitter.off(`patuih.event.${channel}`, handler);
  }

  // ── Room Management ──

  async createRoom(
    userId: string,
    name: string,
    roomId: string,
    avatarUrl?: string,
  ) {
    const existing = await this.prisma.room.findUnique({ where: { roomId } });
    if (existing) throw new ConflictException('Room ID already exists');

    const room = await this.prisma.room.create({
      data: {
        name,
        roomId,
        avatarUrl: avatarUrl ?? null,
        ownerId: userId,
        members: {
          create: { userId, role: 'owner' },
        },
      },
    });

    this.logger.log(`Room ${roomId} created by user ${userId}`);
    return { id: room.id, name: room.name, roomId: room.roomId, ownerId: room.ownerId };
  }

  async listRooms(userId: string) {
    const memberships = await this.prisma.roomMember.findMany({
      where: { userId },
      include: {
        room: {
          include: {
            _count: { select: { members: true } },
          },
        },
      },
    });

    return memberships.map((m) => ({
      id: m.room.id,
      name: m.room.name,
      roomId: m.room.roomId,
      avatarUrl: m.room.avatarUrl,
      ownerId: m.room.ownerId,
      memberCount: m.room._count.members,
      isOwner: m.room.ownerId === userId,
    }));
  }

  async getRoom(userId: string, id: string) {
    const room = await this.prisma.room.findUnique({
      where: { id },
      include: {
        members: {
          include: {
            member: { select: { id: true, username: true, displayName: true, avatarUrl: true } },
          },
        },
      },
    });
    if (!room) throw new NotFoundException('Room not found');
    const isMember = room.members.some((m) => m.userId === userId);
    if (!isMember) throw new ForbiddenException('Not a member of this room');

    return {
      id: room.id,
      name: room.name,
      roomId: room.roomId,
      avatarUrl: room.avatarUrl,
      ownerId: room.ownerId,
      members: room.members.map((m) => ({
        id: m.member.id,
        username: m.member.username,
        displayName: m.member.displayName,
        avatarUrl: m.member.avatarUrl,
        role: m.role,
      })),
    };
  }

  async updateRoom(userId: string, id: string, dto: { name?: string; avatarUrl?: string }) {
    const room = await this.prisma.room.findUnique({ where: { id } });
    if (!room) throw new NotFoundException('Room not found');
    if (room.ownerId !== userId) throw new ForbiddenException('Only the room owner can update the room');
    await this.prisma.room.update({ where: { id }, data: { ...dto } });
    return { message: 'Room updated successfully' };
  }

  async deleteRoom(userId: string, id: string) {
    const room = await this.prisma.room.findUnique({ where: { id } });
    if (!room) throw new NotFoundException('Room not found');
    if (room.ownerId !== userId) throw new ForbiddenException('Only the room owner can delete the room');
    await this.prisma.room.delete({ where: { id } });
    return { message: 'Room deleted successfully' };
  }

  async joinRoom(userId: string, id: string) {
    const room = await this.prisma.room.findUnique({ where: { id } });
    if (!room) throw new NotFoundException('Room not found');
    const existing = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId: id, userId } },
    });
    if (existing) return { message: 'Already a member' };
    await this.prisma.roomMember.create({ data: { roomId: id, userId } });
    return { message: 'Joined room successfully' };
  }

  async leaveRoom(userId: string, id: string) {
    const room = await this.prisma.room.findUnique({ where: { id } });
    if (!room) throw new NotFoundException('Room not found');
    if (room.ownerId === userId) {
      throw new ForbiddenException('Owner cannot leave. Transfer ownership or delete the room.');
    }
    const membership = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId: id, userId } },
    });
    if (!membership) throw new NotFoundException('Not a member');
    await this.prisma.roomMember.delete({ where: { id: membership.id } });
    return { message: 'Left room successfully' };
  }

  async removeMember(userId: string, roomId: string, targetUserId: string) {
    const room = await this.prisma.room.findUnique({ where: { id: roomId } });
    if (!room) throw new NotFoundException('Room not found');
    if (room.ownerId !== userId) throw new ForbiddenException('Only the room owner can remove members');
    if (targetUserId === userId) throw new ForbiddenException('Cannot remove yourself. Use leave instead.');
    const membership = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId, userId: targetUserId } },
    });
    if (!membership) throw new NotFoundException('Member not found');
    await this.prisma.roomMember.delete({ where: { id: membership.id } });
    return { message: 'Member removed successfully' };
  }
}
