import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse, ApiBody, ApiConflictResponse, ApiHeader, ApiInternalServerErrorResponse,
  ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiTags, ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { ApplyStatusCommand } from '../../application/commands';
import { ReceiveCallbackUseCase } from '../../application/receive-callback.use-case';
import { toCents } from '../../domain/money';
import { PaymentCallbackDto } from '../dto/requests.dto';
import { CallbackAckDto, ErrorResponseDto } from '../dto/responses.dto';
import { CallbackSignatureGuard } from '../guards/callback-signature.guard';

@ApiTags('Provider callbacks')
@Controller('callbacks')
export class CallbacksController {
  constructor(private readonly receive: ReceiveCallbackUseCase) {}

  @Post('payments')
  @HttpCode(200)
  @UseGuards(CallbackSignatureGuard)
  @ApiOperation({
    summary: 'Payment notification callback (called by MTN / Airtel)',
    description:
      'Idempotent: the same callback can be sent many times and is applied once (duplicates return 200). ' +
      'Returns 500 on temporary failures so the provider retries; the event is stored and re-applied by a background worker.',
  })
  @ApiHeader({ name: 'x-signature', required: true, description: 'Hex HMAC-SHA256 of the raw request body' })
  @ApiBody({ type: PaymentCallbackDto })
  @ApiOkResponse({ type: CallbackAckDto, description: 'Processed (APPLIED) or already processed (DUPLICATE)' })
  @ApiBadRequestResponse({ type: ErrorResponseDto, description: 'Invalid JSON, unknown provider or validation failed' })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto, description: 'Invalid signature' })
  @ApiNotFoundResponse({ type: ErrorResponseDto, description: 'Unknown transaction' })
  @ApiConflictResponse({ type: ErrorResponseDto, description: 'Amount/currency does not match the original request' })
  @ApiInternalServerErrorResponse({ type: ErrorResponseDto, description: 'Temporary failure, provider should retry' })
  async handle(@Body() dto: PaymentCallbackDto, @Req() req: Request) {
    const command: ApplyStatusCommand = {
      provider: dto.provider,
      transactionId: dto.transactionId,
      status: dto.data.status,
      amountCents: toCents(dto.data.amount),
      currency: dto.data.currency,
      timestamp: dto.data.timestamp,
      reason: dto.data.reason,
    };
    const out = await this.receive.execute({ raw: req.body, command });
    return { status: 'OK', result: out.result, transactionId: dto.transactionId };
  }
}