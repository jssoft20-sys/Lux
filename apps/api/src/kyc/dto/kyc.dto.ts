import { IsDateString, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class SandboxCompleteDto {
  @IsString() @MinLength(5) @MaxLength(80) @Matches(/^[\p{L}\s'-]+$/u) fullName: string;
  @IsString() @MinLength(6) @MaxLength(20) documentNumber: string;
  @IsDateString() dateOfBirth: string;
  @IsOptional() @IsIn(['Identity Card', 'Passport']) documentType?: string;
  @IsOptional() @IsIn(['APPROVED', 'DECLINED']) outcome?: 'APPROVED' | 'DECLINED';
}
