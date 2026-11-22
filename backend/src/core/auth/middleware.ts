import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../security/errors';
import type { AuthService } from './auth-service';

export const SESSION_COOKIE_NAME = 'awaaz_session';

export function extractBearerOrCookieToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }
  const cookieToken = req.cookies?.[SESSION_COOKIE_NAME];
  if (typeof cookieToken === 'string' && cookieToken.trim()) {
    return cookieToken.trim();
  }
  return null;
}

export function createAuthMiddleware(authService: AuthService) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = extractBearerOrCookieToken(req);
      if (!token) {
        throw new AppError(401, 'UNAUTHORIZED', 'Authentication token is required.');
      }
      const requestedOrgId =
        typeof req.headers['x-organization-id'] === 'string'
          ? req.headers['x-organization-id'].trim()
          : undefined;
      req.auth = await authService.resolveAuthContext(token, requestedOrgId || undefined);
      next();
    } catch (err) {
      next(err);
    }
  };
}
