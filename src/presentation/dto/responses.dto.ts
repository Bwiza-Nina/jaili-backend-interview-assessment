import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { LoanStatus, PaymentStatus, Provider } from '../../domain/enums';

export class CallbackAckDto {
  @ApiProperty({ example: 'OK' }) status: string;
  @ApiProperty({ enum: ['APPLIED', 'DUPLICATE', 'IGNORED', 'NOOP'] }) result: string;
  @ApiProperty() transactionId: string;
}

export class InitiatePaymentResponseDto {
  @ApiProperty() transactionId: string;
  @ApiProperty({ enum: PaymentStatus, example: 'PENDING' }) status: string;
  @ApiProperty({ enum: ['SENT', 'UNCERTAIN'], description: 'UNCERTAIN = provider timed out, will be reconciled' }) dispatch: string;
}

export class PaymentViewDto {
  @ApiProperty() id: number;
  @ApiProperty() loanId: number;
  @ApiProperty({ enum: Provider }) provider: string;
  @ApiProperty() transactionId: string;
  @ApiPropertyOptional() providerReference?: string | null;
  @ApiProperty({ example: '20000.00' }) amount: string;
  @ApiProperty({ example: 'RWF' }) currency: string;
  @ApiProperty({ enum: PaymentStatus }) status: string;
  @ApiPropertyOptional() failureReason?: string | null;
  @ApiProperty() attempts: number;
  @ApiProperty() createdAt: Date;
  @ApiPropertyOptional() appliedAt?: Date | null;
}

export class PaginationDto {
  @ApiProperty() total: number;
  @ApiProperty() limit: number;
  @ApiProperty() offset: number;
}

export class PaymentListResponseDto {
  @ApiProperty({ type: [PaymentViewDto] }) data: PaymentViewDto[];
  @ApiProperty({ type: PaginationDto }) pagination: PaginationDto;
}

export class LoanViewDto {
  @ApiProperty() id: number;
  @ApiProperty() borrowerName: string;
  @ApiProperty({ example: 'RWF' }) currency: string;
  @ApiProperty({ example: '100000.00' }) principal: string;
  @ApiProperty({ example: '80000.00' }) balance: string;
  @ApiProperty({ example: '0.00' }) pendingAmount: string;
  @ApiProperty({ enum: LoanStatus }) status: string;
}

export class LedgerViewDto {
  @ApiProperty() paymentId: number;
  @ApiProperty() amount: string;
  @ApiProperty() balanceBefore: string;
  @ApiProperty() balanceAfter: string;
  @ApiProperty() createdAt: Date;
}

export class LoanDetailResponseDto {
  @ApiProperty({ type: LoanViewDto }) loan: LoanViewDto;
  @ApiProperty({ type: [LedgerViewDto] }) ledger: LedgerViewDto[];
}

export class ErrorResponseDto {
  @ApiProperty({ example: 'VALIDATION_FAILED' }) error: string;
  @ApiPropertyOptional() message?: string;
  @ApiPropertyOptional({ description: 'Field-level validation problems' }) details?: { path: string; message: string }[];
}