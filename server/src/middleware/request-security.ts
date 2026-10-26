import type { RequestHandler } from 'express';
import { ApiError } from '../lib/errors.js';

export function requireTrustedJson(trustedOrigins: string[]): RequestHandler {
  return (request, _response, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return next();
    const origin = request.get('origin');
    if (!origin || !trustedOrigins.includes(origin)) {
      return next(new ApiError(403, 'UNTRUSTED_ORIGIN', 'A trusted Origin header is required.'));
    }
    if (!request.is('application/json')) {
      return next(new ApiError(415, 'JSON_REQUIRED', 'Content-Type must be application/json.'));
    }
    next();
  };
}
