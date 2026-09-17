import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface AuthUser {
  id: string;
  phone: string;
  sessionId: string;
  deviceId?: string;
  kycLevel: string;
  status: string;
}

export interface AuthAdmin {
  id: string;
  email: string;
  role: string;
  sessionId: string;
}

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest().user;
});

export const CurrentAdmin = createParamDecorator((_data: unknown, ctx: ExecutionContext): AuthAdmin => {
  return ctx.switchToHttp().getRequest().admin;
});
