import {
  Controller,
  Post,
  Get,
  Patch,
  Delete,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ChatService } from './chat.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { z } from 'zod';
import type { JwtPayload } from '../../common/interfaces/app.interface';

const SavePatuihKeySchema = z.object({
  apiKey: z.string().min(1, 'API key is required'),
});

const PublishMessageSchema = z.object({
  roomId: z.string().min(1),
  text: z.string().min(1),
  id: z.string().min(1),
  sender: z.string().min(1),
  timestamp: z.string(),
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

@Controller('api/v1/chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('patuih-key')
  @HttpCode(HttpStatus.OK)
  async savePatuihKey(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(SavePatuihKeySchema))
    dto: { apiKey: string },
  ) {
    return this.chatService.savePatuihKey(user.sub, dto.apiKey);
  }

  @Get('patuih-key')
  async getPatuihKeyStatus(@CurrentUser() user: JwtPayload) {
    return this.chatService.getPatuihKeyStatus(user.sub);
  }

  @Delete('patuih-key')
  @HttpCode(HttpStatus.OK)
  async removePatuihKey(@CurrentUser() user: JwtPayload) {
    return this.chatService.removePatuihKey(user.sub);
  }

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
    },
  ) {
    await this.chatService.publishMessage(user.sub, dto.roomId, {
      text: dto.text,
      id: dto.id,
      sender: dto.sender,
      timestamp: dto.timestamp,
    });
    return { status: 'sent' };
  }

  // --- Room Management ---

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
}
