import { IsBoolean, IsIn, IsInt, IsNumberString, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

export class ListAdsDto {
  /** viewer intent: BUY = I want to buy USDT (shows SELL ads) */
  @IsOptional() @IsIn(['BUY', 'SELL']) side?: 'BUY' | 'SELL' = 'BUY';
  @IsOptional() @IsString() @MaxLength(20) bank?: string;
  @IsOptional() @IsString() @MaxLength(20) region?: string;
  @IsOptional() @IsNumberString() amount?: string;
  @IsOptional() @IsNumberString() priceMin?: string;
  @IsOptional() @IsNumberString() priceMax?: string;
  @IsOptional() @IsIn(['1', '0', 'true', 'false']) online?: string;
  @IsOptional() @IsIn(['1', '0', 'true', 'false']) verifiedOnly?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) limit?: number = 20;
}

export class CreateAdDto {
  @IsIn(['BUY', 'SELL']) side: 'BUY' | 'SELL';
  @IsNumberString() price: string;
  @IsNumberString() minAmountFiat: string;
  @IsNumberString() maxAmountFiat: string;
  @IsNumberString() totalAmount: string;
  @IsString() @MaxLength(20) bankCode: string;
  @IsOptional() @IsString() @MaxLength(20) region?: string;
  @IsOptional() @IsString() @MaxLength(600) terms?: string;
  @IsOptional() @IsString() @MaxLength(300) autoReply?: string;
  @IsOptional() @IsInt() @Min(10) @Max(60) paymentWindowMin?: number;
  @IsOptional() @IsInt() @Min(0) @Max(1000) minCompletedOrders?: number;
}

export class UpdateAdDto {
  @IsOptional() @IsNumberString() price?: string;
  @IsOptional() @IsNumberString() minAmountFiat?: string;
  @IsOptional() @IsNumberString() maxAmountFiat?: string;
  @IsOptional() @IsNumberString() totalAmount?: string;
  @IsOptional() @IsString() @MaxLength(600) terms?: string;
  @IsOptional() @IsString() @MaxLength(300) autoReply?: string;
  @IsOptional() @IsIn(['ACTIVE', 'PAUSED', 'CLOSED']) status?: 'ACTIVE' | 'PAUSED' | 'CLOSED';
}

export class CreateOrderDto {
  @IsString() adId: string;
  @IsOptional() @IsNumberString() amountFiat?: string;
  @IsOptional() @IsNumberString() amountUsdt?: string;
  @IsOptional() @IsString() paymentMethodId?: string;
  @IsBoolean() agreedToRules: boolean;
}

export class DeclarePaymentDto {
  @IsString() @MaxLength(20) bankCode: string;
  @IsBoolean() ownAccountConfirmed: boolean;
  @IsBoolean() exactAmountConfirmed: boolean;
  @IsBoolean() nameAndBankConfirmed: boolean;
  @IsOptional() @IsString() receiptFileId?: string;
}

export class ReleaseDto {
  @IsBoolean() checkedBankApp: boolean;
  @IsBoolean() senderNameMatches: boolean;
  @IsBoolean() amountMatches: boolean;
  @IsOptional() @IsString() @MaxLength(400) stepUpToken?: string;
  @IsOptional() @IsString() @Matches(/^\d{6}$/) otpCode?: string;
}

export class CancelOrderDto {
  @IsOptional() @IsString() @MaxLength(300) reason?: string;
}

export class OpenDisputeDto {
  @IsIn(['NOT_RECEIVED', 'WRONG_AMOUNT', 'NAME_MISMATCH', 'THIRD_PARTY_PAYMENT', 'SELLER_NOT_RELEASING', 'OTHER']) reason: string;
  @IsString() @MinLength(10) @MaxLength(2000) description: string;
  @IsOptional() @IsString({ each: true }) evidenceFileIds?: string[];
}

export class RateDto {
  @IsInt() @Min(1) @Max(5) stars: number;
  @IsOptional() @IsString() @MaxLength(300) comment?: string;
}

export class SendMessageDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(2000) text?: string;
  @IsOptional() @IsString() fileId?: string;
}
