import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { AlertsService } from '../services/alerts.service';

/**
 * FR-07: "Expiry check runs as a nightly scheduled job."
 *
 * 2am rather than midnight — midnight is when a restaurant's day-end
 * paperwork and any daily sales import are most likely to be running, and
 * this scan reads every stocked item with a shelf life.
 */
@Injectable()
export class ExpiryScanJob {
  private readonly logger = new Logger(ExpiryScanJob.name);

  constructor(private readonly alertsService: AlertsService) {}

  @Cron(CronExpression.EVERY_DAY_AT_2AM, { name: 'expiry-scan' })
  async run(): Promise<void> {
    try {
      const raised = await this.alertsService.scanForExpiringStock();
      this.logger.log(`Expiry scan complete — ${raised} alert(s) raised`);
    } catch (error) {
      // Same reasoning as the stock listener: a failed scan must not take
      // the process down. Tomorrow's run picks up whatever this one missed,
      // since the scan is derived from current state rather than a cursor.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Expiry scan failed: ${message}`);
    }
  }
}
