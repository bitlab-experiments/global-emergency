import { join } from 'path';
import { writeFileSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { loadSourceConfigs } from './load-sources';

describe('loadSourceConfigs', () => {
  it('loads the packaged sources.yaml including national CAP and §3.1 aggregators', () => {
    const configs = loadSourceConfigs();
    const byKey = Object.fromEntries(
      configs.map((config) => [config.key, config]),
    );

    expect(Object.keys(byKey)).toEqual([
      'nws',
      'ca-naad',
      'au-bom',
      'br-inmet',
      'id-bmkg',
      'meteoalarm-uk',
      'meteoalarm-de',
      'meteoalarm-fr',
      'meteoalarm-es',
      'meteoalarm-nl',
      'wmo-alert-hub',
      'wmo-swic',
      'ifrc-alert-hub',
      'gdacs',
      'reliefweb',
      'nasa-eonet',
      'copernicus-ems',
      'usgs-eq',
    ]);

    expect(byKey.nws).toMatchObject({
      type: 'cap-atom',
      tier: 'A',
      enabled: true,
      url: 'https://api.weather.gov/alerts/active.atom',
    });
    expect(byKey['ca-naad']).toMatchObject({
      type: 'cap-atom',
      tier: 'A',
      enabled: true,
      url: 'https://rss.naad-adna.pelmorex.com/',
    });
    expect(byKey['au-bom']).toMatchObject({
      type: 'cap-atom',
      tier: 'A',
      enabled: true,
      url: 'https://severeweather.wmo.int/v2/cap-alerts/au-bom-en/rss.xml',
    });
    expect(byKey['br-inmet']).toMatchObject({
      type: 'cap-atom',
      enabled: true,
      url: 'https://apiprevmet3.inmet.gov.br/avisos/rss',
    });
    expect(byKey['id-bmkg']).toMatchObject({
      type: 'cap-atom',
      enabled: true,
      url: 'https://www.bmkg.go.id/alerts/nowcast/en',
    });
    expect(byKey['meteoalarm-uk']).toMatchObject({
      type: 'cap-atom',
      enabled: true,
      url: 'https://feeds.meteoalarm.org/feeds/meteoalarm-legacy-atom-united-kingdom',
    });
    expect(byKey['wmo-alert-hub']).toMatchObject({
      type: 'cap-atom',
      tier: 'C',
      enabled: true,
      url: 'https://cap-alerts.s3.amazonaws.com/official-public/rss.xml',
    });
    expect(byKey['wmo-swic'].enabled).toBe(false);
    expect(byKey['usgs-eq'].enabled).toBe(false);

    const liveCapAtom = configs.filter(
      (config) => config.type === 'cap-atom' && config.enabled !== false,
    );
    expect(liveCapAtom.map((config) => config.key)).toEqual([
      'nws',
      'ca-naad',
      'au-bom',
      'br-inmet',
      'id-bmkg',
      'meteoalarm-uk',
      'meteoalarm-de',
      'meteoalarm-fr',
      'meteoalarm-es',
      'meteoalarm-nl',
      'wmo-alert-hub',
    ]);
  });

  it('rejects a duplicate key', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ge-sources-'));
    const path = join(dir, 'sources.yaml');
    writeFileSync(
      path,
      `
- key: nws
  type: cap-atom
  url: https://example.com/a.atom
  intervalSec: 60
  tier: A
- key: nws
  type: cap-atom
  url: https://example.com/b.atom
  intervalSec: 60
  tier: A
`,
    );
    expect(() => loadSourceConfigs(path)).toThrow(/Duplicate source key/);
  });
});
