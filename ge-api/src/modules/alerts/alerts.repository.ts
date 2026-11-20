import { Injectable } from '@nestjs/common';
import type { Geometry } from 'geojson';
import type { PoolClient, QueryResult, QueryResultRow } from 'pg';
import { DatabaseService } from '../../database/database.service';
import {
  ALERT_TIERS,
  type AlertArea,
  type AlertCategory,
  type AlertCertainty,
  type AlertMsgType,
  type AlertSeverity,
  type AlertStatus,
  type AlertTier,
  type AlertUrgency,
  type NormalizedAlert,
} from '../../common/models/normalize-alert.model';
import type {
  AlertDetail,
  AlertListQuery,
  AlertView,
  IngestResult,
} from './alerts.types';
import { parseAlertId, tierRank } from './alert-id';
import { RedisService } from '../redis/redis.service';

const MIRROR_TIME_WINDOW_MS = 6 * 60 * 60 * 1000;

interface Queryable {
  query<T extends QueryResultRow>(
    sql: string,
    params?: unknown[],
  ): Promise<QueryResult<T>>;
}

interface AlertAreaJson {
  name: string | null;
  geocodes: Record<string, string> | null;
  geometry: unknown;
}

interface AlertRow {
  id: string;
  source: string;
  sender: string;
  msg_type: AlertMsgType;
  category: AlertCategory;
  event: string;
  urgency: AlertUrgency;
  severity: AlertSeverity;
  certainty: AlertCertainty;
  sent: Date;
  effective: Date | null;
  expires: Date | null;
  status: AlertStatus;
  tier: string | null;
  lang: string;
  source_url: string | null;
  countries: string[] | null;
  headline: string | null;
  description: string | null;
  instruction: string | null;
  reference_ids: string[] | null;
  raw: unknown;
  mirrors: string[] | null;
  areas: AlertAreaJson[] | null;
}

const ALERT_COLUMNS = `
  a.id,
  a.source,
  a.sender,
  a.msg_type,
  a.category,
  a.event,
  a.urgency,
  a.severity,
  a.certainty,
  a.sent,
  a.effective,
  a.expires,
  a.status,
  a.tier,
  a.lang,
  a.source_url,
  a.countries,
  a.headline,
  a.description,
  a.instruction,
  a.reference_ids,
  a.raw,
  COALESCE(
    (
      SELECT json_agg(m.mirror_id ORDER BY m.mirror_id)
      FROM alert_mirrors m
      WHERE m.alert_id = a.id
    ),
    '[]'::json
  ) AS mirrors,
  COALESCE(
    json_agg(
      json_build_object(
        'name', aa.name,
        'geocodes', aa.geocodes,
        'geometry', CASE
          WHEN aa.geom IS NULL THEN NULL
          ELSE ST_AsGeoJSON(aa.geom)::json
        END
      )
      ORDER BY aa.id
    ) FILTER (WHERE aa.id IS NOT NULL),
    '[]'::json
  ) AS areas
`;

