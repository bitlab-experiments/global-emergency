import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';
import { CapModule } from './modules/cap/cap.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { AdaptersModule } from './modules/adapters/adapters.module';
import { ConfigModule } from '@nestjs/config';
import { EventEmitterModule } from '@nestjs/event-emitter';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    EventEmitterModule.forRoot(),
    DatabaseModule,
    CapModule,
    AlertsModule,
    AdaptersModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
