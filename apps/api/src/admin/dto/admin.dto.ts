import { IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsNumberString, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';

export class AdminLoginDto {
  @IsEmail() email: string;
  @IsString() @MinLength(8) @MaxLength(128) password: string;
}
export class AdminTotpDto {
  @IsString() tmpToken: string;
  @IsString() @Matches(/^\d{6}$/) code: string;
}
export class AdminTotpEnableDto {
  @IsString() @Matches(/^\d{6}$/) code: string;
}
export class AdminRefreshDto {
  @IsOptional() @IsString() refreshToken?: string;
}
export class AdminChangePasswordDto {
  @IsString() currentPassword: string;
  @IsString() @MinLength(12) @MaxLength(128) newPassword: string;
}
export class CreateAdminDto {
  @IsEmail() email: string;
  @IsString() @MinLength(2) @MaxLength(60) name: string;
  @IsIn(['SUPERADMIN', 'COMPLIANCE', 'FINANCE', 'RISK', 'SUPPORT', 'VIEWER']) role: string;
  @IsString() @MinLength(12) @MaxLength(128) password: string;
  @IsOptional() @IsArray() @IsString({ each: true }) ipAllowlist?: string[];
}
export class UpdateAdminDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(60) name?: string;
  @IsOptional() @IsIn(['SUPERADMIN', 'COMPLIANCE', 'FINANCE', 'RISK', 'SUPPORT', 'VIEWER']) role?: string;
  @IsOptional() @IsIn(['ACTIVE', 'DISABLED']) status?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) ipAllowlist?: string[];
  @IsOptional() @IsString() @MinLength(12) @MaxLength(128) password?: string;
}

export class ReasonDto {
  @IsString() @MinLength(3) @MaxLength(500) reason: string;
}
export class NoteDto {
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
export class UserLimitsDto {
  @IsOptional() @IsIn(['BASIC', 'VERIFIED', 'ADVANCED']) kycLevel?: string;
  @IsOptional() @IsBoolean() withdrawalsFrozen?: boolean;
  @IsOptional() @IsBoolean() tradingFrozen?: boolean;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}
export class BalanceAdjustDto {
  @IsNumberString() delta: string;
  @IsString() @MinLength(5) @MaxLength(500) reason: string;
}
export class KycDecisionDto {
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsOptional() @IsIn(['VERIFIED', 'ADVANCED']) level?: string;
}
export class KycRejectDto {
  @IsString() @MinLength(3) @MaxLength(500) reason: string;
}
export class ResolveDisputeDto {
  @IsIn(['RELEASE', 'REFUND', 'PARTIAL']) resolution: 'RELEASE' | 'REFUND' | 'PARTIAL';
  @IsString() @MinLength(5) @MaxLength(2000) note: string;
  @IsOptional() @IsNumberString() buyerAmount?: string;
}
export class RiskReviewDto {
  @IsIn(['CONFIRMED_FRAUD', 'FALSE_POSITIVE', 'NOTED']) status: string;
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
export class RiskRuleDto {
  @IsOptional() @IsInt() @Min(0) @Max(100) weight?: number;
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() params?: Record<string, unknown>;
}
export class BlacklistDto {
  @IsIn(['PHONE', 'WALLET_ADDRESS', 'DOCUMENT', 'IP', 'DEVICE', 'BANK_ACCOUNT', 'NAME']) type: string;
  @IsString() @MinLength(2) @MaxLength(200) value: string;
  @IsString() @MinLength(3) @MaxLength(500) reason: string;
  @IsOptional() @IsString() expiresAt?: string;
}
export class SettingsUpdateDto {
  values: Record<string, string>;
}
export class BankUpdateDto {
  @IsOptional() @IsBoolean() enabled?: boolean;
  @IsOptional() @IsInt() order?: number;
  @IsOptional() @IsBoolean() showsSenderName?: boolean;
  @IsOptional() @IsString() @MaxLength(80) name?: string;
}
export class RateDto {
  @IsNumberString() price: string;
}
export class SimulateDepositDto {
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsString() @MaxLength(32) phone?: string;
  @IsNumberString() amount: string;
  @IsOptional() @IsString() @MaxLength(64) fromAddress?: string;
}
export class TicketAnswerDto {
  @IsString() @MinLength(2) @MaxLength(3000) answer: string;
  @IsOptional() @IsIn(['ANSWERED', 'CLOSED']) status?: string;
}
export class AdminListQuery {
  @IsOptional() @IsString() @MaxLength(120) q?: string;
  @IsOptional() @IsString() @MaxLength(40) status?: string;
  @IsOptional() @IsString() @MaxLength(40) type?: string;
  @IsOptional() @IsString() @MaxLength(40) kyc?: string;
  @IsOptional() @IsString() @MaxLength(40) action?: string;
  @IsOptional() @IsString() userId?: string;
  @IsOptional() @IsString() from?: string;
  @IsOptional() @IsString() to?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) minRisk?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number = 25;
}
