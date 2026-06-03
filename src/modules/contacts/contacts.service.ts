import {
  Injectable,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ChatGateway } from '../chat/chat.gateway';
import { ChatService } from '../chat/chat.service';

@Injectable()
export class ContactsService {
  constructor(
    private prisma: PrismaService,
    private chatService: ChatService,
  ) {}

  async invite(
    userId: string,
    targetUsernameOrPin: string,
  ): Promise<{ message: string; contactId: string }> {
    // 1. Find current user's profile
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!currentUser) throw new NotFoundException('User not found');

    // 2. Find target user by username or PIN
    const targetUser = await this.prisma.user.findFirst({
      where: {
        OR: [
          { username: { equals: targetUsernameOrPin, mode: 'insensitive' } },
          { pin: { equals: targetUsernameOrPin, mode: 'insensitive' } },
        ],
      },
    });

    if (!targetUser) {
      throw new NotFoundException('Target user not found');
    }

    if (targetUser.id === userId) {
      throw new BadRequestException('You cannot invite yourself');
    }

    // 3. Check existing connection (both directions)
    const existing = await this.prisma.contact.findFirst({
      where: {
        OR: [
          { senderId: userId, receiverId: targetUser.id },
          { senderId: targetUser.id, receiverId: userId },
        ],
      },
    });

    if (existing) {
      if (existing.status === 'ACCEPTED') {
        throw new ConflictException('You are already contacts with this user');
      } else if (existing.senderId === userId) {
        throw new ConflictException('You have already sent a pending invitation to this user');
      } else {
        throw new ConflictException('This user has already sent you a pending invitation');
      }
    }

    // 4. Create contact
    const contact = await this.prisma.contact.create({
      data: {
        senderId: userId,
        receiverId: targetUser.id,
        status: 'PENDING',
      },
    });

    // 5. Send real-time notification to target user via Patuih
    try {
      await this.chatService.publishEvent(
        `user_${targetUser.id}`,
        'contact.invite',
        {
          id: contact.id,
          sender: {
            id: currentUser.id,
            username: currentUser.username,
            displayName: currentUser.displayName,
            avatarUrl: currentUser.avatarUrl,
          },
        },
      );
    } catch (err) {
      // Log error but don't fail transaction
    }

    return {
      message: 'Invitation sent successfully',
      contactId: contact.id,
    };
  }

  async accept(userId: string, contactId: string): Promise<{ message: string }> {
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (!currentUser) throw new NotFoundException('User not found');

    const contact = await this.prisma.contact.findUnique({
      where: { id: contactId },
      include: { sender: true },
    });

    if (!contact) throw new NotFoundException('Invitation not found');
    if (contact.receiverId !== userId) {
      throw new BadRequestException('You can only accept invitations sent to you');
    }

    if (contact.status === 'ACCEPTED') {
      return { message: 'Invitation already accepted' };
    }

    await this.prisma.contact.update({
      where: { id: contactId },
      data: { status: 'ACCEPTED' },
    });

    // Notify sender that B accepted their invite
    try {
      await this.chatService.publishEvent(
        `user_${contact.senderId}`,
        'contact.accepted',
        {
          id: contactId,
          receiver: {
            id: currentUser.id,
            username: currentUser.username,
            displayName: currentUser.displayName,
            avatarUrl: currentUser.avatarUrl,
          },
        },
      );
    } catch (err) {
      // ignore
    }

    return { message: 'Invitation accepted successfully' };
  }

  async reject(userId: string, contactId: string): Promise<{ message: string }> {
    const contact = await this.prisma.contact.findUnique({
      where: { id: contactId },
    });

    if (!contact) throw new NotFoundException('Invitation not found');
    if (contact.senderId !== userId && contact.receiverId !== userId) {
      throw new BadRequestException('You do not have permission to manage this contact connection');
    }

    // Delete request
    await this.prisma.contact.delete({
      where: { id: contactId },
    });

    const otherUserId = contact.senderId === userId ? contact.receiverId : contact.senderId;

    // Notify other user
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
    });
    if (currentUser) {
      try {
        await this.chatService.publishEvent(
          `user_${otherUserId}`,
          'contact.deleted',
          {
            contactId,
            deletedBy: currentUser.username,
          },
        );
      } catch (err) {
        // ignore
      }
    }

    return { message: 'Contact connection removed' };
  }

  async list(userId: string) {
    const contacts = await this.prisma.contact.findMany({
      where: {
        OR: [
          { senderId: userId, status: 'ACCEPTED' },
          { receiverId: userId, status: 'ACCEPTED' },
        ],
      },
      include: {
        sender: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
        receiver: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
      },
    });

    return contacts.map((c) => {
      const isSender = c.senderId === userId;
      return isSender ? c.receiver : c.sender;
    });
  }

  async getInvites(userId: string) {
    const received = await this.prisma.contact.findMany({
      where: { receiverId: userId, status: 'PENDING' },
      include: {
        sender: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
      },
    });

    const sent = await this.prisma.contact.findMany({
      where: { senderId: userId, status: 'PENDING' },
      include: {
        receiver: {
          select: { id: true, username: true, displayName: true, avatarUrl: true },
        },
      },
    });

    return {
      received: received.map((r) => ({
        id: r.id,
        createdAt: r.createdAt,
        sender: r.sender,
      })),
      sent: sent.map((s) => ({
        id: s.id,
        createdAt: s.createdAt,
        receiver: s.receiver,
      })),
    };
  }

  async getOnlineUsernames(): Promise<string[]> {
    return Array.from(ChatGateway.onlineUsers.values());
  }
}
