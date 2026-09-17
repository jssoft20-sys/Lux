import { HttpException, HttpStatus } from '@nestjs/common';

/** Domain error with a stable machine-readable code for clients. */
export class DomainError extends HttpException {
  constructor(code: string, message: string, status: HttpStatus = HttpStatus.BAD_REQUEST, extra?: Record<string, unknown>) {
    super({ code, message, ...extra }, status);
  }
}

export const E = {
  notFound: (what = 'Объект') => new DomainError('NOT_FOUND', `${what} не найден`, HttpStatus.NOT_FOUND),
  forbidden: (msg = 'Нет доступа') => new DomainError('FORBIDDEN', msg, HttpStatus.FORBIDDEN),
  unauthorized: (msg = 'Требуется авторизация') => new DomainError('UNAUTHORIZED', msg, HttpStatus.UNAUTHORIZED),
  bad: (code: string, msg: string, extra?: Record<string, unknown>) => new DomainError(code, msg, HttpStatus.BAD_REQUEST, extra),
  conflict: (code: string, msg: string) => new DomainError(code, msg, HttpStatus.CONFLICT),
  tooMany: (msg = 'Слишком много запросов. Попробуйте позже', retryAfter?: number) =>
    new DomainError('RATE_LIMITED', msg, HttpStatus.TOO_MANY_REQUESTS, { retryAfter }),
  locked: (code: string, msg: string) => new DomainError(code, msg, HttpStatus.LOCKED),
};
