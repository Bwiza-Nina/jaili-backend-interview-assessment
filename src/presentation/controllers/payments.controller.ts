import { Controller, Get, Param, ParseIntPipe, Query, UseGuards } from '@nestjs/common';
import {
  ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags, ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { PaymentQueries } from '../../application/payment-queries';
import { ListPaymentsQueryDto } from '../dto/requests.dto';
import { ErrorResponseDto, PaymentListResponseDto, PaymentViewDto } from '../dto/responses.dto';
import { ApiKeyGuard } from '../guards/api-key.guard';
import { toPaymentView } from '../views';

@ApiTags('Payments')
@ApiSecurity('api-key')
@UseGuards(ApiKeyGuard)
@Controller('payments')
export class PaymentsController {
  constructor(private readonly queries: PaymentQueries) {}

  @Get()
  @ApiOperation({ summary: 'List payments (used by the Next.js frontend)' })
  @ApiOkResponse({ type: PaymentListResponseDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  async list(@Query() q: ListPaymentsQueryDto) {
    const { data, total } = await this.queries.listPayments({
      loanId: q.loanId, status: q.status, limit: q.limit, offset: q.offset,
    });
    return { data: data.map(toPaymentView), pagination: { total, limit: q.limit, offset: q.offset } };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Payment details' })
  @ApiOkResponse({ type: PaymentViewDto })
  @ApiUnauthorizedResponse({ type: ErrorResponseDto })
  @ApiNotFoundResponse({ type: ErrorResponseDto })
  async get(@Param('id', ParseIntPipe) id: number) {
    return toPaymentView(await this.queries.getPayment(id));
  }
}