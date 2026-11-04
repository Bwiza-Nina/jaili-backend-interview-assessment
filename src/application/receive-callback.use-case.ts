import { Inject, Injectable, Logger } from '@nestjs/common';
import { DomainError } from '../domain/errors';
import { CALLBACK_EVENT_REPOSITORY, CallbackEventRepository } from '../domain/ports';
import { ApplyPaymentStatusUseCase } from './apply-payment-status.use-case';
import { ApplyResult, ApplyStatusCommand } from './commands';

@Injectable()
export class ReceiveCallbackUseCase {
  private readonly logger = new Logger(ReceiveCallbackUseCase.name);

  constructor(
    @Inject(CALLBACK_EVENT_REPOSITORY) private readonly events: CallbackEventRepository,
    private readonly apply: ApplyPaymentStatusUseCase,
  ) {}

  async execute(input: { raw: unknown; command: ApplyStatusCommand }): Promise<ApplyResult> {
    const { command } = input;

    // Persist the event FIRST: even if processing crashes, the provider's claim is on disk
    const eventId = await this.events.insert(
      command.provider,
      command.transactionId,
      JSON.stringify({ raw: input.raw, command }),
    );

    try {
      const out = await this.apply.execute(command);
      await this.events.mark(eventId, out.result, true);
      return out; // 200 for APPLIED and DUPLICATE: provider must stop retrying
    } catch (err) {
      if (err instanceof DomainError) {
        // unknown txn / amount mismatch: needs a human, retrying will not help
        await this.events.mark(eventId, err.code, true, err.message);
        throw err;
      }
      // Technical failure (e.g. DB): transaction already rolled back.
      // processed=0 + ERROR => the worker re-applies it; we return 500 so the provider retries too.
      await this.events.mark(eventId, 'ERROR', false, err?.message).catch(() => undefined);
      this.logger.error(`callback processing failed txn=${command.transactionId}: ${err?.message}`);
      throw err;
    }
  }
}