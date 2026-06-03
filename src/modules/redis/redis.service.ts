import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  private readonly redis: Redis;

  constructor(configService: ConfigService) {
    const url = configService.get<string>('REDIS_URL') || 'redis://localhost:6379';
    this.redis = new Redis(url, {
      lazyConnect: true,
      retryStrategy: (times) => Math.min(times * 50, 2000),
    });

    this.redis.on('connect', () => this.logger.log('Connected to Redis'));
    this.redis.on('error', (err) => this.logger.error(`Redis error: ${err.message}`));
  }

  async onModuleInit() {
    try {
      await this.redis.connect();
    } catch {
      this.logger.warn('Redis not available — running without cache');
    }
  }

  async onModuleDestroy() {
    await this.redis.quit().catch(() => {});
  }

  // ── Online Users ──
  async setOnline(userId: string, socketId: string): Promise<void> {
    await this.redis.sadd('online:users', userId);
    await this.redis.set(`socket:${userId}`, socketId, 'EX', 300);
    await this.redis.set(`online:${userId}`, '1', 'EX', 300);
  }

  async setOffline(userId: string): Promise<void> {
    await this.redis.srem('online:users', userId);
    await this.redis.del(`socket:${userId}`);
    await this.redis.del(`online:${userId}`);
  }

  async isOnline(userId: string): Promise<boolean> {
    const exists = await this.redis.exists(`online:${userId}`);
    return exists === 1;
  }

  async getOnlineUsers(): Promise<string[]> {
    return this.redis.smembers('online:users');
  }

  async getSocketId(userId: string): Promise<string | null> {
    return this.redis.get(`socket:${userId}`);
  }

  // ── Last Seen ──
  async setLastSeen(userId: string): Promise<void> {
    await this.redis.set(`lastseen:${userId}`, Date.now().toString(), 'EX', 86400);
  }

  async getLastSeen(userId: string): Promise<number | null> {
    const val = await this.redis.get(`lastseen:${userId}`);
    return val ? parseInt(val, 10) : null;
  }

  // ── Typing Indicator ──
  async setTyping(roomId: string, userId: string, username: string): Promise<void> {
    await this.redis.set(`typing:${roomId}:${userId}`, username, 'EX', 10);
    await this.redis.sadd(`typing_room:${roomId}`, userId);
  }

  async clearTyping(roomId: string, userId: string): Promise<void> {
    await this.redis.del(`typing:${roomId}:${userId}`);
    await this.redis.srem(`typing_room:${roomId}`, userId);
  }

  async getTypingUsers(roomId: string): Promise<string[]> {
    const userIds = await this.redis.smembers(`typing_room:${roomId}`);
    const result: string[] = [];
    for (const uid of userIds) {
      const name = await this.redis.get(`typing:${roomId}:${uid}`);
      if (name) result.push(name);
    }
    return result;
  }

  // ── Socket Mapping ──
  async mapSocket(userId: string, socketId: string): Promise<void> {
    await this.redis.set(`sockmap:${userId}`, socketId, 'EX', 86400);
  }

  async unmapSocket(userId: string): Promise<void> {
    await this.redis.del(`sockmap:${userId}`);
  }

  async getSocketByUserId(userId: string): Promise<string | null> {
    return this.redis.get(`sockmap:${userId}`);
  }

  async mapUserToSocket(socketId: string, userId: string): Promise<void> {
    await this.redis.set(`sockuser:${socketId}`, userId, 'EX', 86400);
  }

  async getUserBySocket(socketId: string): Promise<string | null> {
    return this.redis.get(`sockuser:${socketId}`);
  }

  async removeSocket(socketId: string): Promise<void> {
    const userId = await this.getUserBySocket(socketId);
    if (userId) {
      await this.unmapSocket(userId);
    }
    await this.redis.del(`sockuser:${socketId}`);
  }

  // ── Rate Limiter ──
  async checkRateLimit(
    key: string,
    maxRequests: number,
    windowSeconds: number,
  ): Promise<boolean> {
    const current = await this.redis.incr(`ratelimit:${key}`);
    if (current === 1) {
      await this.redis.expire(`ratelimit:${key}`, windowSeconds);
    }
    return current <= maxRequests;
  }

  async getRateLimitRemaining(key: string): Promise<number> {
    const ttl = await this.redis.ttl(`ratelimit:${key}`);
    const count = parseInt((await this.redis.get(`ratelimit:${key}`)) || '0', 10);
    return { count, ttl } as any;
  }

  // ── Pub/Sub ──
  async publish(channel: string, message: string): Promise<void> {
    await this.redis.publish(channel, message);
  }

  subscribe(channel: string, callback: (message: string) => void): () => void {
    const sub = new Redis(this.redis.options);
    void sub.subscribe(channel);
    sub.on('message', (_ch: string, msg: string) => callback(msg));
    return () => {
      void sub.unsubscribe(channel);
      sub.quit().catch(() => {});
    };
  }

  // ── Generic ──
  async get(key: string): Promise<string | null> {
    return this.redis.get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.redis.set(key, value, 'EX', ttlSeconds);
    } else {
      await this.redis.set(key, value);
    }
  }

  async del(key: string): Promise<void> {
    await this.redis.del(key);
  }

  getClient(): Redis {
    return this.redis;
  }
}
