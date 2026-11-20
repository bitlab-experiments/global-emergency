import { readFileSync } from 'fs';
import { join } from 'path';
import { load as loadYaml } from 'js-yaml';
import { ALERT_TIERS } from '../common/models/normalize-alert.model';
import {
  SOURCE_ADAPTER_TYPES,
  type SourceConfig,
} from '../common/models/source-config.model';

const SOURCE_KEY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export function loadSourceConfigs(
  path = join(__dirname, 'sources.yaml'),
): SourceConfig[] {
  const document = loadYaml(readFileSync(path, 'utf8'));
  if (!Array.isArray(document)) {
    throw new Error('sources.yaml must be a list of source configs');
  }

  const configs = document.map((entry, index) =>
    parseSourceConfig(entry, index),
  );
  const keys = new Set<string>();
  for (const config of configs) {
    if (keys.has(config.key)) {
      throw new Error(`Duplicate source key "${config.key}"`);
    }
    keys.add(config.key);
  }
  return configs;
}

function parseSourceConfig(value: unknown, index: number): SourceConfig {
  if (!isRecord(value)) {
    throw new Error(`sources.yaml[${index}] must be an object`);
  }

  const key = requireString(value.key, index, 'key');
  if (!SOURCE_KEY.test(key)) {
    throw new Error(`sources.yaml[${index}].key is invalid`);
  }

  const type = requireString(value.type, index, 'type');
  if (!isOneOf(type, SOURCE_ADAPTER_TYPES)) {
    throw new Error(
      `sources.yaml[${index}].type must be one of ${SOURCE_ADAPTER_TYPES.join(', ')}`,
    );
  }

  const url = requireString(value.url, index, 'url');
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error('bad protocol');
    }
  } catch {
    throw new Error(`sources.yaml[${index}].url must be an http(s) URL`);
  }

  const intervalSec = requirePositiveInt(
    value.intervalSec,
    index,
    'intervalSec',
  );
  const tier = requireString(value.tier, index, 'tier').toUpperCase();
  if (!isOneOf(tier, ALERT_TIERS)) {
    throw new Error(`sources.yaml[${index}].tier must be A, B, C, or D`);
  }

  const config: SourceConfig = {
    key,
    type,
    url,
    intervalSec,
    tier,
    enabled: value.enabled === undefined ? true : Boolean(value.enabled),
  };
  if (typeof value.license === 'string' && value.license.trim()) {
    config.license = value.license.trim();
  }
  if (typeof value.lang === 'string' && value.lang.trim()) {
    config.lang = value.lang.trim();
  }
  return config;
}

function requireString(value: unknown, index: number, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`sources.yaml[${index}].${field} is required`);
  }
  return value.trim();
}

function requirePositiveInt(
  value: unknown,
  index: number,
  field: string,
): number {
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value)
        : NaN;
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `sources.yaml[${index}].${field} must be a positive integer`,
    );
  }
  return parsed;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(
  value: string,
  allowed: readonly T[],
): value is T {
  return (allowed as readonly string[]).includes(value);
}
