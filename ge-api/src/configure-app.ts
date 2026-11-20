import { INestApplication } from '@nestjs/common';
import express from 'express';

/** CAP ingest posts XML. Nest's JSON parser leaves that body unread. */
export function configureApp(app: INestApplication): void {
  app.use(
    express.text({
      type: [
        'application/xml',
        'text/xml',
        'application/cap+xml',
        'text/plain',
      ],
      limit: '5mb',
    }),
  );
  app.enableShutdownHooks();
  app.enableCors({
    origin: true,
    methods: ['GET', 'HEAD', 'OPTIONS'],
  });
}
