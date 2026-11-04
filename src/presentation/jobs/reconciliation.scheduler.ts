import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ReconcileUseCase } from '../../application/reconcile.use-case';
import { APP_CONFIG, AppConfig } from '../../config/app.config';

// Driving adapter: a timer instead of an HTTP request triggers the use case.
// Safe with several app replicas: every change is idempotent and protected by row locks.
@Injectable()
export class ReconciliationScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ReconciliationScheduler.name);
  private timer?: NodeJS.Timeout;
  private busy = false;

  constructor(private readonly reconcile: ReconcileUseCase, @Inject(APP_CONFIG) private readonly config: AppConfig) {}

  onModuleInit() {
    this.timer = setInterval(() => this.tick(), this.config.worker.intervalMs);
    this.timer.unref();
    this.logger.log('background worker started');
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.busy) return; // no overlapping runs
    this.busy = true;
    try { await this.reconcile.run(); }
    catch (err: any) { this.logger.error(`worker cycle failed: ${err?.message}`); }
    finally { this.busy = false; }
  }
}