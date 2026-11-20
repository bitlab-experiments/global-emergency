import type {
  AlertArea,
  AlertCategory,
  AlertCertainty,
  AlertMsgType,
  AlertSeverity,
  AlertStatus,
  AlertTier,
  AlertUrgency,
} from '../../common/models/normalize-alert.model';

export interface AlertView {
  id: string;
  source: string;
  sender: string;
  msgType: AlertMsgType;
  references?: string[];
  category: AlertCategory;
  event: string;
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
  lang: string;
  tier: AlertTier;
  sourceUrl?: string;
  status: AlertStatus;
  countries: string[];
}

export interface AlertDetail extends AlertView {
  raw: unknown;
  mirrors: string[];
}

export interface AlertListQuery {
  status?: AlertStatus;
  severity?: AlertSeverity;
  category?: AlertCategory;
  source?: string;
  bbox?: [number, number, number, number];
  limit: number;
  offset: number;
}

export interface IngestResult {
  inserted: number;
  existing: number;
  alerts: AlertView[];
}
