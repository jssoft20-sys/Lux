import { SetMetadata } from '@nestjs/common';

export const ADMIN_SCOPE_KEY = 'adminScope';
/** Marks a controller as part of the admin API (skips the global user guard; AdminAuthGuard applies). */
export const AdminScope = () => SetMetadata(ADMIN_SCOPE_KEY, true);
