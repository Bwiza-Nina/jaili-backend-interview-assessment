import { Module } from '@nestjs/common';
import { InfrastructureModule } from '../infrastructure/infrastructure.module';
import { ApplyPaymentStatusUseCase } from './apply-payment-status.use-case';
import { InitiatePaymentUseCase } from './initiate-payment.use-case';
import { PaymentQueries } from './payment-queries';
import { ReceiveCallbackUseCase } from './receive-callback.use-case';
import { ReconcileUseCase } from './reconcile.use-case';

const useCases = [
  ApplyPaymentStatusUseCase, InitiatePaymentUseCase, ReceiveCallbackUseCase, ReconcileUseCase, PaymentQueries,
];

@Module({ imports: [InfrastructureModule], providers: useCases, exports: useCases })
export class ApplicationModule {}