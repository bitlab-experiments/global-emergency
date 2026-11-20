import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AdapterRegistry } from '../modules/adapters/adapter.registry';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { ALERT_EXPIRY_QUEUE } from './alert-expiry.processor';

const EXPIRY_EVERY_MS = 60_000;

@Injectable()
export class WorkerBootstrapService implements OnModuleInit {
  private readonly logger = new Logger('Worker');

  constructor(
    private readonly adapters: AdapterRegistry,
    @InjectQueue('source-fetch') private readonly fetchQueue: Queue,
    @InjectQueue(ALERT_EXPIRY_QUEUE) private readonly expiryQueue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    const list = this.adapters.list();
    this.logger.log(
      `Ready with ${list.length} source adapter(s): ${list
        .map((adapter) => adapter.key)
        .join(', ')}`,
    );
    for (const adapter of list) {
      await this.fetchQueue.upsertJobScheduler(
        `fetch:${adapter.key}`,
        { every: adapter.intervalSec * 1000 },
        {
          name: 'fetch',
          data: { sourceKey: adapter.key },
        },
      );
    }

    await this.expiryQueue.upsertJobScheduler(
      'expire-due-alerts',
      { every: EXPIRY_EVERY_MS },
      { name: 'expire' },
    );
    this.logger.log(`Scheduled alert expiry every ${EXPIRY_EVERY_MS / 1000}s`);
  }
}
