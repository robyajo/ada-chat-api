import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { ChatService } from './chat.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { z } from 'zod';
import type { JwtPayload } from '../../common/interfaces/app.interface';

const PublishMessageSchema = z.object({
  roomId: z.string().min(1),
  text: z.string().min(1),
  id: z.string().min(1),
  sender: z.string().min(1),
  timestamp: z.string(),
  type: z.string().optional(),
  replyToId: z.string().optional(),
});

const CreateRoomSchema = z.object({
  name: z.string().min(1, 'Room name is required').max(100),
  roomId: z.string().min(1).max(50),
  avatarUrl: z.string().optional(),
});

const UpdateRoomSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  avatarUrl: z.string().optional(),
});

const EditMessageSchema = z.object({
  text: z.string().min(1, 'Message text is required'),
});

const DeleteMessageSchema = z.object({
  mode: z.enum(['soft', 'hard']).optional().default('soft'),
});

const ReactionSchema = z.object({
  emoji: z.string().min(1).max(10),
});

const ReadReceiptSchema = z.object({
  msgId: z.string().min(1),
});

const UpdateSettingsSchema = z.object({
  theme: z.string().optional(),
  language: z.string().optional(),
  notificationEnabled: z.boolean().optional(),
  messagePreview: z.boolean().optional(),
  readReceipt: z.boolean().optional(),
  typingIndicator: z.boolean().optional(),
});

