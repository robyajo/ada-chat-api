import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  HttpCode,
  HttpStatus,
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
}
