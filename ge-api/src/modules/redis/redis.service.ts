import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { EventEmitter2 } from '@nestjs/event-emitter';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly publisher: Redis;
  private readonly subscriber: Redis;

  constructor(
    private readonly eventEmitter: EventEmitter2,
  ) {
    this.publisher = new Redis({
      host: process.env.REDIS_HOST,
      port: parseInt(process.env.REDIS_PORT ?? '6379'),
      password: process.env.REDIS_PASSWORD,
    });
    this.subscriber = this.publisher.duplicate();
  }

  async onModuleInit() {
    await this.subscriber.subscribe('alerts.ingested');
    this.subscriber.on('message', (channel, message) => {
      if (channel === 'alerts.ingested') {
        this.eventEmitter.emit('alerts.ingested', JSON.parse(message));
      }
    });
  }

  async onModuleDestroy() {
    await this.subscriber.unsubscribe('alerts.ingested');
    await this.subscriber.quit();
    await this.publisher.quit();
  }

  async getCache<T>(key: string): Promise<T | undefined> {
    const data = await this.publisher.get(key);
    if (data) {
      return JSON.parse(data) as T;
    }
  }

  async setCache(key: string, data: any): Promise<boolean> {
    const result = await this.publisher.set(
      key,
      JSON.stringify(data),
    );
    return result === 'OK';
  }

  async publish(channel: string, message: unknown) {
    await this.publisher.publish(channel, JSON.stringify(message));
  }
}
