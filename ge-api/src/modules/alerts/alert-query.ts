import { BadRequestException } from '@nestjs/common';
import {
  ALERT_CATEGORIES,
  ALERT_SEVERITIES,
  ALERT_STATUSES,
  ALERT_TIERS,
  type AlertTier,
} from '../../common/models/normalize-alert.model';
import type { AlertListQuery } from './alerts.types';

const SOURCE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function parseIngestQuery(
  source: unknown,
  tier: unknown,
): { source: string; tier: AlertTier } {
  const sourceKey = source === undefined || source === '' ? 'sample' : source;
  if (typeof sourceKey !== 'string' || !SOURCE_KEY.test(sourceKey)) {
    throw new BadRequestException(
      'source must be a short key such as nws or usgs',
    );
  }
  const tierValue = tier === undefined || tier === '' ? 'A' : tier;
  if (typeof tierValue !== 'string') {
    throw new BadRequestException('tier must be A, B, C, or D');
  }
  const normalized = tierValue.toUpperCase();
  if (!isOneOf(normalized, ALERT_TIERS)) {
    throw new BadRequestException('tier must be A, B, C, or D');
  }
  return { source: sourceKey, tier: normalized };
}

export function parseAlertListQuery(
  query: Record<string, unknown>,
): AlertListQuery {
  const parsed: AlertListQuery = {
    limit: parseBoundedInt(query.limit, 50, 1, 200, 'limit'),
    offset: parseBoundedInt(query.offset, 0, 0, 100_000, 'offset'),
  };

  if (query.status !== undefined && query.status !== '') {
    const status = asString(query.status, 'status');
    if (!isOneOf(status, ALERT_STATUSES)) {
      throw new BadRequestException(
        'status must be active, superseded, cancelled, or expired',
      );
    }
    parsed.status = status;
  } else {
    // Live board defaults to the active set (phase 3).
    parsed.status = 'active';
  }
  if (query.severity !== undefined && query.severity !== '') {
    const severity = asString(query.severity, 'severity');
    if (!isOneOf(severity, ALERT_SEVERITIES)) {
      throw new BadRequestException('severity is invalid');
    }
    parsed.severity = severity;
  }
  if (query.category !== undefined && query.category !== '') {
    const category = asString(query.category, 'category');
    if (!isOneOf(category, ALERT_CATEGORIES)) {
      throw new BadRequestException('category is invalid');
    }
    parsed.category = category;
  }
  if (query.source !== undefined && query.source !== '') {
    const source = asString(query.source, 'source');
    if (!SOURCE_KEY.test(source)) {
      throw new BadRequestException('source is invalid');
    }
    parsed.source = source;
  }
  const bbox = parseBbox(query.bbox);
  if (bbox) parsed.bbox = bbox;
  return parsed;
}

function parseBbox(
  value: unknown,
): [number, number, number, number] | undefined {
  if (value === undefined || value === '') return undefined;
  const text = asString(value, 'bbox');
  const parts = text.split(',').map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    throw new BadRequestException('bbox must be minLon,minLat,maxLon,maxLat');
  }
  const [minLon, minLat, maxLon, maxLat] = parts;
  if (
    minLon < -180 ||
    maxLon > 180 ||
    minLat < -90 ||
    maxLat > 90 ||
    minLon >= maxLon ||
    minLat >= maxLat
  ) {
    throw new BadRequestException('bbox is outside the valid range');
  }
  return [minLon, minLat, maxLon, maxLat];
}

function parseBoundedInt(
  value: unknown,
  fallback: number,
  min: number,
  max: number,
  field: string,
): number {
  if (value === undefined || value === '') return fallback;
  const text = asString(value, field);
  if (!/^\d+$/.test(text)) {
    throw new BadRequestException(`${field} must be an integer`);
  }
  const parsed = Number(text);
  if (parsed < min || parsed > max) {
    throw new BadRequestException(`${field} must be between ${min} and ${max}`);
  }
  return parsed;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new BadRequestException(`${field} must be a string`);
  }
  return value;
}

function isOneOf<T extends string>(
  value: string,
  allowed: readonly T[],
): value is T {
  return (allowed as readonly string[]).includes(value);
}
