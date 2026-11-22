import type { NextFunction, Request, Response } from 'express';
import type { UserRole } from '@awaaz/shared';
import { AppError } from '../security/errors';

export type Permission =
  | 'case:create'
  | 'case:read_own_or_authorized'
  | 'case:update_answers'
  | 'case:submit'
  | 'case:analyze'
  | 'document:upload'
  | 'document:read'
  | 'rag:query'
  | 'voice:use'
  | 'consent:grant'
  | 'consent:withdraw'
  | 'consent:read'
  | 'officer:queue'
  | 'officer:decide'
  | 'officer:request_info'
  | 'mock_payment:create'
  | 'mock_payment:read'
  | 'admin:rules_manage'
  | 'admin:users_manage'
  | 'admin:policies_manage'
  | 'admin:metrics_read'
  | 'audit:read';

const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<Permission>> = {
  citizen: new Set<Permission>([
    'case:create',
    'case:read_own_or_authorized',
    'case:update_answers',
    'case:submit',
    'case:analyze',
    'document:upload',
    'document:read',
    'rag:query',
    'voice:use',
    'consent:grant',
    'consent:withdraw',
    'consent:read',
    'mock_payment:read',
  ]),
  helper: new Set<Permission>([
    'case:create',
    'case:read_own_or_authorized',
    'case:update_answers',
    'case:submit',
    'case:analyze',
    'document:upload',
    'document:read',
    'rag:query',
    'voice:use',
    'consent:read',
    'mock_payment:read',
  ]),
  officer: new Set<Permission>([
    'case:read_own_or_authorized',
    'case:analyze',
    'document:read',
    'rag:query',
    'consent:read',
    'officer:queue',
    'officer:decide',
    'officer:request_info',
    'mock_payment:create',
    'mock_payment:read',
  ]),
  admin: new Set<Permission>([
    'case:read_own_or_authorized',
    'case:analyze',
    'document:read',
    'rag:query',
    'voice:use',
    'consent:read',
    'officer:queue',
    'officer:decide',
    'officer:request_info',
    'mock_payment:create',
    'mock_payment:read',
    'admin:rules_manage',
    'admin:users_manage',
    'admin:policies_manage',
    'admin:metrics_read',
    'audit:read',
  ]),
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

export function requireRoles(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(new AppError(401, 'UNAUTHORIZED', 'Authentication is required.'));
      return;
    }
    if (!roles.includes(req.auth.role)) {
      next(
        new AppError(
          403,
          'FORBIDDEN_ROLE',
          `Role '${req.auth.role}' is not permitted to access this resource.`,
        ),
      );
      return;
    }
    next();
  };
}

export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(new AppError(401, 'UNAUTHORIZED', 'Authentication is required.'));
      return;
    }
    if (!hasPermission(req.auth.role, permission)) {
      next(
        new AppError(
          403,
          'FORBIDDEN_PERMISSION',
          `Missing required permission '${permission}' for role '${req.auth.role}'.`,
        ),
      );
      return;
    }
    next();
  };
}
