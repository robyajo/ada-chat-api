import { Injectable, Logger } from '@nestjs/common';
import { Patuih } from 'patuih-sdk';
import { io as SocketIoClient, Socket } from 'socket.io-client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import type { WsEventPayload } from './patuih.interface';

interface PatuihInstance {
  publish(
    channel: string,
    event: string,
    data: Record<string, unknown>,
  ): Promise<void>;
}

function createPatuih(): PatuihInstance {
  const apiKey = process.env.PATUIH_SYSTEM_API_KEY ?? '';
  const config: Record<string, string> = { apiKey };
  const baseUrl = process.env.PATUIH_URL;
  if (baseUrl) config.baseUrl = baseUrl;
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call
  const instance: PatuihInstance = new (Patuih as any)(config);
  return instance;
}

@Injectable()
export class PatuihService {
  private readonly logger = new Logger(PatuihService.name);
  private sockets = new Map<string, Socket>();

  constructor(private eventEmitter: EventEmitter2) {
    const tenantId = process.env.PATUIH_SYSTEM_TENANT_ID;
    if (tenantId) {
      this.connectToGateway(tenantId);
    }
  }

  private get baseUrl(): string {
    return process.env.PATUIH_URL || 'https://patuih-services.lapeh.web.id';
  }

  async publish(
    channel: string,
    event: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const patuih = createPatuih();
    await patuih.publish(channel, event, data);
  }

  async getSystemTenantId(): Promise<string> {
    const cached = process.env.PATUIH_SYSTEM_TENANT_ID;
    if (cached) return cached;
    const patuih = createPatuih();
    const res = await (patuih as any).getCredits();
    const tenantId = res?.data?.tenantId || res?.tenantId || '';
    if (!tenantId) throw new Error('Failed to get tenant ID from Patuih');
    return tenantId;
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
