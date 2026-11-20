import { Logger } from '@nestjs/common';
import type { SourceConfig } from '../../common/models/source-config.model';
import type { CapParser } from '../cap/cap.module';
import { CapAtomAdapter } from './cap-atom.adapter';
import type { SourceAdapter } from './source-adapter.interface';

const logger = new Logger('SourceAdapters');

/** Builds one adapter instance per enabled source config. */
export function createSourceAdapters(
  configs: SourceConfig[],
  caps: CapParser,
): SourceAdapter[] {
  const adapters: SourceAdapter[] = [];

  for (const config of configs) {
    if (config.enabled === false) {
      logger.log(`Skipping disabled source ${config.key}`);
      continue;
    }

    switch (config.type) {
      case 'cap-atom':
        adapters.push(new CapAtomAdapter(config, caps));
        break;
      case 'usgs-geojson':
      case 'wmo-swic-directory':
      case 'ifrc-graphql':
      case 'gdacs-rss':
      case 'reliefweb-json':
      case 'eonet-json':
      case 'copernicus-ems-json':
        logger.warn(
          `Source ${config.key} uses ${config.type}; adapter not implemented yet`,
        );
        break;
      default: {
        const neverType: never = config.type;
        logger.warn(
          `Unknown source type for ${config.key}: ${String(neverType)}`,
        );
      }
    }
  }

  return adapters;
}
