import { IsIn, IsNumberString, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

export class CreateWithdrawalDto {
  @IsIn(['TRON']) network: 'TRON';
  @IsString() @Length(34, 34) @Matches(/^T[1-9A-HJ-NP-Za-km-z]{33}$/, { message: 'Неверный TRON-адрес' }) address: string;
  @IsNumberString({}, { message: 'Сумма должна быть числом' }) amount: string;
  @IsOptional() @IsString() @MaxLength(40) label?: string;
  @IsOptional() @IsString() @MaxLength(400) stepUpToken?: string;
}

export class QuoteWithdrawalDto {
  @IsIn(['TRON']) network: 'TRON';
  @IsNumberString() amount: string;
}

export class ConfirmWithdrawalDto {
  @IsString() @Matches(/^\d{6}$/) code: string;
}
