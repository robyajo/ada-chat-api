import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PatuihService } from '../patuih/patuih.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { WsEventPayload } from '../patuih/patuih.interface';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private prisma: PrismaService,
    private patuihService: PatuihService,
    private eventEmitter: EventEmitter2,
  ) {}

  async publishMessage(
    roomId: string,
    data: { text: string; id: string; sender: string; timestamp: string },
  ): Promise<void> {
    await this.patuihService.publish(roomId, 'chat.message', {
      text: data.text,
      sender: data.sender,
      id: data.id,
      timestamp: data.timestamp,
    }).catch(() => {});
    // Persist to database
    await this.prisma.message.create({
      data: {
        msgId: data.id,
        roomId,
        sender: data.sender,
        text: data.text,
        type: 'text',
        createdAt: new Date(data.timestamp),
      },
    }).catch((err) => this.logger.error(`Failed to save message: ${err.message}`));
  }

  async getMessages(
    roomId: string,
    limit = 50,
    before?: string,
  ) {
    const where: any = { roomId };
    if (before) {
      where.createdAt = { lt: new Date(before) };
    }
    const messages = await this.prisma.message.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return messages.reverse();
  }

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

  // --- Room Management ---

  async createRoom(
    userId: string,
    name: string,
    roomId: string,
    avatarUrl?: string,
  ): Promise<{
    id: string;
    name: string;
    roomId: string;
    ownerId: string;
  }> {
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

  async listRooms(userId: string): Promise<Array<{
    id: string;
    name: string;
    roomId: string;
    avatarUrl: string | null;
    ownerId: string;
    memberCount: number;
    isOwner: boolean;
  }>> {
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

  async getRoom(userId: string, id: string): Promise<{
    id: string;
    name: string;
    roomId: string;
    avatarUrl: string | null;
    ownerId: string;
    members: Array<{ id: string; username: string; displayName: string | null; avatarUrl: string | null; role: string }>;
  }> {
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

  async updateRoom(
    userId: string,
    id: string,
    dto: { name?: string; avatarUrl?: string },
  ): Promise<{ message: string }> {
    const room = await this.prisma.room.findUnique({ where: { id } });
    if (!room) throw new NotFoundException('Room not found');
    if (room.ownerId !== userId) throw new ForbiddenException('Only the room owner can update the room');
    await this.prisma.room.update({ where: { id }, data: { ...dto } });
    return { message: 'Room updated successfully' };
  }

  async deleteRoom(userId: string, id: string): Promise<{ message: string }> {
    const room = await this.prisma.room.findUnique({ where: { id } });
    if (!room) throw new NotFoundException('Room not found');
    if (room.ownerId !== userId) throw new ForbiddenException('Only the room owner can delete the room');
    await this.prisma.room.delete({ where: { id } });
    return { message: 'Room deleted successfully' };
  }

  async joinRoom(userId: string, id: string): Promise<{ message: string }> {
    const room = await this.prisma.room.findUnique({ where: { id } });
    if (!room) throw new NotFoundException('Room not found');
    const existing = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId: id, userId } },
    });
    if (existing) return { message: 'Already a member' };
    await this.prisma.roomMember.create({ data: { roomId: id, userId } });
    return { message: 'Joined room successfully' };
  }

  async leaveRoom(userId: string, id: string): Promise<{ message: string }> {
    const room = await this.prisma.room.findUnique({ where: { id } });
    if (!room) throw new NotFoundException('Room not found');
    if (room.ownerId === userId) throw new ForbiddenException('Owner cannot leave. Transfer ownership or delete the room.');
    const membership = await this.prisma.roomMember.findUnique({
      where: { roomId_userId: { roomId: id, userId } },
    });
    if (!membership) throw new NotFoundException('Not a member');
    await this.prisma.roomMember.delete({ where: { id: membership.id } });
    return { message: 'Left room successfully' };
  }

  async removeMember(userId: string, roomId: string, targetUserId: string): Promise<{ message: string }> {
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
