import { Inject, Injectable } from '@nestjs/common';
import {
  SOURCE_ADAPTERS,
  type SourceAdapter,
} from './source-adapter.interface';

@Injectable()
export class AdapterRegistry {
  private readonly byKey = new Map<string, SourceAdapter>();

  constructor(@Inject(SOURCE_ADAPTERS) adapters: SourceAdapter[]) {
    for (const adapter of adapters) {
      if (this.byKey.has(adapter.key)) {
        throw new Error(`Duplicate source adapter key "${adapter.key}"`);
      }
      this.byKey.set(adapter.key, adapter);
    }
  }

  get(key: string): SourceAdapter | undefined {
    return this.byKey.get(key);
  }

  require(key: string): SourceAdapter {
    const adapter = this.get(key);
    if (!adapter) {
      throw new Error(`No source adapter registered for key "${key}"`);
    }
    return adapter;
  }

  list(): SourceAdapter[] {
    return [...this.byKey.values()];
  }
}
