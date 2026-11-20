import type { AlertTier } from './normalize-alert.model';

/**
 * Adapter implementation keys. Only `cap-atom` is implemented today;
 * other types are accepted in sources.yaml so aggregators can be seeded early.
 */
export const SOURCE_ADAPTER_TYPES = [
  'cap-atom',
  'usgs-geojson',
  'wmo-swic-directory',
  'ifrc-graphql',
  'gdacs-rss',
  'reliefweb-json',
  'eonet-json',
  'copernicus-ems-json',
] as const;
export type SourceAdapterType = (typeof SOURCE_ADAPTER_TYPES)[number];

export interface SourceConfig {
  key: string;
  type: SourceAdapterType;
  url: string;
  intervalSec: number;
  tier: AlertTier;
  license?: string;
  lang?: string;
  enabled?: boolean;
}
