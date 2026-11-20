import { readFileSync } from 'fs';
import { join } from 'path';
import { CapParser } from '../cap/cap.module';
import {
  CapAtomAdapter,
  CapAtomFetchError,
  type HttpGet,
} from './cap-atom.adapter';

const caps = new CapParser();
const sampleCap = readFileSync(
  join(__dirname, '../../../fixtures/cap/sample-hurricane.xml'),
  'utf8',
);
const sampleAtom = readFileSync(
  join(__dirname, '../../../fixtures/cap/sample-atom-feed.xml'),
  'utf8',
);

const nwsConfig = {
  key: 'nws',
  type: 'cap-atom' as const,
  url: 'https://api.weather.gov/alerts/active.atom',
  intervalSec: 60,
  tier: 'A' as const,
  lang: 'en-US',
};

function jsonResponse(
  body: string,
  init?: { status?: number; headers?: Record<string, string> },
): Response {
  const status = init?.status ?? 200;
  // HTTP 304 must not carry a body; the Response constructor rejects one.
  return new Response(status === 304 ? null : body, {
    status,
    headers: {
      'content-type': 'application/atom+xml',
      ...init?.headers,
    },
  });
}

function headerRecord(init?: RequestInit): Record<string, string> {
  const headers = init?.headers;
  if (!headers || headers instanceof Headers || Array.isArray(headers)) {
    return {};
  }
  return headers;
}

describe('CapAtomAdapter', () => {
  it('binds key and tier from source config', () => {
    const adapter = new CapAtomAdapter(nwsConfig, caps);
    expect(adapter.key).toBe('nws');
    expect(adapter.tier).toBe('A');
    expect(adapter.type).toBe('cap-atom');
    expect(adapter.intervalSec).toBe(60);
  });

  it('returns no items on HTTP 304', async () => {
    const httpGet: HttpGet = () =>
      Promise.resolve(jsonResponse('', { status: 304 }));
    const adapter = new CapAtomAdapter(nwsConfig, caps, { httpGet });
    await expect(
      adapter.fetch({
        etag: '"abc"',
        lastModified: 'Wed, 15 Aug 2024 22:30:00 GMT',
      }),
    ).resolves.toEqual([]);
  });

  it('fetches a bare CAP document as one raw item and normalizes it', async () => {
    const httpGet: HttpGet = (url, init) => {
      expect(url).toBe(nwsConfig.url);
      const headers = headerRecord(init);
      expect(headers['User-Agent']).toContain('GlobalEmergencyMonitor');
      expect(headers['If-None-Match']).toBe('"etag-1"');
      return Promise.resolve(
        jsonResponse(sampleCap, {
          headers: {
            'content-type': 'application/cap+xml',
            etag: '"etag-1"',
            'last-modified': 'Wed, 15 Aug 2024 22:30:00 GMT',
          },
        }),
      );
    };

    const adapter = new CapAtomAdapter(nwsConfig, caps, { httpGet });
    const items = await adapter.fetch({ etag: '"etag-1"' });
    expect(items).toHaveLength(1);
    expect(items[0].etag).toBe('"etag-1"');
    expect(items[0].lastModified).toBe('Wed, 15 Aug 2024 22:30:00 GMT');

    const alerts = adapter.normalize(items[0]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({
      source: 'nws',
      tier: 'A',
      event: 'Hurricane Warning',
      severity: 'Extreme',
    });
  });

  it('extracts embedded CAP from Atom entries', async () => {
    const httpGet: HttpGet = () =>
      Promise.resolve(
        jsonResponse(sampleAtom, {
          headers: { 'content-type': 'application/atom+xml' },
        }),
      );
    const adapter = new CapAtomAdapter(nwsConfig, caps, { httpGet });
    const items = await adapter.fetch();
    expect(items).toHaveLength(1);
    expect(items[0].sourceUrl).toBe(
      'https://example.com/alerts/sample-hurricane-001',
    );

    const [alert] = adapter.normalize(items[0]);
    expect(alert.id).toContain('sample-hurricane-001');
    expect(alert.headline).toBe('Hurricane Warning for the sample coast');
  });

  it('follows a CAP link when the Atom entry has no embedded alert', async () => {
    const feed = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>urn:oid:linked</id>
    <link href="https://example.com/cap/1.xml" rel="alternate" type="application/cap+xml"/>
    <title>Linked</title>
  </entry>
</feed>`;

    const httpGet: HttpGet = (url) => {
      if (url === nwsConfig.url) {
        return Promise.resolve(jsonResponse(feed));
      }
      expect(url).toBe('https://example.com/cap/1.xml');
      return Promise.resolve(
        jsonResponse(sampleCap, {
          headers: { 'content-type': 'application/cap+xml' },
        }),
      );
    };

    const adapter = new CapAtomAdapter(nwsConfig, caps, { httpGet });
    const items = await adapter.fetch();
    expect(items).toHaveLength(1);
    expect(items[0].sourceUrl).toBe('https://example.com/cap/1.xml');
    expect(adapter.normalize(items[0])[0].event).toBe('Hurricane Warning');
  });

  it('sends conditional headers and fails on HTTP errors', async () => {
    const httpGet: HttpGet = () =>
      Promise.resolve(jsonResponse('nope', { status: 503 }));
    const adapter = new CapAtomAdapter(nwsConfig, caps, { httpGet });
    await expect(adapter.fetch()).rejects.toBeInstanceOf(CapAtomFetchError);
  });

  it('can create two instances with different keys from the same class', () => {
    const nws = new CapAtomAdapter(nwsConfig, caps);
    const wmo = new CapAtomAdapter(
      {
        key: 'wmo-hub',
        type: 'cap-atom',
        url: 'https://example.com/wmo.atom',
        intervalSec: 300,
        tier: 'C',
      },
      caps,
    );
    expect(nws.key).toBe('nws');
    expect(wmo.key).toBe('wmo-hub');
    expect(wmo.tier).toBe('C');
    expect(wmo.intervalSec).toBe(300);
  });
});
