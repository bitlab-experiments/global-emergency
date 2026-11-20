import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { AlertsRepository } from '../modules/alerts/alerts.repository';

export const ALERT_EXPIRY_QUEUE = 'alert-expiry';

@Processor(ALERT_EXPIRY_QUEUE)
export class AlertExpiryProcessor extends WorkerHost {
  private readonly logger = new Logger(AlertExpiryProcessor.name);

  constructor(private readonly alerts: AlertsRepository) {
    super();
  }

  async process(): Promise<void> {
    const expired = await this.alerts.expireDue();
    if (expired > 0) {
      this.logger.log(`Marked ${expired} alert(s) expired`);
    }
  }
}