const uploadConfig = diskStorage({
  destination: './uploads/chat',
  filename: (_req, file, cb) => {
    const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}${extname(file.originalname)}`;
    cb(null, name);
  },
});

@Controller('api/v1/chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  // ── Messages ──

  @Post('publish')
  @HttpCode(HttpStatus.OK)
  async publishMessage(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(PublishMessageSchema))
    dto: {
      roomId: string;
      text: string;
      id: string;
      sender: string;
      timestamp: string;
      type?: string;
      replyToId?: string;
    },
  ) {
    await this.chatService.publishMessage(dto.roomId, dto);
    return { status: 'sent' };
  }

  @Get('messages/:roomId')
  async getMessages(
    @CurrentUser() user: JwtPayload,
    @Param('roomId') roomId: string,
    @Query('limit') limit?: string,
    @Query('before') before?: string,
  ) {
    return this.chatService.getMessages(
      roomId,
      limit ? parseInt(limit, 10) : 50,
      before,
    );
  }

  // ── Message Status / Receipts ──

  @Post('messages/read')
  @HttpCode(HttpStatus.OK)
  async markRead(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(ReadReceiptSchema)) dto: { msgId: string },
  ) {
    await this.chatService.markRead(dto.msgId, user.sub);
    return { status: 'read' };
  }

  @Post('rooms/:roomId/read')
  @HttpCode(HttpStatus.OK)
  async markRoomRead(
    @CurrentUser() user: JwtPayload,
    @Param('roomId') roomId: string,
  ) {
    const count = await this.chatService.markRoomRead(roomId, user.sub);
    return { status: 'read', count };
  }

  @Get('messages/:msgId/status')
  async getMessageStatus(@Param('msgId') msgId: string) {
    return this.chatService.getMessageStatus(msgId);
  }

  // ── Edit / Delete ──

  @Patch('messages/:msgId')
  @HttpCode(HttpStatus.OK)
  async editMessage(
    @CurrentUser() user: JwtPayload,
    @Param('msgId') msgId: string,
    @Body(new ZodValidationPipe(EditMessageSchema)) dto: { text: string },
  ) {
    return this.chatService.editMessage(user.sub, msgId, dto.text);
  }

  @Delete('messages/:msgId')
  @HttpCode(HttpStatus.OK)
  async deleteMessage(
    @CurrentUser() user: JwtPayload,
    @Param('msgId') msgId: string,
    @Query('mode') mode?: string,
  ) {
    return this.chatService.deleteMessage(
      user.sub,
      msgId,
      mode === 'hard' ? 'hard' : 'soft',
    );
  }

  // ── Reactions ──

  @Post('messages/:msgId/reactions')
  @HttpCode(HttpStatus.OK)
  async toggleReaction(
    @CurrentUser() user: JwtPayload,
    @Param('msgId') msgId: string,
    @Body(new ZodValidationPipe(ReactionSchema)) dto: { emoji: string },
  ) {
    return this.chatService.toggleReaction(user.sub, msgId, dto.emoji);
  }

  // ── Attachments ──

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: uploadConfig,
      limits: { fileSize: 50 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => {
        if (file.size > 50 * 1024 * 1024) {
          cb(new Error('File too large. Max 50MB'), false);
          return;
        }
        cb(null, true);
      },
    }),
  )
  async uploadFile(
    @CurrentUser() user: JwtPayload,
    @UploadedFile() file: Express.Multer.File,
    @Body('roomId') roomId: string,
    @Body('msgId') msgId: string,
  ) {
    if (!file) throw new Error('No file uploaded');
    if (!roomId) throw new Error('roomId is required');

    const url = `/uploads/chat/${file.filename}`;
    let width: number | undefined;
    let height: number | undefined;
    let duration: number | undefined;

    if (file.mimetype.startsWith('image/')) {
      const size = await this.getImageDimensions(file.path);
      width = size.width;
      height = size.height;
    }

    if (file.mimetype.startsWith('audio/')) {
      duration = 0;
    }

    await this.chatService.saveAttachment({
      msgId: msgId || `attach_${Date.now()}`,
      roomId,
      sender: user.sub,
      fileName: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
      url,
      width,
      height,
      duration,
    });

    const attachType = file.mimetype.startsWith('audio/') ? 'audio'
      : file.mimetype.startsWith('image/') ? 'image'
      : file.mimetype.startsWith('video/') ? 'video'
      : 'file';

    await this.chatService.publishEvent(roomId, 'chat.attachment', {
      url,
      fileName: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
      type: attachType,
      sender: user.sub,
      width,
      height,
      duration,
    });

    return {
      url,
      fileName: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
      width,
      height,
      duration,
    };
  }

  @Get('attachments/:roomId')
  async getAttachments(
    @Param('roomId') roomId: string,
    @Query('type') type?: string,
  ) {
    return this.chatService.getAttachments(roomId, type);
  }

  // ── User Settings ──

  @Get('settings')
  async getSettings(@CurrentUser() user: JwtPayload) {
    return this.chatService.getUserSettings(user.sub);
  }

  @Patch('settings')
  @HttpCode(HttpStatus.OK)
  async updateSettings(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(UpdateSettingsSchema))
    dto: Record<string, unknown>,
  ) {
    return this.chatService.updateUserSettings(user.sub, dto as any);
  }

  // ── Recent Conversations ──

  @Get('recent')
  async getRecentConversations(@CurrentUser() user: JwtPayload) {
    return this.chatService.getRecentConversations(user.sub);
  }

  // ── Last Room ──

  @Get('last-room')
  async getLastRoom(@CurrentUser() user: JwtPayload) {
    const roomId = await this.chatService.getLastRoom(user.sub);
    return { roomId };
  }

  @Post('last-room')
  @HttpCode(HttpStatus.OK)
  async setLastRoom(
    @CurrentUser() user: JwtPayload,
    @Body('roomId') roomId: string,
  ) {
    await this.chatService.setLastRoom(user.sub, roomId);
    return { status: 'ok' };
  }

  // ── Room Management ──

  @Post('rooms')
  @HttpCode(HttpStatus.CREATED)
  async createRoom(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(CreateRoomSchema))
    dto: { name: string; roomId: string; avatarUrl?: string },
  ) {
    return this.chatService.createRoom(user.sub, dto.name, dto.roomId, dto.avatarUrl);
  }

  @Get('rooms')
  async listRooms(@CurrentUser() user: JwtPayload) {
    return this.chatService.listRooms(user.sub);
  }

  @Get('rooms/:id')
  async getRoom(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.chatService.getRoom(user.sub, id);
  }

  @Patch('rooms/:id')
  @HttpCode(HttpStatus.OK)
  async updateRoom(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateRoomSchema))
    dto: { name?: string; avatarUrl?: string },
  ) {
    return this.chatService.updateRoom(user.sub, id, dto);
  }

  @Delete('rooms/:id')
  @HttpCode(HttpStatus.OK)
  async deleteRoom(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.chatService.deleteRoom(user.sub, id);
  }

  @Post('rooms/:id/join')
  @HttpCode(HttpStatus.OK)
  async joinRoom(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.chatService.joinRoom(user.sub, id);
  }

  @Post('rooms/:id/leave')
  @HttpCode(HttpStatus.OK)
  async leaveRoom(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.chatService.leaveRoom(user.sub, id);
  }

  @Delete('rooms/:roomId/members/:userId')
  @HttpCode(HttpStatus.OK)
  async removeMember(
    @CurrentUser() user: JwtPayload,
    @Param('roomId') roomId: string,
    @Param('userId') targetUserId: string,
  ) {
    return this.chatService.removeMember(user.sub, roomId, targetUserId);
  }

  // ── Helpers ──

  private async getImageDimensions(
    filePath: string,
  ): Promise<{ width: number | undefined; height: number | undefined }> {
    try {
      const sharp = require('sharp');
      const meta = await sharp(filePath).metadata();
      return { width: meta.width, height: meta.height };
    } catch {
      return { width: undefined, height: undefined };
    }
  }
}
