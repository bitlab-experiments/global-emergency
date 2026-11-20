import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { AdapterRegistry } from '../modules/adapters/adapter.registry';
import { AlertsRepository } from '../modules/alerts/alerts.repository';

@Processor('source-fetch')
export class SourceFetchService extends WorkerHost {
  constructor(
    private readonly adapters: AdapterRegistry,
    private readonly alertsRepository: AlertsRepository,
  ) {
    super();
  }

  async process(job: Job<{ sourceKey: string }>): Promise<void> {
    const adapter = this.adapters.require(job.data.sourceKey);

    const items = await adapter.fetch({
      now: new Date(),
    });

    const alerts = items.flatMap((item) => adapter.normalize(item));
    if (alerts.length === 0) return;

    await this.alertsRepository.ingest(alerts);
  }
}
