import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import type { PrismaClient } from '../generated/prisma/client.js';
import { ApiError } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { requireAuth } from '../middleware/auth.js';
import { parseInput } from '../lib/validation.js';

export const SESSION_COOKIE_NAME = 'inquiry.sid';
export const COOKIE_SCOPE = { path: '/', httpOnly: true, sameSite: 'lax' as const };

const loginInput = z.object({
  email: z.string().trim().max(254).email('Enter a valid email address.').transform(value => value.toLowerCase()),
  // Never trim passwords: spaces can be intentional.
  password: z.string().min(1, 'Enter your password.').max(256, 'Password is too long.'),
}).strict();

export function authRouter(prisma: PrismaClient) {
  const router = Router();
  const dummyHash = hashPassword('not-a-user-password');
  const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_request, response) => {
      response.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many sign-in attempts. Try again in 15 minutes.' } });
    },
  });
  router.post('/login', limiter, async (request, response) => {
    const { email, password } = parseInput(loginInput, request.body, 'Check your email and password.');
    const staff = await prisma.staff.findUnique({ where: { email } });
    // Unknown accounts still perform scrypt; never expose account existence.
    const valid = await verifyPassword(password, staff?.passwordHash ?? await dummyHash);
    if (!staff || !valid) throw new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
    await new Promise<void>((resolve, reject) => request.session.regenerate(error => error ? reject(error) : resolve()));
    request.session.staffId = staff.id;
    request.session.authenticatedAt = Date.now();
    // Await PostgreSQL persistence before reporting success.
    await new Promise<void>((resolve, reject) => request.session.save(error => error ? reject(error) : resolve()));
    response.json({ staff: { id: staff.id, email: staff.email } });
  });
  router.post('/logout', async (request, response) => {
    await new Promise<void>((resolve, reject) => request.session.destroy(error => error ? reject(error) : resolve()));
    response.clearCookie(SESSION_COOKIE_NAME, COOKIE_SCOPE);
    response.status(204).end();
  });
  router.get('/me', requireAuth(prisma), (request, response) => { response.json({ staff: request.staff }); });
  return router;
}
