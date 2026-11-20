import { readFileSync } from 'fs';
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { DatabaseService } from '../src/database/database.service';
import { AlertsRepository } from '../src/modules/alerts/alerts.repository';

const xml = readFileSync(
  join(__dirname, '../fixtures/cap/sample-hurricane.xml'),
  'utf8',
);

interface IngestBody {
  disclaimer: string;
  inserted: number;
  existing: number;
  alerts: Array<{
    id: string;
    msgType: string;
    references?: string[];
    areas: unknown[];
  }>;
}

interface ListBody {
  data: Array<{ id: string; event: string; status?: string }>;
}

interface DetailBody {
  alert: {
    headline: string;
    description: string;
    status: string;
    mirrors: string[];
    areas: Array<{
      name: string;
      geocodes?: Record<string, string>;
      geometry?: { type: string; coordinates: number[][][] };
    }>;
    raw: { identifier?: string };
  };
}

function jsonBody<T>(response: { body: unknown }): T {
  return response.body as T;
}

describe('CAP ingest (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    await app.get(DatabaseService).pool.query(`
      TRUNCATE TABLE
        notifications,
        watch_zones,
        users,
        alert_mirrors,
        alert_areas,
        alerts,
        sources
      RESTART IDENTITY CASCADE
    `);
  }, 20_000);

  afterAll(async () => {
    await app.close();
  });

  it('ingests a sample CAP file and queries it back', async () => {
    const server = app.getHttpServer();
    const ingested = await request(server)
      .post('/alerts/ingest?source=sample&tier=A')
      .set('Content-Type', 'application/xml')
      .send(xml)
      .expect(200);

    const ingestedBody = jsonBody<IngestBody>(ingested);
    expect(ingestedBody.disclaimer).toMatch(/not an official warning system/i);
    expect(ingestedBody.inserted).toBe(1);
    expect(ingestedBody.existing).toBe(0);

    const id = ingestedBody.alerts[0].id;
    expect(id).toBe(
      'ge-monitor.example|sample-hurricane-001|2024-08-15T22:30:00.000Z',
    );

    const again = await request(server)
      .post('/alerts/ingest?source=sample&tier=A')
      .set('Content-Type', 'application/xml')
      .send(xml)
      .expect(200);
    const againBody = jsonBody<IngestBody>(again);
    expect(againBody.inserted).toBe(0);
    expect(againBody.existing).toBe(1);
    expect(againBody.alerts[0].areas).toHaveLength(2);

    const list = await request(server)
      .get('/alerts')
      .query({ severity: 'Extreme', source: 'sample', status: 'active' })
      .expect(200);
    const listBody = jsonBody<ListBody>(list);
    expect(listBody.data).toHaveLength(1);
    expect(listBody.data[0].event).toBe('Hurricane Warning');

    const inside = await request(server)
      .get('/alerts')
      .query({ bbox: '-81.5,24.5,-79.5,26.5' })
      .expect(200);
    expect(jsonBody<ListBody>(inside).data.map((alert) => alert.id)).toContain(
      id,
    );

    const outside = await request(server)
      .get('/alerts')
      .query({ bbox: '0,0,1,1' })
      .expect(200);
    expect(jsonBody<ListBody>(outside).data).toHaveLength(0);

    const detail = await request(server)
      .get(`/alerts/${encodeURIComponent(id)}`)
      .expect(200);
    const detailBody = jsonBody<DetailBody>(detail);
    expect(detailBody.alert).toMatchObject({
      headline: 'Hurricane Warning for the sample coast',
      status: 'active',
      mirrors: [],
      areas: [
        {
          name: 'Sample Coast',
          geocodes: { SAME: '012087' },
          geometry: { type: 'Polygon' },
        },
        { name: 'Inland Counties', geocodes: { SAME: '012086' } },
      ],
    });
    expect(detailBody.alert.description).toContain('High wind & surge');
    expect(detailBody.alert.areas[0].geometry?.coordinates[0][0]).toEqual([
      -81, 25,
    ]);
    expect(detailBody.alert.areas[1].geometry).toBeUndefined();
    expect(detailBody.alert.raw).toMatchObject({
      identifier: 'sample-hurricane-001',
    });

    const update = `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>sample-hurricane-002</identifier>
  <sender>ge-monitor.example</sender>
  <sent>2024-08-15T19:00:00-04:00</sent>
  <status>Actual</status>
  <msgType>Update</msgType>
  <scope>Public</scope>
  <references>ge-monitor.example,sample-hurricane-001,2024-08-15T18:30:00-04:00</references>
  <info>
    <language>en-US</language>
    <category>Met</category>
    <event>Hurricane Warning</event>
    <urgency>Immediate</urgency>
    <severity>Severe</severity>
    <certainty>Observed</certainty>
    <headline>Updated sample warning</headline>
  </info>
</alert>`;
    const updated = await request(server)
      .post('/alerts/ingest?source=sample&tier=A')
      .set('Content-Type', 'application/xml')
      .send(update)
      .expect(200);
    const updatedBody = jsonBody<IngestBody>(updated);
    expect(updatedBody.alerts[0].references).toEqual([id]);
    expect(updatedBody.alerts[0].msgType).toBe('Update');

    const updateId = updatedBody.alerts[0].id;
    const activeAfterUpdate = await request(server).get('/alerts').expect(200);
    const activeIds = jsonBody<ListBody>(activeAfterUpdate).data.map(
      (alert) => alert.id,
    );
    expect(activeIds).toContain(updateId);
    expect(activeIds).not.toContain(id);

    const superseded = await request(server)
      .get('/alerts')
      .query({ status: 'superseded' })
      .expect(200);
    expect(jsonBody<ListBody>(superseded).data.map((a) => a.id)).toContain(id);

    const original = await request(server)
      .get(`/alerts/${encodeURIComponent(id)}`)
      .expect(200);
    expect(jsonBody<DetailBody>(original).alert.status).toBe('superseded');

    const cancelXml = `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>sample-hurricane-003</identifier>
  <sender>ge-monitor.example</sender>
  <sent>2024-08-15T20:00:00-04:00</sent>
  <status>Actual</status>
  <msgType>Cancel</msgType>
  <scope>Public</scope>
  <references>ge-monitor.example,sample-hurricane-002,2024-08-15T19:00:00-04:00</references>
  <info>
    <language>en-US</language>
    <category>Met</category>
    <event>Hurricane Warning</event>
    <urgency>Past</urgency>
    <severity>Minor</severity>
    <certainty>Observed</certainty>
    <headline>Cancelled sample warning</headline>
  </info>
</alert>`;
    await request(server)
      .post('/alerts/ingest?source=sample&tier=A')
      .set('Content-Type', 'application/xml')
      .send(cancelXml)
      .expect(200);

    const cancelledUpdate = await request(server)
      .get(`/alerts/${encodeURIComponent(updateId)}`)
      .expect(200);
    expect(jsonBody<DetailBody>(cancelledUpdate).alert.status).toBe(
      'cancelled',
    );

    const stillActive = await request(server).get('/alerts').expect(200);
    expect(
      jsonBody<ListBody>(stillActive).data.map((alert) => alert.id),
    ).not.toContain(updateId);

    await request(server).get('/alerts/does-not-exist').expect(404);
    await request(server)
      .post('/alerts/ingest')
      .set('Content-Type', 'application/xml')
      .send('<!DOCTYPE alert [<!ENTITY x "x">]><alert/>')
      .expect(400);
  });

  it('expires due alerts and links cross-source mirrors', async () => {
    const server = app.getHttpServer();
    const repo = app.get(AlertsRepository);
    await app.get(DatabaseService).pool.query(`
      TRUNCATE TABLE
        notifications, watch_zones, users,
        alert_mirrors, alert_areas, alerts, sources
      RESTART IDENTITY CASCADE
    `);

    const sender = 'ge-monitor.example';
    const identifier = 'mirror-quake-001';
    const sent = '2024-09-01T12:00:00.000Z';
    const mirrorSent = '2024-09-01T12:00:01.000Z';
    const alertId = `${sender}|${identifier}|${sent}`;
    const mirrorId = `${sender}|${identifier}|${mirrorSent}`;

    const cap = (sentAt: string) => `<?xml version="1.0"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>${identifier}</identifier>
  <sender>${sender}</sender>
  <sent>${sentAt}</sent>
  <status>Actual</status>
  <msgType>Alert</msgType>
  <scope>Public</scope>
  <info>
    <language>en-US</language>
    <category>Geo</category>
    <event>Earthquake</event>
    <urgency>Past</urgency>
    <severity>Moderate</severity>
    <certainty>Observed</certainty>
    <expires>2024-09-01T12:05:00.000Z</expires>
    <area>
      <areaDesc>Test Bay</areaDesc>
      <polygon>10,10 10,11 11,11 11,10 10,10</polygon>
    </area>
  </info>
</alert>`;

    await request(server)
      .post('/alerts/ingest?source=nws&tier=A')
      .set('Content-Type', 'application/xml')
      .send(cap(sent))
      .expect(200);
    await request(server)
      .post('/alerts/ingest?source=wmo-alert-hub&tier=C')
      .set('Content-Type', 'application/xml')
      .send(cap(mirrorSent))
      .expect(200);

    const detail = await request(server)
      .get(`/alerts/${encodeURIComponent(alertId)}`)
      .expect(200);
    expect(jsonBody<DetailBody>(detail).alert.mirrors).toEqual([mirrorId]);

    const marked = await repo.expireDue(new Date('2024-09-01T12:10:00.000Z'));
    expect(marked).toBeGreaterThanOrEqual(1);

    const after = await request(server)
      .get(`/alerts/${encodeURIComponent(alertId)}`)
      .expect(200);
    expect(jsonBody<DetailBody>(after).alert.status).toBe('expired');

    const active = await request(server).get('/alerts').expect(200);
    expect(
      jsonBody<ListBody>(active).data.map((alert) => alert.id),
    ).not.toContain(alertId);
  });
});