@Injectable()
export class AlertsRepository {
  constructor(
    private readonly database: DatabaseService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * Idempotent insert keyed on sender + identifier + sent.
   * Applies Update/Cancel lifecycle and cross-source mirror links.
   */
  async ingest(alerts: NormalizedAlert[]): Promise<IngestResult> {
    if (alerts.length === 0) {
      return { inserted: 0, existing: 0, alerts: [] };
    }

    const client = await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      await this.upsertSources(client, alerts);

      let inserted = 0;
      let existing = 0;
      for (const alert of alerts) {
        const created = await this.insertAlert(client, alert);
        if (created) {
          inserted += 1;
          await this.insertAreas(client, alert);
        } else {
          existing += 1;
        }
        await this.applyLifecycle(client, alert);
        await this.linkMirrors(client, alert);
      }

      const stored = await this.selectByIds(
        client,
        alerts.map((alert) => alert.id),
      );
      await client.query('COMMIT');
      const ingestedAlerts = stored.map(toView);
      await this.redisService.publish('alerts.ingested', ingestedAlerts);
      return { inserted, existing, alerts: ingestedAlerts };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** Mark active alerts past `expires` as expired. Returns how many rows changed. */
  async expireDue(now: Date = new Date()): Promise<number> {
    const result = await this.database.pool.query(
      `UPDATE alerts
       SET status = 'expired'
       WHERE status = 'active'
         AND expires IS NOT NULL
         AND expires <= $1`,
      [now],
    );
    return result.rowCount ?? 0;
  }

  async list(query: AlertListQuery): Promise<AlertView[]> {
    const params: unknown[] = [];
    const where: string[] = [];
    const bind = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };

    where.push(`a.status = ${bind(query.status ?? 'active')}`);
    if (query.severity) where.push(`a.severity = ${bind(query.severity)}`);
    if (query.category) where.push(`a.category = ${bind(query.category)}`);
    if (query.source) where.push(`a.source = ${bind(query.source)}`);
    if (query.bbox) {
      const [minLon, minLat, maxLon, maxLat] = query.bbox;
      where.push(`EXISTS (
        SELECT 1 FROM alert_areas box
        WHERE box.alert_id = a.id
          AND box.geom IS NOT NULL
          AND ST_Intersects(
            box.geom,
            ST_MakeEnvelope(${bind(minLon)}, ${bind(minLat)}, ${bind(maxLon)}, ${bind(maxLat)}, 4326)
          )
      )`);
    }

    const limit = bind(query.limit);
    const offset = bind(query.offset);
    const rows = await this.queryRows(
      this.database.pool,
      `${selectSql(where.length > 0 ? `WHERE ${where.join(' AND ')}` : '')}
       ORDER BY a.sent DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params,
    );
    return rows.map(toView);
  }

  async findById(id: string): Promise<AlertDetail | null> {
    const rows = await this.queryRows(
      this.database.pool,
      `${selectSql('WHERE a.id = $1')} LIMIT 1`,
      [id],
    );
    const row = rows[0];
    return row ? toDetail(row) : null;
  }

  private async applyLifecycle(
    client: PoolClient,
    alert: NormalizedAlert,
  ): Promise<void> {
    const refs = alert.references?.filter((id) => id && id !== alert.id) ?? [];
    if (refs.length === 0) return;

    if (alert.msgType === 'Update') {
      await client.query(
        `UPDATE alerts
         SET status = 'superseded',
             canonical_id = $1
         WHERE id = ANY($2::text[])
           AND status IN ('active', 'superseded')`,
        [alert.id, refs],
      );
      return;
    }

    if (alert.msgType === 'Cancel') {
      await client.query(
        `UPDATE alerts
         SET status = 'cancelled',
             canonical_id = $1
         WHERE id = ANY($2::text[])
           AND status <> 'expired'`,
        [alert.id, refs],
      );
    }
  }

  /**
   * Link cross-source duplicates: same CAP sender+identifier first,
   * then event + area overlap + time window.
   */
  private async linkMirrors(
    client: PoolClient,
    alert: NormalizedAlert,
  ): Promise<void> {
    const { sender, identifier } = parseAlertId(alert.id);
    const byIdentity = await client.query<{
      id: string;
      tier: string | null;
    }>(
      `SELECT id, tier FROM alerts
       WHERE sender = $1
         AND id LIKE $2
         AND id <> $3`,
      [sender, `${sender}|${identifier}|%`, alert.id],
    );

    const relatedIds = new Set(byIdentity.rows.map((row) => row.id));

    const windowStart = new Date(alert.sent.getTime() - MIRROR_TIME_WINDOW_MS);
    const windowEnd = new Date(alert.sent.getTime() + MIRROR_TIME_WINDOW_MS);
    const byHeuristic = await client.query<{
      id: string;
      tier: string | null;
    }>(
      `SELECT a.id, a.tier
       FROM alerts a
       WHERE a.id <> $1
         AND a.event = $2
         AND a.sent BETWEEN $3 AND $4
         AND EXISTS (
           SELECT 1
           FROM alert_areas mine
           JOIN alert_areas theirs
             ON theirs.alert_id = a.id
            AND theirs.geom IS NOT NULL
            AND ST_Intersects(mine.geom, theirs.geom)
           WHERE mine.alert_id = $1
             AND mine.geom IS NOT NULL
         )
       LIMIT 50`,
      [alert.id, alert.event, windowStart, windowEnd],
    );
    for (const row of byHeuristic.rows) relatedIds.add(row.id);

    if (relatedIds.size === 0) return;

    const candidates = [
      { id: alert.id, tier: alert.tier },
      ...byIdentity.rows,
      ...byHeuristic.rows,
    ];
    const byId = new Map<string, { id: string; tier: string | null }>();
    for (const row of candidates) byId.set(row.id, row);
    const group = [...byId.values()];

    let canonical = group[0];
    for (const row of group) {
      if (tierRank(row.tier) > tierRank(canonical.tier)) canonical = row;
      else if (
        tierRank(row.tier) === tierRank(canonical.tier) &&
        row.id < canonical.id
      ) {
        canonical = row;
      }
    }

    const mirrors = group
      .map((row) => row.id)
      .filter((id) => id !== canonical.id);
    for (const mirrorId of mirrors) {
      await client.query(
        `UPDATE alerts
         SET canonical_id = $1
         WHERE id = $2
           AND (canonical_id IS NULL OR canonical_id <> $1)`,
        [canonical.id, mirrorId],
      );
      await client.query(
        `INSERT INTO alert_mirrors (alert_id, mirror_id)
         VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [canonical.id, mirrorId],
      );
    }
    await client.query(
      `UPDATE alerts SET canonical_id = NULL WHERE id = $1 AND canonical_id IS NOT NULL`,
      [canonical.id],
    );
  }

  private async upsertSources(
    client: PoolClient,
    alerts: NormalizedAlert[],
  ): Promise<void> {
    const sources = new Map<string, AlertTier>();
    for (const alert of alerts) sources.set(alert.source, alert.tier);
    for (const [key, tier] of sources) {
      await client.query(
        `INSERT INTO sources (key, name, tier, enabled)
         VALUES ($1, $2, $3, true)
         ON CONFLICT (key) DO UPDATE SET
           name = EXCLUDED.name,
           tier = EXCLUDED.tier`,
        [key, key, tier],
      );
    }
  }

