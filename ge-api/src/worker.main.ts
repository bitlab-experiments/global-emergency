import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker/worker.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: ['log', 'error', 'warn'],
  });
  app.enableShutdownHooks();

  const logger = new Logger('Worker');
  logger.log('Worker process started (no HTTP listener)');
}

void bootstrap();
