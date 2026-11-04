import { STATUS_CODES } from 'http';
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { DomainError, DomainErrorCode } from '../../domain/errors';

const DOMAIN_HTTP: Record<DomainErrorCode, number> = {
  LOAN_NOT_FOUND: 404,
  PAYMENT_NOT_FOUND: 404,
  UNKNOWN_TRANSACTION: 404,
  LOAN_ALREADY_PAID: 409,
  AMOUNT_MISMATCH: 409,
  CURRENCY_MISMATCH: 422,
  AMOUNT_EXCEEDS_BALANCE: 422,
};

const nameOf = (status: number) => (STATUS_CODES[status] ?? 'Error').toUpperCase().replace(/\W+/g, '_');

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (exception instanceof DomainError) {
      return res.status(DOMAIN_HTTP[exception.code] ?? 400).json({ error: exception.code, message: exception.message });
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body: any = exception.getResponse();
      if (body && typeof body === 'object' && body.code) {
        const { code, ...rest } = body;
        return res.status(status).json({ error: code, ...rest });
      }
      return res.status(status).json({ error: nameOf(status), message: typeof body === 'string' ? body : body?.message });
    }

    // Errors from the JSON body parser (invalid JSON, body too large)
    const status = exception?.status ?? exception?.statusCode;
    if (typeof status === 'number' && status >= 400 && status < 500) {
      const error = exception.type === 'entity.parse.failed' ? 'INVALID_JSON'
        : exception.type === 'entity.too.large' ? 'PAYLOAD_TOO_LARGE' : nameOf(status);
      return res.status(status).json({ error, message: exception.message });
    }

    // Anything else = our failure: 500 so the caller (e.g. provider) retries
    this.logger.error(`unhandled error: ${exception?.message}`, exception?.stack);
    return res.status(500).json({ error: 'INTERNAL_ERROR', message: 'Temporary failure, please retry' });
  }
}