import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DISCLAIMER } from '../../common/disclaimer';
import type { NormalizedAlert } from '../../common/models/normalize-alert.model';
import { CapParser } from '../cap/cap.module';
import { CapParseError } from '../cap/cap.parser';
import { parseAlertListQuery, parseIngestQuery } from './alert-query';
import { AlertsRepository } from './alerts.repository';
import { IngestResult } from './alerts.types';

@Injectable()
export class AlertsService {
  constructor(
    private readonly caps: CapParser,
    private readonly alerts: AlertsRepository,
  ) {}

  async ingest(body: unknown, query: { source?: unknown; tier?: unknown }) {
    if (typeof body !== 'string' || body.trim() === '') {
      throw new BadRequestException('Request body must be a CAP XML document');
    }
    const options = parseIngestQuery(query.source, query.tier);
    let parsed: NormalizedAlert[];
    try {
      parsed = this.caps.parse(body, options);
    } catch (error) {
      if (error instanceof CapParseError) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
    const result: IngestResult = await this.alerts.ingest(parsed);
    return { disclaimer: DISCLAIMER, ...result };
  }

  async list(query: Record<string, unknown>) {
    const parsed = parseAlertListQuery(query);
    const data = await this.alerts.list(parsed);
    return {
      disclaimer: DISCLAIMER,
      data,
      limit: parsed.limit,
      offset: parsed.offset,
    };
  }

  async get(id: string) {
    if (id.length === 0 || id.length > 512) {
      throw new BadRequestException('alert id is invalid');
    }
    const alert = await this.alerts.findById(id);
    if (!alert) throw new NotFoundException(`No alert with id ${id}`);
    return { disclaimer: DISCLAIMER, alert };
  }
}
