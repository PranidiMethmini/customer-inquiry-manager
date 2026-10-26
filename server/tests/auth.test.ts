import 'dotenv/config';
import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';
import request from 'supertest';
import { createApp } from '../src/app.js';
import type { AppConfig } from '../src/config.js';
import { readConfig } from '../src/config.js';
import { hashPassword } from '../src/lib/password.js';

// Only this randomly named schema is created/removed. Never seed or truncate public.
const schema = `auth_test_${randomUUID().replaceAll('-', '')}`;
const origin = 'http://localhost:5173';
const credentials = { email: 'auth-fixture@example.test', password: 'fixture-only-password' };
const staffId = randomUUID();
let admin: pg.Pool;
let config: AppConfig;
let schemaCreated = false;

before(async () => {
  const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!connectionString) throw new Error('Set DATABASE_URL or TEST_DATABASE_URL for PostgreSQL integration tests.');
  admin = new pg.Pool({ connectionString, connectionTimeoutMillis: 5000 });
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    const client = await admin.connect();
    try {
      await client.query(`SET search_path TO "${schema}"`);
      const migrationRoot = new URL('../prisma/migrations/', import.meta.url);
      const names = (await readdir(migrationRoot, { withFileTypes: true }))
        .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
      for (const name of names) {
        await client.query(await readFile(new URL(`${name}/migration.sql`, migrationRoot), 'utf8'));
      }
      await client.query('INSERT INTO "Staff" (id, email, "passwordHash") VALUES ($1, $2, $3)',
        [staffId, credentials.email, await hashPassword(credentials.password)]);
    } finally {
      await client.query('RESET search_path');
      client.release();
    }
    const testUrl = new URL(connectionString);
    testUrl.searchParams.set('schema', schema);
    config = {
      databaseUrl: testUrl.toString(), sessionSecret: randomBytes(32).toString('hex'),
      trustedOrigins: [origin], production: false, trustProxy: false,
    };
  } catch {
    throw new Error('Test database setup failed. Check connectivity and permission to create an isolated schema.');
  }
});

beforeEach(async () => { await admin.query(`DELETE FROM "${schema}"."session"`); });
after(async () => {
  if (schemaCreated && /^auth_test_[a-f0-9]{32}$/.test(schema)) {
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  }
  await admin?.end();
});

function sessionCookie(response: request.Response): string {
  const cookies = response.headers['set-cookie'];
  assert.ok(Array.isArray(cookies), 'Expected a session cookie.');
  const cookie = cookies.find(value => value.startsWith('inquiry.sid='));
  assert.ok(cookie, 'Expected the named session cookie.');
  return cookie.split(';')[0];
}

test('configuration requires a nonempty strong secret and explicit trusted origins', () => {
  assert.throws(() => readConfig({ DATABASE_URL: config.databaseUrl }), /SESSION_SECRET/);
  assert.throws(() => readConfig({ DATABASE_URL: config.databaseUrl, SESSION_SECRET: config.sessionSecret }), /TRUSTED_ORIGINS/);
});

test('current-user rejects anonymous and tampered sessions', async t => {
  const runtime = createApp(config);
  t.after(() => runtime.close());
  const anonymous = await request(runtime.app).get('/api/auth/me').expect(401);
  assert.equal(anonymous.body.error.code, 'UNAUTHENTICATED');
  assert.ok(!anonymous.headers['set-cookie'], 'Anonymous requests must not create sessions.');
  await request(runtime.app).get('/api/auth/me').set('Cookie', 'inquiry.sid=tampered').expect(401);
});

test('client request errors use safe JSON and no-store even before authentication', async t => {
  const runtime = createApp(config);
  t.after(() => runtime.close());
  for (const response of [
    await request(runtime.app).get('/api/inquiries').expect(401),
    await request(runtime.app).post('/api/auth/login').send({}).expect(403),
    await request(runtime.app).post('/api/auth/login').set('Origin', origin)
      .set('Content-Type', 'application/json; charset=unsupported').send('{}').expect(415),
  ]) {
    assert.equal(response.headers['cache-control'], 'no-store');
    assert.ok(response.body.error.code);
    assert.ok(!response.body.error.stack);
  }
});

