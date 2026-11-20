import { Test, TestingModule } from '@nestjs/testing';
import { SourceFetchService } from './source-fetch.service';

describe('SourceFetchService', () => {
  let service: SourceFetchService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [SourceFetchService],
    }).compile();

    service = module.get<SourceFetchService>(SourceFetchService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
