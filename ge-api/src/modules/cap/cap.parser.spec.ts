import { readFileSync } from 'fs';
import { join } from 'path';
import type { Polygon } from 'geojson';
import { buildAlertId } from '../../common/models/normalize-alert.model';
import { CapParseError, parseCapDocument } from './cap.parser';

const options = { source: 'sample', tier: 'A' as const };

function minimalAlert(fields?: {
  identifier?: string;
  sender?: string;
  sent?: string;
  msgType?: string;
  references?: string;
  infos?: string;
}): string {
  const references = fields?.references
    ? `<references>${fields.references}</references>`
    : '';
  const infos =
    fields?.infos ??
    `<info>
      <language>en-US</language>
      <category>Met</category>
      <event>Test Event</event>
      <urgency>Immediate</urgency>
      <severity>Minor</severity>
      <certainty>Observed</certainty>
    </info>`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<alert xmlns="urn:oasis:names:tc:emergency:cap:1.2">
  <identifier>${fields?.identifier ?? 'id-1'}</identifier>
  <sender>${fields?.sender ?? 'sender.example'}</sender>
  <sent>${fields?.sent ?? '2024-01-01T00:00:00Z'}</sent>
  <status>Actual</status>
  <msgType>${fields?.msgType ?? 'Alert'}</msgType>
  <scope>Public</scope>
  ${references}
  ${infos}
</alert>`;
}

describe('parseCapDocument', () => {
  const sample = readFileSync(
    join(__dirname, '../../../fixtures/cap/sample-hurricane.xml'),
    'utf8',
  );

  it('maps a sample CAP file onto NormalizedAlert', () => {
    const [alert] = parseCapDocument(sample, options);

    expect(alert.id).toBe(
      'ge-monitor.example|sample-hurricane-001|2024-08-15T22:30:00.000Z',
    );
    expect(alert).toMatchObject({
      source: 'sample',
      sender: 'ge-monitor.example',
      msgType: 'Alert',
      category: 'Met',
      event: 'Hurricane Warning',
      urgency: 'Immediate',
      severity: 'Extreme',
      certainty: 'Observed',
      lang: 'en-US',
      tier: 'A',
      headline: 'Hurricane Warning for the sample coast',
      instruction: 'This fixture is for software testing only.',
      sourceUrl: 'https://example.com/alerts/sample-hurricane-001',
    });
    expect(alert.description).toBe(
      'This is a fixture alert used to verify CAP ingest. It is not a real warning. High wind & surge.',
    );
    expect(alert.effective?.toISOString()).toBe('2024-08-15T22:30:00.000Z');
    expect(alert.expires?.toISOString()).toBe('2024-08-16T22:30:00.000Z');
    expect(alert.areas[0]).toEqual({
      name: 'Sample Coast',
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [-81, 25],
            [-80, 25],
            [-80, 26],
            [-81, 26],
            [-81, 25],
          ],
        ],
      },
      geocodes: { SAME: '012087' },
    });
    expect(alert.areas[1]).toEqual({
      name: 'Inland Counties',
      geocodes: { SAME: '012086' },
    });
  });

  it('closes an open polygon ring and joins repeated geocode names', () => {
    const [alert] = parseCapDocument(
      minimalAlert({
        infos: `<info>
          <language>en-US</language>
          <category>Met</category>
          <event>Wind</event>
          <urgency>Expected</urgency>
          <severity>Moderate</severity>
          <certainty>Likely</certainty>
          <area>
            <areaDesc>Open ring</areaDesc>
            <polygon>25.0,-81.0 25.0,-80.0 26.0,-80.0 26.0,-81.0</polygon>
            <geocode><valueName>SAME</valueName><value>001</value></geocode>
            <geocode><valueName>SAME</valueName><value>002</value></geocode>
          </area>
        </info>`,
      }),
      options,
    );

    const geometry = alert.areas[0].geometry as Polygon;
    const ring = geometry.coordinates[0];
    expect(ring[0]).toEqual([-81, 25]);
    expect(ring[ring.length - 1]).toEqual(ring[0]);
    expect(alert.areas[0].geocodes).toEqual({ SAME: '001,002' });
  });

  it('turns a CAP circle into a closed polygon around the center', () => {
    const [alert] = parseCapDocument(
      minimalAlert({
        infos: `<info>
          <language>en-US</language>
          <category>Geo</category>
          <event>Earthquake</event>
          <urgency>Immediate</urgency>
          <severity>Severe</severity>
          <certainty>Observed</certainty>
          <area>
            <areaDesc>Epicenter</areaDesc>
            <circle>25.0,-80.0 50</circle>
          </area>
        </info>`,
      }),
      options,
    );

    const geometry = alert.areas[0].geometry as Polygon;
    const ring = geometry.coordinates[0];
    expect(geometry.type).toBe('Polygon');
    expect(ring).toHaveLength(65);
    expect(ring[ring.length - 1]).toEqual(ring[0]);
    for (const [lon, lat] of ring) {
      expect(distanceKm(25, -80, lat, lon)).toBeCloseTo(50, 0);
    }
  });

  it('combines several shapes into a MultiPolygon', () => {
    const [alert] = parseCapDocument(
      minimalAlert({
        infos: `<info>
          <language>en-US</language>
          <category>Met</category>
          <event>Flood</event>
          <urgency>Expected</urgency>
          <severity>Severe</severity>
          <certainty>Likely</certainty>
          <area>
            <areaDesc>Two basins</areaDesc>
            <polygon>10,100 10,101 11,101 11,100 10,100</polygon>
            <polygon>12,100 12,101 13,101 13,100 12,100</polygon>
          </area>
        </info>`,
      }),
      options,
    );

    expect(alert.areas[0].geometry).toMatchObject({
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [100, 10],
            [101, 10],
            [101, 11],
            [100, 11],
            [100, 10],
          ],
        ],
        [
          [
            [100, 12],
            [101, 12],
            [101, 13],
            [100, 13],
            [100, 12],
          ],
        ],
      ],
    });
  });

  it('keeps the requested language and the other info blocks in raw', () => {
    const [alert] = parseCapDocument(
      minimalAlert({
        infos: `<info>
          <language>en-US</language>
          <category>Met</category>
          <event>Storm</event>
          <urgency>Expected</urgency>
          <severity>Minor</severity>
          <certainty>Possible</certainty>
          <headline>Storm</headline>
        </info>
        <info>
          <language>vi</language>
          <category>Met</category>
          <event>Bao</event>
          <urgency>Expected</urgency>
          <severity>Minor</severity>
          <certainty>Possible</certainty>
          <headline>Bao</headline>
        </info>`,
      }),
      { ...options, lang: 'vi' },
    );

    expect(alert.lang).toBe('vi');
    expect(alert.headline).toBe('Bao');
    expect(alert.event).toBe('Bao');
    expect(alert.raw).toMatchObject({
      info: [{ language: 'en-US' }, { language: 'vi' }],
    });
  });

  it('stores a cancel that has no info block', () => {
    const [alert] = parseCapDocument(
      minimalAlert({ msgType: 'Cancel', infos: '' }),
      options,
    );
    expect(alert.msgType).toBe('Cancel');
    expect(alert.event).toBe('Unknown');
    expect(alert.severity).toBe('Unknown');
    expect(alert.category).toBe('Other');
    expect(alert.areas).toEqual([]);
  });

  it('builds reference ids in the same UTC form as alert ids', () => {
    const sent = new Date('2024-08-15T18:30:00-04:00');
    const [alert] = parseCapDocument(
      minimalAlert({
        msgType: 'Update',
        identifier: 'update-1',
        sent: '2024-08-15T19:00:00-04:00',
        references:
          'ge-monitor.example,sample-hurricane-001,2024-08-15T18:30:00-04:00',
      }),
      options,
    );

    expect(alert.references).toEqual([
      buildAlertId('ge-monitor.example', 'sample-hurricane-001', sent),
    ]);
  });

  it('skips administrative Ack messages', () => {
    expect(
      parseCapDocument(minimalAlert({ msgType: 'Ack', infos: '' }), options),
    ).toEqual([]);
  });

  it('reads an alert nested in an Atom entry', () => {
    const cap = minimalAlert({ identifier: 'atom-1' });
    const feed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <content type="text">${cap.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</content>
  </entry>
</feed>`;
    const [alert] = parseCapDocument(feed, options);
    expect(alert.id).toContain('atom-1');
    expect(alert.event).toBe('Test Event');
  });

  it('rejects a DOCTYPE so external entities cannot be declared', () => {
    const xml = `<?xml version="1.0"?>
<!DOCTYPE alert [<!ENTITY ext SYSTEM "file:///etc/passwd">]>
<alert>&ext;</alert>`;
    expect(() => parseCapDocument(xml, options)).toThrow(CapParseError);
    expect(() => parseCapDocument(xml, options)).toThrow(/DOCTYPE/);
  });

  it('rejects an invalid severity', () => {
    expect(() =>
      parseCapDocument(
        minimalAlert({
          infos: `<info>
            <language>en-US</language>
            <category>Met</category>
            <event>Storm</event>
            <urgency>Immediate</urgency>
            <severity>Huge</severity>
            <certainty>Observed</certainty>
          </info>`,
        }),
        options,
      ),
    ).toThrow(/severity/);
  });
});

function distanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}
