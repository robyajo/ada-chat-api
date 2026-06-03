import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { MomentsService } from './moments.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { z } from 'zod';
import type { JwtPayload } from '../../common/interfaces/app.interface';

const CreateMomentSchema = z.object({
  content: z.string().min(1, 'Content is required').max(280),
  background: z.string().min(1, 'Theme background class is required'),
});

const AddCommentSchema = z.object({
  content: z.string().min(1, 'Comment text is required'),
});

@Controller('api/v1/moments')
export class MomentsController {
  constructor(private readonly momentsService: MomentsService) {}

  @Get()
  async getFeed(@CurrentUser() user: JwtPayload) {
    return this.momentsService.getFeed(user.sub);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(CreateMomentSchema))
    dto: { content: string; background: string },
  ) {
    return this.momentsService.create(user.sub, dto.content, dto.background);
  }

  @Post(':id/like')
  @HttpCode(HttpStatus.OK)
  async toggleLike(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.momentsService.toggleLike(user.sub, id);
  }

  @Post(':id/comments')
  @HttpCode(HttpStatus.CREATED)
  async addComment(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AddCommentSchema)) dto: { content: string },
  ) {
    return this.momentsService.addComment(user.sub, id, dto.content);
  }
}
