import { Module } from '@nestjs/common';
import { loadSourceConfigs } from '../../config/load-sources';
import { CapModule, CapParser } from '../cap/cap.module';
import { AdapterRegistry } from './adapter.registry';
import { createSourceAdapters } from './create-source-adapters';
import { SOURCE_ADAPTERS } from './source-adapter.interface';

@Module({
  imports: [CapModule],
  providers: [
    {
      provide: SOURCE_ADAPTERS,
      useFactory: (caps: CapParser) =>
        createSourceAdapters(loadSourceConfigs(), caps),
      inject: [CapParser],
    },
    AdapterRegistry,
  ],
  exports: [AdapterRegistry, SOURCE_ADAPTERS],
})
export class AdaptersModule {}
