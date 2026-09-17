import { IsBoolean, IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

export class DeviceInfoDto {
  @IsOptional() @IsIn(['ios', 'android', 'web']) platform?: string;
  @IsOptional() @IsString() @MaxLength(80) model?: string;
  @IsOptional() @IsString() @MaxLength(40) osVersion?: string;
  @IsOptional() @IsString() @MaxLength(40) appVersion?: string;
  @IsOptional() @IsString() @MaxLength(80) name?: string;
}

export class OtpRequestDto {
  @IsString() @MaxLength(32) phone: string;
  @IsOptional() @IsIn(['LOGIN', 'WITHDRAW', 'RELEASE', 'CHANGE_PHONE']) purpose?: 'LOGIN' | 'WITHDRAW' | 'RELEASE' | 'CHANGE_PHONE';
}

export class OtpVerifyDto {
  @IsString() @MaxLength(32) phone: string;
  @IsString() @Matches(/^\d{6}$/, { message: 'Код состоит из 6 цифр' }) code: string;
  @IsOptional() device?: DeviceInfoDto;
}

export class RefreshDto {
  @IsOptional() @IsString() @Length(20, 512) refreshToken?: string;
}

export class PinDto {
  @IsString() @Matches(/^\d{4,6}$/, { message: 'PIN — 4–6 цифр' }) pin: string;
}

export class BiometricDto {
  @IsBoolean() enabled: boolean;
}
