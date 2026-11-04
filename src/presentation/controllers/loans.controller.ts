import {
  BadGatewayException, Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, UseGuards,
} from '@nestjs/common';
import {
  ApiAcceptedResponse, ApiBadGatewayResponse, ApiBadRequestResponse, ApiConflictResponse, ApiNotFoundResponse,
  ApiOkResponse, ApiOperation, ApiSecurity, ApiTags, ApiUnauthorizedResponse, ApiUnprocessableEntityResponse,
} from '@nestjs/swagger';
import { InitiatePaymentUseCase } from '../../application/initiate-payment.use-case';
import { PaymentQueries } from '../../application/payment-queries';
import { PaymentStatus } from '../../domain/enums';
import { toCents } from '../../domain/money';
import { CreatePaymentDto } from '../dto/requests.dto';
import { ErrorResponseDto, InitiatePaymentResponseDto, LoanDetailResponseDto } from '../dto/responses.dto';
import { ApiKeyGuard } from '../guards/api-key.guard';
import { toLedgerView, toLoanView } from '../views';

@ApiTags('Loans')
@ApiSecurity('api-key')
@UseGuards(ApiKeyGuard)
@Controller('loans')
export class LoansController {
  constructor(private readonly initiate: InitiatePaymentUseCase, private readonly queries: PaymentQueries) {}

  @Post(':loanId/payments')
  @HttpCode(202)
  @ApiOperation({
    summary: 'Start a loan payment (sends a request to MTN / Airtel)',
    description:
      'Creates a PENDING payment, reserves the amount on the loan and records PAYMENT_REQUESTED in the loan system, ' +
      'then calls the provider (3 attempts, exponential backoff, same transaction id). The final result arrives by callback.',
  })
  @ApiAcceptedResponse({ type: InitiatePaymentResponseDto })
  @ApiBadRequestResponse({ type: ErrorResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Loan not found' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Loan already paid' })
  @ApiUnprocessableEntityResponse({ type: ErrorResponseDto, description: 'Amount exceeds payable balance / currency mismatch' })
  @ApiBadGatewayResponse({ type: ErrorResponseDto, description: 'Provider permanently refused the request' })
  async createPayment(@Param('loanId', ParseIntPipe) loanId: number, @Body() dto: CreatePaymentDto) {
    const { transactionId, dispatch } = await this.initiate.execute({
      loanId,
      provider: dto.provider,
      msisdn: dto.msisdn,
      amountCents: toCents(dto.amount),
      currency: dto.currency,
    });
    if (dispatch === 'REJECTED') {
      throw new BadGatewayException({
        code: 'PROVIDER_REJECTED',
        message: 'Provider rejected the payment request',
        transactionId,
        status: PaymentStatus.FAILED,
      });
    }
    return { transactionId, status: PaymentStatus.PENDING, dispatch };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Loan with balance and the latest ledger entries' })
  @ApiOkResponse({ type: LoanDetailResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async getLoan(@Param('id', ParseIntPipe) id: number) {
    const { loan, ledger } = await this.queries.getLoan(id);
    return { loan: toLoanView(loan), ledger: ledger.map(toLedgerView) };
  }
}