import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsDefined, IsEnum, IsInt, IsISO8601, IsNumber, IsOptional, IsPositive, IsString,
  Length, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { PaymentStatus, Provider } from '../../domain/enums';

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.toUpperCase() : value);

export class CallbackDataDto {
  @ApiProperty({ example: 20000, description: 'Positive, max 2 decimals' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(1_000_000_000_000)
  amount: number;

  @ApiProperty({ example: 'RWF' })
  @Transform(upper)
  @IsString()
  @Length(3, 3)
  currency: string;

  @ApiProperty({ enum: PaymentStatus, example: 'SUCCESS' })
  @Transform(upper)
  @IsEnum(PaymentStatus)
  status: PaymentStatus;

  @ApiProperty({ example: '2026-11-04T13:05:00Z' })
  @IsISO8601()
  timestamp: string;

  @ApiPropertyOptional({ example: 'Insufficient funds' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  reason?: string;
}

export class PaymentCallbackDto {
  @ApiProperty({ enum: Provider, example: 'MTN' })
  @Transform(upper)
  @IsEnum(Provider)
  provider: Provider;

  @ApiProperty({ example: '3f1c9a52-8d2e-4c1b-9b7a-1d2e3f4a5b6c' })
  @IsString()
  @Length(1, 64)
  transactionId: string;

  @ApiProperty({ type: CallbackDataDto })
  @IsDefined()
  @ValidateNested()
  @Type(() => CallbackDataDto)
  data: CallbackDataDto;
}

export class CreatePaymentDto {
  @ApiProperty({ enum: Provider, example: 'MTN' })
  @Transform(upper)
  @IsEnum(Provider)
  provider: Provider;

  @ApiProperty({ example: '250788000000' })
  @Matches(/^\+?\d{9,15}$/, { message: 'msisdn must be a valid phone number' })
  msisdn: string;

  @ApiProperty({ example: 20000 })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  @Max(1_000_000_000_000)
  amount: number;

  @ApiProperty({ example: 'RWF' })
  @Transform(upper)
  @IsString()
  @Length(3, 3)
  currency: string;
}

export class ListPaymentsQueryDto {
  @ApiPropertyOptional({ example: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  loanId?: number;

  @ApiPropertyOptional({ enum: PaymentStatus })
  @IsOptional() @IsEnum(PaymentStatus)
  status?: PaymentStatus;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit: number = 20;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(0)
  offset: number = 0;
}