test('unknown email and wrong password have identical generic errors', async t => {
  const runtime = createApp(config);
  t.after(() => runtime.close());
  const wrong = await request(runtime.app).post('/api/auth/login').set('Origin', origin)
    .send({ ...credentials, password: 'wrong-password' }).expect(401);
  const unknown = await request(runtime.app).post('/api/auth/login').set('Origin', origin)
    .send({ email: 'unknown@example.test', password: credentials.password }).expect(401);
  assert.deepEqual(wrong.body, { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' } });
  assert.deepEqual(unknown.body, wrong.body);
  const count = await admin.query(`SELECT count(*)::int AS count FROM "${schema}"."session"`);
  assert.equal(count.rows[0].count, 0);
});

test('login validates fields, JSON, and explicit trusted Origins', async t => {
  const runtime = createApp(config);
  t.after(() => runtime.close());
  for (const path of ['/api/auth/login', '/api/auth/logout']) {
    await request(runtime.app).post(path).send({}).expect(403);
    await request(runtime.app).post(path).set('Origin', 'null').send({}).expect(403);
    await request(runtime.app).post(path).set('Origin', 'http://localhost:5173.evil.test').send({}).expect(403);
    await request(runtime.app).post(path).set('Origin', origin).type('form').send('email=test').expect(415);
  }
  const validation = await request(runtime.app).post('/api/auth/login').set('Origin', origin)
    .send({ email: 'invalid', password: '' }).expect(400);
  assert.equal(validation.body.error.code, 'VALIDATION_ERROR');
  assert.ok(validation.body.error.fields.email && validation.body.error.fields.password);
  const malformed = await request(runtime.app).post('/api/auth/login').set('Origin', origin)
    .type('json').send('{invalid').expect(400);
  assert.equal(malformed.body.error.code, 'INVALID_JSON');
});

test('login persists in PostgreSQL, survives app recreation, and logout invalidates cookie replay', async t => {
  const first = createApp(config);
  let firstClosed = false;
  t.after(async () => { if (!firstClosed) await first.close(); });
  const login = await request(first.app).post('/api/auth/login').set('Origin', origin)
    .send({ ...credentials, email: ' AUTH-FIXTURE@EXAMPLE.TEST ' }).expect(200);
  assert.deepEqual(login.body, { staff: { id: staffId, email: credentials.email } });
  assert.equal(login.headers['cache-control'], 'no-store');
  const cookie = sessionCookie(login);
  const header = (login.headers['set-cookie'] as unknown as string[])[0];
  assert.ok(header.includes('HttpOnly') && header.includes('SameSite=Lax') && header.includes('Path=/'));
  const stored = await admin.query(`SELECT sess, expire FROM "${schema}"."session"`);
  assert.equal(stored.rows.length, 1);
  assert.ok(stored.rows[0].sess.staffId === staffId, 'Session must contain the fixture staff ID.');
  assert.ok(!('passwordHash' in stored.rows[0].sess), 'Session must not contain a password hash.');
  const remaining = new Date(stored.rows[0].expire).getTime() - Date.now();
  // connect-pg-simple rounds expiration up to the next whole second.
  assert.ok(remaining > 7.9 * 60 * 60 * 1000 && remaining <= 8 * 60 * 60 * 1000 + 1000,
    'Stored expiry must be eight hours away, allowing the store one second of rounding.');
  await first.close();
  firstClosed = true;
  const second = createApp(config);
  t.after(() => second.close());
  const me = await request(second.app).get('/api/auth/me').set('Cookie', cookie).expect(200);
  assert.deepEqual(me.body, { staff: { id: staffId, email: credentials.email } });
  const logout = await request(second.app).post('/api/auth/logout').set('Origin', origin)
    .set('Cookie', cookie).send({}).expect(204);
  assert.ok((logout.headers['set-cookie'] as unknown as string[]).some(value => value.startsWith('inquiry.sid=;')));
  await request(second.app).get('/api/auth/me').set('Cookie', cookie).expect(401);
  const remainingRows = await admin.query(`SELECT count(*)::int AS count FROM "${schema}"."session"`);
  assert.equal(remainingRows.rows[0].count, 0);
});

test('signing in again regenerates the session and invalidates the old cookie', async t => {
  const runtime = createApp(config);
  t.after(() => runtime.close());
  const first = await request(runtime.app).post('/api/auth/login').set('Origin', origin).send(credentials).expect(200);
  const oldCookie = sessionCookie(first);
  const second = await request(runtime.app).post('/api/auth/login').set('Origin', origin)
    .set('Cookie', oldCookie).send(credentials).expect(200);
  const newCookie = sessionCookie(second);
  assert.ok(oldCookie !== newCookie, 'Session ID must rotate.');
  await request(runtime.app).get('/api/auth/me').set('Cookie', oldCookie).expect(401);
  await request(runtime.app).get('/api/auth/me').set('Cookie', newCookie).expect(200);
});

test('expired PostgreSQL sessions are rejected', async t => {
  const runtime = createApp(config);
  t.after(() => runtime.close());
  const login = await request(runtime.app).post('/api/auth/login').set('Origin', origin).send(credentials).expect(200);
  await admin.query(`UPDATE "${schema}"."session" SET expire = NOW() - INTERVAL '1 minute'`);
  await request(runtime.app).get('/api/auth/me').set('Cookie', sessionCookie(login)).expect(401);
});

test('HTTPS behind an explicitly trusted local proxy sets Secure cookies', async t => {
  const httpsOrigin = 'https://assessment.example.test';
  const runtime = createApp({ ...config, production: true, trustProxy: 'loopback', trustedOrigins: [httpsOrigin] });
  t.after(() => runtime.close());
  const login = await request(runtime.app).post('/api/auth/login').set('Origin', httpsOrigin)
    .set('X-Forwarded-Proto', 'https').send(credentials).expect(200);
  const cookies = login.headers['set-cookie'] as unknown as string[];
  assert.ok(cookies.some(value => value.includes('; Secure')));
});

test('login attempts are limited per IP with a JSON error', async t => {
  const runtime = createApp(config);
  t.after(() => runtime.close());
  for (let index = 0; index < 10; index++) {
    await request(runtime.app).post('/api/auth/login').set('Origin', origin)
      .send({ ...credentials, password: 'wrong' }).expect(401);
  }
  const blocked = await request(runtime.app).post('/api/auth/login').set('Origin', origin).send(credentials).expect(429);
  assert.equal(blocked.body.error.code, 'RATE_LIMITED');
  assert.ok(blocked.headers['retry-after']);
});
