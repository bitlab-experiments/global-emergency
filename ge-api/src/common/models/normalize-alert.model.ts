import type { Geometry } from 'geojson';

export const ALERT_MSG_TYPES = ['Alert', 'Update', 'Cancel'] as const;
export type AlertMsgType = (typeof ALERT_MSG_TYPES)[number];

export const ALERT_CATEGORIES = [
  'Geo',
  'Met',
  'Safety',
  'Security',
  'Rescue',
  'Fire',
  'Health',
  'Env',
  'Transport',
  'Infra',
  'CBRNE',
  'Other',
] as const;
export type AlertCategory = (typeof ALERT_CATEGORIES)[number];

export const ALERT_URGENCIES = [
  'Immediate',
  'Expected',
  'Future',
  'Past',
  'Unknown',
] as const;
export type AlertUrgency = (typeof ALERT_URGENCIES)[number];

export const ALERT_SEVERITIES = [
  'Extreme',
  'Severe',
  'Moderate',
  'Minor',
  'Unknown',
] as const;
export type AlertSeverity = (typeof ALERT_SEVERITIES)[number];

export const ALERT_CERTAINTIES = [
  'Observed',
  'Likely',
  'Possible',
  'Unlikely',
  'Unknown',
] as const;
export type AlertCertainty = (typeof ALERT_CERTAINTIES)[number];

export const ALERT_TIERS = ['A', 'B', 'C', 'D'] as const;
export type AlertTier = (typeof ALERT_TIERS)[number];

export const ALERT_STATUSES = [
  'active',
  'superseded',
  'cancelled',
  'expired',
] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

export interface AlertArea {
  name: string;
  geometry?: Geometry;
  geocodes?: Record<string, string>;
}

export interface NormalizedAlert {
  id: string; // `${sender}|${identifier}|${sent}` in UTC
  source: string; // adapter key: 'nws', 'usgs', 'gdacs'
  sender: string;
  msgType: AlertMsgType;
  references?: string[]; // ids this alert supersedes
  category: AlertCategory;
  event: string; // e.g. "Tsunami Warning"
  urgency: AlertUrgency;
  severity: AlertSeverity;
  certainty: AlertCertainty;
  sent: Date;
  effective?: Date;
  expires?: Date;
  headline?: string;
  description?: string;
  instruction?: string;
  areas: AlertArea[];
  lang: string; // BCP-47
  tier: AlertTier;
  sourceUrl?: string;
  raw: unknown; // original payload for audit
}

/** Stable id. `sent` is UTC so the same instant always maps to one key. */
export function buildAlertId(
  sender: string,
  identifier: string,
  sent: Date,
): string {
  return `${sender}|${identifier}|${sent.toISOString()}`;
}
