import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../database/database.module';
import { CapModule } from '../cap/cap.module';
import { AlertsController } from './alerts.controller';
import { AlertsRepository } from './alerts.repository';
import { AlertsService } from './alerts.service';
import { StreamController } from './stream.controller';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [DatabaseModule, CapModule, RedisModule],
  controllers: [AlertsController, StreamController],
  providers: [AlertsRepository, AlertsService],
  exports: [AlertsRepository, AlertsService],
})
export class AlertsModule {}
