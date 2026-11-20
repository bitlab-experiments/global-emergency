import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';

export const DEFAULT_DATABASE_URL = 'postgres://ge:ge@localhost:5432/ge';

@Injectable()
export class DatabaseService implements OnModuleInit, OnModuleDestroy {
  readonly pool: Pool;

  constructor() {
    this.pool = new Pool({
      connectionString: process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
      connectionTimeoutMillis: 5000,
    });
  }

  async onModuleInit(): Promise<void> {
    const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
    await this.pool.query(schema);
  }

  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
