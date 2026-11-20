import { Injectable, Module } from '@nestjs/common';
import { parseCapDocument, type ParseCapOptions } from './cap.parser';
import type { NormalizedAlert } from '../../common/models/normalize-alert.model';

@Injectable()
export class CapParser {
  parse(xml: string, options: ParseCapOptions): NormalizedAlert[] {
    return parseCapDocument(xml, options);
  }
}

@Module({
  providers: [CapParser],
  exports: [CapParser],
})
export class CapModule {}
