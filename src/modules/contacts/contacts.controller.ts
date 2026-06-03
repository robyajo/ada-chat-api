import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ContactsService } from './contacts.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe';
import { z } from 'zod';
import type { JwtPayload } from '../../common/interfaces/app.interface';

const InviteContactSchema = z.object({
  target: z.string().min(1, 'Target Username or PIN is required'),
});

@Controller('api/v1/contacts')
export class ContactsController {
  constructor(private readonly contactsService: ContactsService) {}

  @Post('invite')
  @HttpCode(HttpStatus.OK)
  async invite(
    @CurrentUser() user: JwtPayload,
    @Body(new ZodValidationPipe(InviteContactSchema)) dto: { target: string },
  ) {
    return this.contactsService.invite(user.sub, dto.target);
  }

  @Post('accept/:id')
  @HttpCode(HttpStatus.OK)
  async accept(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.contactsService.accept(user.sub, id);
  }

  @Post('reject/:id')
  @HttpCode(HttpStatus.OK)
  async reject(
    @CurrentUser() user: JwtPayload,
    @Param('id') id: string,
  ) {
    return this.contactsService.reject(user.sub, id);
  }

  @Get()
  async list(@CurrentUser() user: JwtPayload) {
    return this.contactsService.list(user.sub);
  }

  @Get('invites')
  async getInvites(@CurrentUser() user: JwtPayload) {
    return this.contactsService.getInvites(user.sub);
  }

  @Get('online')
  async getOnlineUsers() {
    const usernames = await this.contactsService.getOnlineUsernames();
    return { online: usernames };
  }
}
