import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { Patuih } from 'patuih-sdk';
import { io as SocketIoClient, Socket } from 'socket.io-client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { WsEventPayload } from './patuih.interface';

interface PatuihInstance {
  getCredits(): Promise<{ tenantId?: string }>;
  publish(
    channel: string,
    event: string,
    data: Record<string, unknown>,
  ): Promise<void>;
}

function createPatuih(apiKey: string, baseUrl?: string): PatuihInstance {
  const config: Record<string, string> = { apiKey };
  if (baseUrl) config.baseUrl = baseUrl;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-call
  const instance: PatuihInstance = new (Patuih as any)(config);
  return instance;
}

@Injectable()
export class PatuihService {
  private readonly logger = new Logger(PatuihService.name);
  private readonly patuihUrl: string | undefined;
  private sockets = new Map<string, Socket>();

  constructor(private eventEmitter: EventEmitter2) {
    this.patuihUrl = process.env.PATUIH_URL || undefined;
  }

  private get baseUrl(): string {
    return this.patuihUrl ?? 'https://patuih-services.lapeh.web.id';
  }

  async validateApiKey(apiKey: string): Promise<{ tenantId: string }> {
    try {
      const patuih = createPatuih(apiKey, this.patuihUrl);
      const credits = await patuih.getCredits();
      const tenantId = credits.tenantId ?? '';
      if (!tenantId) {
        throw new UnauthorizedException('Invalid Patuih API key');
      }
      return { tenantId };
    } catch (err: unknown) {
      this.logger.error(
        `API key validation failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      throw new UnauthorizedException('Invalid Patuih API key');
    }
  }

  async publish(
    apiKey: string,
    channel: string,
    event: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const patuih = createPatuih(apiKey, this.patuihUrl);
    await patuih.publish(channel, event, data);
  }

  connectToGateway(tenantId: string): Socket {
    if (this.sockets.has(tenantId)) {
      return this.sockets.get(tenantId)!;
    }

    const socket = SocketIoClient(this.baseUrl, {
      query: { tenantId },
      transports: ['websocket', 'polling'],
    });

    socket.on('connect', () => {
      this.logger.log(`Connected to Patuih Gateway (tenant: ${tenantId})`);
    });

    socket.on('event', (payload: WsEventPayload) => {
      this.eventEmitter.emit(`patuih.event.${payload.channel}`, payload);
    });

    socket.on('disconnect', (reason) => {
      this.logger.warn(
        `Disconnected from Patuih Gateway (tenant: ${tenantId}): ${reason}`,
      );
      this.sockets.delete(tenantId);
    });

    socket.on('connect_error', (err) => {
      this.logger.error(
        `Connection error (tenant: ${tenantId}): ${err.message}`,
      );
    });

    this.sockets.set(tenantId, socket);
    return socket;
  }

  disconnectFromGateway(tenantId: string): void {
    const socket = this.sockets.get(tenantId);
    if (socket) {
      socket.disconnect();
      this.sockets.delete(tenantId);
    }
  }
}
