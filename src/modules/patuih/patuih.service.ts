import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Patuih } from 'patuih-sdk';
import { io as SocketIoClient, Socket } from 'socket.io-client';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../../prisma/prisma.service';
import type { WsEventPayload } from './patuih.interface';

interface PatuihInstance {
  publish(
    channel: string,
    event: string,
    data: Record<string, unknown>,
  ): Promise<void>;
}

@Injectable()
export class PatuihService implements OnModuleInit {
  private readonly logger = new Logger(PatuihService.name);
  private sockets = new Map<string, Socket>();
  private cachedApiKey: string | null = null;
  private cachedTenantId: string | null = null;

  constructor(
    private eventEmitter: EventEmitter2,
    private prisma: PrismaService,
  ) {}

  async onModuleInit() {
    await this.loadConfig();
    if (this.cachedTenantId) {
      this.connectToGateway(this.cachedTenantId);
    }
  }

  private async loadConfig() {
    try {
      const [apiKeyRow, tenantIdRow] = await Promise.all([
        this.prisma.appConfig.findUnique({ where: { key: 'patuih_system_api_key' } }),
        this.prisma.appConfig.findUnique({ where: { key: 'patuih_system_tenant_id' } }),
      ]);
      this.cachedApiKey = apiKeyRow?.value || process.env.PATUIH_SYSTEM_API_KEY || '';
      this.cachedTenantId = tenantIdRow?.value || process.env.PATUIH_SYSTEM_TENANT_ID || null;
    } catch {
      this.cachedApiKey = process.env.PATUIH_SYSTEM_API_KEY || '';
      this.cachedTenantId = process.env.PATUIH_SYSTEM_TENANT_ID || null;
    }
  }

  private createPatuih(): PatuihInstance {
    const apiKey = this.cachedApiKey ?? '';
    const config: Record<string, string> = { apiKey };
    const baseUrl = process.env.PATUIH_URL;
    if (baseUrl) config.baseUrl = baseUrl;
    // eslint-disable-next-line @typescript-eslint/no-unsafe-call
    return new (Patuih as any)(config);
  }

  private get baseUrl(): string {
    return process.env.PATUIH_URL || 'https://patuih-services.lapeh.web.id';
  }

  async publish(
    channel: string,
    event: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const patuih = this.createPatuih();
    await patuih.publish(channel, event, data);
  }

  async getSystemTenantId(): Promise<string> {
    if (this.cachedTenantId) return this.cachedTenantId;
    const patuih = this.createPatuih();
    const res = await (patuih as any).getCredits();
    const tenantId = res?.data?.tenantId || res?.tenantId || '';
    if (!tenantId) throw new Error('Failed to get tenant ID from Patuih');
    this.cachedTenantId = tenantId;
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

  getGatewayStatus(): {
    connected: boolean;
    tenants: string[];
    tenantCount: number;
  } {
    const tenants: string[] = [];
    for (const [tenantId, socket] of this.sockets.entries()) {
      if (socket.connected) tenants.push(tenantId);
    }
    return {
      connected: tenants.length > 0,
      tenants,
      tenantCount: tenants.length,
    };
  }
}
