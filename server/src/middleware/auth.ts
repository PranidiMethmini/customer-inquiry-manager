import type { RequestHandler } from 'express';
import type { PrismaClient } from '../generated/prisma/client.js';
import { ApiError } from '../lib/errors.js';

export const SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000;

export function requireAuth(prisma: PrismaClient): RequestHandler {
  return async (request, _response, next) => {
    const { staffId, authenticatedAt } = request.session;
    if (!staffId || !authenticatedAt || Date.now() - authenticatedAt >= SESSION_LIFETIME_MS) {
      return next(new ApiError(401, 'UNAUTHENTICATED', 'Please sign in.'));
    }
    const staff = await prisma.staff.findUnique({ where: { id: staffId }, select: { id: true, email: true } });
    if (!staff) return next(new ApiError(401, 'UNAUTHENTICATED', 'Please sign in.'));
    request.staff = staff;
    next();
  };
}