  private async insertAlert(
    client: PoolClient,
    alert: NormalizedAlert,
  ): Promise<boolean> {
    const result = await client.query<{ id: string }>(
      `INSERT INTO alerts (
         id, source, sender, msg_type, category, event,
         urgency, severity, certainty,
         sent, effective, expires,
         status, tier, lang, source_url,
         headline, description, instruction,
         reference_ids, raw
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9,
         $10, $11, $12,
         'active', $13, $14, $15,
         $16, $17, $18,
         $19, $20::jsonb
       )
       ON CONFLICT (id) DO NOTHING
       RETURNING id`,
      [
        alert.id,
        alert.source,
        alert.sender,
        alert.msgType,
        alert.category,
        alert.event,
        alert.urgency,
        alert.severity,
        alert.certainty,
        alert.sent,
        alert.effective ?? null,
        alert.expires ?? null,
        alert.tier,
        alert.lang,
        alert.sourceUrl ?? null,
        alert.headline ?? null,
        alert.description ?? null,
        alert.instruction ?? null,
        alert.references ?? null,
        JSON.stringify(alert.raw),
      ],
    );
    return (result.rowCount ?? 0) > 0;
  }

  private async insertAreas(
    client: PoolClient,
    alert: NormalizedAlert,
  ): Promise<void> {
    for (const area of alert.areas) {
      await client.query(
        `INSERT INTO alert_areas (alert_id, name, geocodes, geom)
         VALUES (
           $1,
           $2,
           $3::jsonb,
           CASE
             WHEN $4::text IS NULL THEN NULL
             ELSE ST_SetSRID(ST_GeomFromGeoJSON($4::text), 4326)
           END
         )`,
        [
          alert.id,
          area.name,
          area.geocodes ? JSON.stringify(area.geocodes) : null,
          area.geometry ? JSON.stringify(area.geometry) : null,
        ],
      );
    }
  }

  private async selectByIds(
    client: Queryable,
    ids: string[],
  ): Promise<AlertRow[]> {
    const rows = await this.queryRows(
      client,
      `${selectSql('WHERE a.id = ANY($1::text[])')}`,
      [ids],
    );
    const byId = new Map(rows.map((row) => [row.id, row]));
    return ids.flatMap((id) => {
      const row = byId.get(id);
      return row ? [row] : [];
    });
  }

  private async queryRows(
    client: Queryable,
    sql: string,
    params: unknown[],
  ): Promise<AlertRow[]> {
    const result = await client.query<AlertRow>(sql, params);
    return result.rows;
  }
}

function selectSql(where: string): string {
  return `
    SELECT ${ALERT_COLUMNS}
    FROM alerts a
    LEFT JOIN alert_areas aa ON aa.alert_id = a.id
    ${where}
    GROUP BY a.id
  `;
}

function toView(row: AlertRow): AlertView {
  const tier = row.tier?.trim() ?? '';
  if (!isTier(tier)) {
    throw new Error(`Alert ${row.id} has an invalid tier`);
  }
  const view: AlertView = {
    id: row.id,
    source: row.source,
    sender: row.sender,
    msgType: row.msg_type,
    category: row.category,
    event: row.event,
    urgency: row.urgency,
    severity: row.severity,
    certainty: row.certainty,
    sent: row.sent,
    areas: (row.areas ?? []).map(toArea),
    lang: row.lang,
    tier,
    status: row.status,
    countries: row.countries ?? [],
  };
  if (row.reference_ids?.length) view.references = row.reference_ids;
  if (row.effective) view.effective = row.effective;
  if (row.expires) view.expires = row.expires;
  if (row.headline) view.headline = row.headline;
  if (row.description) view.description = row.description;
  if (row.instruction) view.instruction = row.instruction;
  if (row.source_url) view.sourceUrl = row.source_url;
  return view;
}

function toDetail(row: AlertRow): AlertDetail {
  return {
    ...toView(row),
    raw: row.raw,
    mirrors: row.mirrors ?? [],
  };
}

function toArea(area: AlertAreaJson): AlertArea {
  const mapped: AlertArea = { name: area.name ?? 'Unnamed area' };
  if (area.geocodes && Object.keys(area.geocodes).length > 0) {
    mapped.geocodes = area.geocodes;
  }
  const geometry = asGeometry(area.geometry);
  if (geometry) mapped.geometry = geometry;
  return mapped;
}

function asGeometry(value: unknown): Geometry | undefined {
  if (value == null) return undefined;
  const parsed: unknown = typeof value === 'string' ? JSON.parse(value) : value;
  if (isGeometry(parsed)) return parsed;
  return undefined;
}

function isGeometry(value: unknown): value is Geometry {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    'coordinates' in value
  );
}

function isTier(value: string): value is AlertTier {
  return (ALERT_TIERS as readonly string[]).includes(value);
}
