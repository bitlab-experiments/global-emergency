import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AdaptersModule } from '../modules/adapters/adapters.module';
import { AlertsModule } from '../modules/alerts/alerts.module';
import { WorkerBootstrapService } from './worker-bootstrap.service';
import { BullModule } from '@nestjs/bullmq';
import { SourceFetchService } from './source-fetch.service';
import { ConfigModule } from '@nestjs/config';
import {
  ALERT_EXPIRY_QUEUE,
  AlertExpiryProcessor,
} from './alert-expiry.processor';
import { RedisModule } from '../modules/redis/redis.module';
import { EventEmitterModule } from '@nestjs/event-emitter';

/**
 * Non-HTTP process: poll sources and ingest alerts.
 * Start with `npm run start:worker:dev` (separate from the API).
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST,
        port: parseInt(process.env.REDIS_PORT ?? '6379'),
        password: process.env.REDIS_PASSWORD ?? '',
      },
    }),
    BullModule.registerQueue(
      { name: 'source-fetch' },
      { name: ALERT_EXPIRY_QUEUE },
    ),
    EventEmitterModule.forRoot(),
    RedisModule,
    DatabaseModule,
    AdaptersModule,
    AlertsModule,
  ],
  providers: [WorkerBootstrapService, SourceFetchService, AlertExpiryProcessor],
})
export class WorkerModule {}
