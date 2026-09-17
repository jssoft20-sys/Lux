import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class UpdateMeDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(24) @Matches(/^[\p{L}\p{N}_ .-]+$/u, { message: 'Недопустимые символы в имени' }) nickname?: string;
  @IsOptional() @IsIn(['ru', 'ky', 'en']) language?: string;
}

export class CreatePaymentMethodDto {
  @IsString() @MaxLength(20) bankCode: string;
  @IsString() @MinLength(6) @MaxLength(32) accountNumber: string;
}

export class SupportTicketDto {
  @IsString() @MinLength(3) @MaxLength(120) subject: string;
  @IsString() @MinLength(5) @MaxLength(2000) message: string;
  @IsOptional() @IsString() orderId?: string;
}
