export interface AppConfig {
  databaseUrl: string;
  sessionSecret: string;
  trustedOrigins: string[];
  production: boolean;
  trustProxy: false | 'loopback';
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const databaseUrl = env.DATABASE_URL;
  const sessionSecret = env.SESSION_SECRET;
  if (!databaseUrl) throw new Error('DATABASE_URL is required.');
  try {
    if (!['postgres:', 'postgresql:'].includes(new URL(databaseUrl).protocol)) throw new Error();
  } catch {
    throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.');
  }
  if (!sessionSecret || Buffer.byteLength(sessionSecret) < 32) {
    throw new Error('SESSION_SECRET must contain at least 32 bytes; generate a random secret.');
  }
  const trustedOrigins = (env.TRUSTED_ORIGINS ?? '').split(',').map(value => value.trim()).filter(Boolean);
  const production = env.NODE_ENV === 'production';
  if (trustedOrigins.length === 0) throw new Error('TRUSTED_ORIGINS is required.');
  for (const origin of trustedOrigins) {
    const url = new URL(origin);
    if (url.origin !== origin || !['http:', 'https:'].includes(url.protocol) ||
        (production && url.protocol !== 'https:')) {
      throw new Error('TRUSTED_ORIGINS must contain exact HTTP(S) origins; production requires HTTPS.');
    }
  }
  if (env.TRUST_PROXY && env.TRUST_PROXY !== 'loopback') {
    throw new Error('TRUST_PROXY must be empty or loopback for the local reverse-proxy design.');
  }
  return { databaseUrl, sessionSecret, trustedOrigins, production, trustProxy: env.TRUST_PROXY ? 'loopback' : false };
}
