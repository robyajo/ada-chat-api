import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
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

  async savePatuihKey(
    userId: string,
    apiKey: string,
  ): Promise<{ tenantId: string; message: string }> {
    const result = await this.patuihService.validateApiKey(apiKey);
    const tenantId = result.tenantId;

    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    await this.prisma.user.update({
      where: { id: userId },
      data: { patuihApiKey: apiKey, patuihTenantId: tenantId },
    });

    this.patuihService.connectToGateway(tenantId);

    this.logger.log(
      `User ${userId} saved Patuih API key (tenant: ${tenantId})`,
    );
    return { tenantId, message: 'Patuih API key saved successfully' };
  }

  async getPatuihKeyStatus(userId: string): Promise<{
    hasKey: boolean;
    tenantId: string | null;
  }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    return {
      hasKey: !!user.patuihApiKey,
      tenantId: user.patuihTenantId,
    };
  }

  async removePatuihKey(userId: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');

    if (user.patuihTenantId) {
      this.patuihService.disconnectFromGateway(user.patuihTenantId);
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { patuihApiKey: null, patuihTenantId: null },
    });

    return { message: 'Patuih API key removed' };
  }

  async publishMessage(
    userId: string,
    roomId: string,
    data: { text: string; id: string; sender: string; timestamp: string },
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.patuihApiKey) {
      throw new BadRequestException('Patuih API key not configured');
    }

    return this.patuihService.publish(
      user.patuihApiKey,
      roomId,
      'chat.message',
      {
        text: data.text,
        sender: data.sender,
        id: data.id,
        timestamp: data.timestamp,
      },
    );
  }

  async publishEvent(
    userId: string,
    roomId: string,
    event: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.patuihApiKey) {
      throw new BadRequestException('Patuih API key not configured');
    }

    return this.patuihService.publish(user.patuihApiKey, roomId, event, data);
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
}
