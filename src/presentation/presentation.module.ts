import { Module } from '@nestjs/common';
import { ApplicationModule } from '../application/application.module';
import { InfrastructureModule } from '../infrastructure/infrastructure.module';
import { CallbacksController } from './controllers/callbacks.controller';
import { HealthController } from './controllers/health.controller';
import { LoansController } from './controllers/loans.controller';
import { PaymentsController } from './controllers/payments.controller';
import { ApiKeyGuard } from './guards/api-key.guard';
import { CallbackSignatureGuard } from './guards/callback-signature.guard';
import { ReconciliationScheduler } from './jobs/reconciliation.scheduler';

@Module({
  imports: [ApplicationModule, InfrastructureModule],
  controllers: [CallbacksController, LoansController, PaymentsController, HealthController],
  providers: [ApiKeyGuard, CallbackSignatureGuard, ReconciliationScheduler],
})
export class PresentationModule {}