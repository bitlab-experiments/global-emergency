import { CapParser } from '../cap/cap.module';
import { AdapterRegistry } from './adapter.registry';
import { CapAtomAdapter } from './cap-atom.adapter';
import { createSourceAdapters } from './create-source-adapters';

describe('AdapterRegistry', () => {
  const caps = new CapParser();

  it('registers only enabled adapters that have an implementation', () => {
    const adapters = createSourceAdapters(
      [
        {
          key: 'nws',
          type: 'cap-atom',
          url: 'https://api.weather.gov/alerts/active.atom',
          intervalSec: 60,
          tier: 'A',
          enabled: true,
        },
        {
          key: 'usgs-eq',
          type: 'usgs-geojson',
          url: 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_hour.geojson',
          intervalSec: 60,
          tier: 'B',
          enabled: true,
        },
        {
          key: 'wmo',
          type: 'cap-atom',
          url: 'https://example.com/wmo.atom',
          intervalSec: 300,
          tier: 'C',
          enabled: false,
        },
      ],
      caps,
    );

    expect(adapters).toHaveLength(1);
    expect(adapters[0]).toBeInstanceOf(CapAtomAdapter);
    expect(adapters[0].key).toBe('nws');

    const registry = new AdapterRegistry(adapters);
    expect(registry.require('nws').url).toContain('weather.gov');
    expect(registry.get('usgs-eq')).toBeUndefined();
    expect(registry.get('wmo')).toBeUndefined();
    expect(registry.list()).toHaveLength(1);
  });
});
