import type { FetchContext } from '../../common/models/fetch-context.model';
import type {
  AlertTier,
  NormalizedAlert,
} from '../../common/models/normalize-alert.model';
import type { RawItem } from '../../common/models/raw-item.model';
import type { SourceAdapterType } from '../../common/models/source-config.model';

export const SOURCE_ADAPTERS = Symbol('SOURCE_ADAPTERS');

export interface SourceAdapter {
  key: string;
  tier: AlertTier;
  type: SourceAdapterType;
  url: string;
  intervalSec: number;
  fetch(ctx: FetchContext): Promise<RawItem[]>;
  normalize(item: RawItem): NormalizedAlert[];
}
