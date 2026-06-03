import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class MomentsService {
  constructor(private prisma: PrismaService) {}

  async create(
    userId: string,
    content: string,
    background: string,
  ) {
    const moment = await this.prisma.moment.create({
      data: {
        authorId: userId,
        content,
        background,
      },
      include: {
        author: {
          select: { username: true },
        },
      },
    });

    return {
      id: moment.id,
      author: moment.author.username,
      content: moment.content,
      background: moment.background,
      likes: 0,
      likedBy: [],
      comments: [],
      createdAt: moment.createdAt.toISOString(),
    };
  }

  async getFeed(userId: string) {
    // 1. Get user's accepted contacts
    const contacts = await this.prisma.contact.findMany({
      where: {
        OR: [
          { senderId: userId, status: 'ACCEPTED' },
          { receiverId: userId, status: 'ACCEPTED' },
        ],
      },
    });

    const friendIds = contacts.map((c) =>
      c.senderId === userId ? c.receiverId : c.senderId,
    );

    // 2. Fetch moments where author is user themselves or a friend
    const moments = await this.prisma.moment.findMany({
      where: {
        authorId: { in: [userId, ...friendIds] },
      },
      include: {
        author: {
          select: { username: true },
        },
        likes: {
          include: {
            user: { select: { username: true } },
          },
        },
        comments: {
          include: {
            author: { select: { username: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // 3. Map to frontend format
    return moments.map((m) => ({
      id: m.id,
      author: m.author.username,
      content: m.content,
      background: m.background,
      likes: m.likes.length,
      likedBy: m.likes.map((l) => l.user.username),
      comments: m.comments.map((c) => ({
        id: c.id,
        author: c.author.username,
        content: c.content,
        createdAt: c.createdAt.toISOString(),
      })),
      createdAt: m.createdAt.toISOString(),
    }));
  }

  async toggleLike(userId: string, momentId: string) {
    const moment = await this.prisma.moment.findUnique({
      where: { id: momentId },
    });
    if (!moment) throw new NotFoundException('Moment not found');

    // Verify visibility permission
    await this.verifyAccess(userId, moment.authorId);

    const existingLike = await this.prisma.momentLike.findUnique({
      where: {
        momentId_userId: { momentId, userId },
      },
    });

    if (existingLike) {
      await this.prisma.momentLike.delete({
        where: {
          momentId_userId: { momentId, userId },
        },
      });
      return { liked: false };
    } else {
      await this.prisma.momentLike.create({
        data: { momentId, userId },
      });
      return { liked: true };
    }
  }

  async addComment(userId: string, momentId: string, content: string) {
    const moment = await this.prisma.moment.findUnique({
      where: { id: momentId },
    });
    if (!moment) throw new NotFoundException('Moment not found');

    // Verify visibility permission
    await this.verifyAccess(userId, moment.authorId);

    const comment = await this.prisma.momentComment.create({
      data: {
        momentId,
        authorId: userId,
        content,
      },
      include: {
        author: {
          select: { username: true },
        },
      },
    });

    return {
      id: comment.id,
      author: comment.author.username,
      content: comment.content,
      createdAt: comment.createdAt.toISOString(),
    };
  }

  private async verifyAccess(userId: string, authorId: string): Promise<void> {
    if (userId === authorId) return;

    const contact = await this.prisma.contact.findFirst({
      where: {
        OR: [
          { senderId: userId, receiverId: authorId, status: 'ACCEPTED' },
          { senderId: authorId, receiverId: userId, status: 'ACCEPTED' },
        ],
      },
    });

    if (!contact) {
      throw new ForbiddenException(
        'You are not authorized to view or interact with this moment',
      );
    }
  }
}
