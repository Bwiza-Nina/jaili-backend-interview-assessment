import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, AppConfig } from '../config/app.config';
import { PaymentStatus } from '../domain/enums';
import { DomainError } from '../domain/errors';
import {
  CALLBACK_EVENT_REPOSITORY, CallbackEventRepository, PAYMENT_GATEWAYS, PAYMENT_REPOSITORY,
  PaymentGatewayResolver, PaymentRepository,
} from '../domain/ports';
import { ApplyPaymentStatusUseCase } from './apply-payment-status.use-case';

@Injectable()
export class ReconcileUseCase {
  private readonly logger = new Logger(ReconcileUseCase.name);

  constructor(
    @Inject(CALLBACK_EVENT_REPOSITORY) private readonly events: CallbackEventRepository,
    @Inject(PAYMENT_REPOSITORY) private readonly payments: PaymentRepository,
    @Inject(PAYMENT_GATEWAYS) private readonly gateways: PaymentGatewayResolver,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly apply: ApplyPaymentStatusUseCase,
  ) {}

  async run(): Promise<void> {
    await this.reprocessStoredEvents();
    await this.reconcilePending();
  }

  // (a) Re-apply callbacks that were stored but failed to process (e.g. DB hiccup)
  async reprocessStoredEvents(): Promise<void> {
    const events = await this.events.findReprocessable(50);
    for (const e of events) {
      try {
        const command = e.payload?.command;
        if (!command) {
          await this.events.mark(e.id, 'REJECTED', true, 'payload has no command');
          continue;
        }
        const out = await this.apply.execute(command);
        await this.events.mark(e.id, out.result, true);
        this.logger.log(`reprocessed stored callback event=${e.id} result=${out.result}`);
      } catch (err) {
        if (err instanceof DomainError) {
          await this.events.mark(e.id, err.code, true, err.message);
        } else {
          this.logger.error(`reprocess failed event=${e.id}, will retry next cycle: ${err?.message}`);
        }
      }
    }
  }

  // (b) Ask the provider about payments stuck in PENDING (lost callback / timeouts)
  async reconcilePending(): Promise<void> {
    const stale = await this.payments.findStalePending(this.config.worker.pendingTimeoutMin, 50);
    for (const p of stale) {
      try {
        const s = await this.gateways.resolve(p.provider).getStatus(p.transactionId, p.currency);
        if (s.status !== PaymentStatus.PENDING) {
          await this.apply.execute({
            provider: p.provider, transactionId: p.transactionId, status: s.status, reason: s.reason,
          });
          this.logger.log(`reconciled pending payment txn=${p.transactionId} -> ${s.status}`);
        }
      } catch (err) {
        this.logger.warn(`reconcile check failed txn=${p.transactionId}, will retry: ${err?.message}`);
      }
    }
  }
}