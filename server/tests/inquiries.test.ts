import 'dotenv/config';
import assert from 'node:assert/strict';
import { before, beforeEach, afterEach, after, test } from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import pg from 'pg';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { createPrismaClient } from '../src/lib/prisma.js';
import { hashPassword } from '../src/lib/password.js';
import type { AppConfig } from '../src/config.js';

// Test fixtures live only in this random schema, never in development tables.
const schema = `inquiry_test_${randomUUID().replaceAll('-', '')}`;
const origin = 'http://localhost:5173';
const staffA = { id: randomUUID(), email: 'inquiry-a@example.test' };
const staffB = { id: randomUUID(), email: 'inquiry-b@example.test' };
const password = 'inquiry-fixture-only-password';
let admin: pg.Pool;
let db: ReturnType<typeof createPrismaClient>;
let config: AppConfig;
let runtime: ReturnType<typeof createApp> | undefined;
let cookieA: string;
let cookieB: string;
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
      const root = new URL('../prisma/migrations/', import.meta.url);
      const names = (await readdir(root, { withFileTypes: true }))
        .filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
      for (const name of names) await client.query(await readFile(new URL(`${name}/migration.sql`, root), 'utf8'));
      for (const staff of [staffA, staffB]) {
        await client.query('INSERT INTO "Staff" (id, email, "passwordHash") VALUES ($1, $2, $3)',
          [staff.id, staff.email, await hashPassword(password)]);
      }
    } finally {
      await client.query('RESET search_path');
      client.release();
    }
    const url = new URL(connectionString);
    url.searchParams.set('schema', schema);
    config = { databaseUrl: url.toString(), sessionSecret: randomBytes(32).toString('hex'),
      trustedOrigins: [origin], production: false, trustProxy: false };
    db = createPrismaClient(config.databaseUrl);
  } catch {
    throw new Error('Inquiry test setup failed. Check database connectivity and permission to create an isolated schema.');
  }
});

async function login(email: string) {
  const response = await request(runtime!.app).post('/api/auth/login').set('Origin', origin).send({ email, password }).expect(200);
  const headers = response.headers['set-cookie'];
  assert.ok(Array.isArray(headers), 'Expected session cookie.');
  const cookie = headers.find(value => value.startsWith('inquiry.sid='));
  assert.ok(cookie, 'Expected named session cookie.');
  return cookie.split(';')[0];
}

beforeEach(async () => {
  await db.inquiry.deleteMany();
  await admin.query(`DELETE FROM "${schema}"."session"`);
  runtime = createApp(config);
  cookieA = await login(staffA.email);
  cookieB = await login(staffB.email);
});
afterEach(async () => { await runtime?.close(); runtime = undefined; });
after(async () => {
  await db?.$disconnect();
  if (schemaCreated && /^inquiry_test_[a-f0-9]{32}$/.test(schema)) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin?.end();
});

function input(overrides: Record<string, unknown> = {}) {
  return { customerName: 'Ada Customer', email: 'ada@example.test', subject: 'Network failure',
    description: 'The router loses its connection.', submissionKey: randomUUID(), ...overrides };
}
function create(body: Record<string, unknown> = input(), cookie = cookieA) {
  return request(runtime!.app).post('/api/inquiries').set('Origin', origin).set('Cookie', cookie).send(body);
}
function read(id: string, cookie = cookieA) {
  return request(runtime!.app).get(`/api/inquiries/${id}`).set('Cookie', cookie);
}
function list(search = '', cookie = cookieA) {
  return request(runtime!.app).get('/api/inquiries').query({ search }).set('Cookie', cookie);
}
function patch(id: string, expectedStatus: string, status: string, cookie = cookieA) {
  return request(runtime!.app).patch(`/api/inquiries/${id}/status`).set('Origin', origin)
    .set('Cookie', cookie).send({ expectedStatus, status });
}

test('all inquiry endpoints reject unauthenticated requests', async () => {
  const id = randomUUID();
  await request(runtime!.app).post('/api/inquiries').set('Origin', origin).send(input()).expect(401);
  await request(runtime!.app).get('/api/inquiries').expect(401);
  await request(runtime!.app).get(`/api/inquiries/${id}`).expect(401);
  await request(runtime!.app).patch(`/api/inquiries/${id}/status`).set('Origin', origin)
    .send({ expectedStatus: 'NEW', status: 'IN_PROGRESS' }).expect(401);
});

test('only the session owner can list, read or update; inaccessible records share the missing-record 404', async () => {
  const created = await create().expect(201);
  const id = created.body.inquiry.id;
  assert.equal((await db.inquiry.findUniqueOrThrow({ where: { id }, select: { createdById: true } })).createdById, staffA.id);
  assert.deepEqual((await list('', cookieB).expect(200)).body, { inquiries: [] });
  assert.deepEqual((await list('Ada', cookieB).expect(200)).body, { inquiries: [] });
  const otherRead = await read(id, cookieB).expect(404);
  const missingRead = await read(randomUUID(), cookieB).expect(404);
  assert.deepEqual(otherRead.body, missingRead.body);
  const otherUpdate = await patch(id, 'NEW', 'IN_PROGRESS', cookieB).expect(404);
  const missingUpdate = await patch(randomUUID(), 'NEW', 'IN_PROGRESS', cookieB).expect(404);
  assert.deepEqual(otherUpdate.body, missingUpdate.body);
  assert.deepEqual(otherUpdate.body, otherRead.body);
  // Even a disallowed transition must not disclose another owner's record.
  await patch(id, 'NEW', 'RESOLVED', cookieB).expect(404);
  assert.equal((await read(id).expect(200)).body.inquiry.status, 'NEW');
});

test('malformed IDs return clear 400 errors on reads and status updates', async () => {
  const result = await read('not-a-uuid').expect(400);
  assert.equal(result.body.error.code, 'INVALID_ID');
  assert.equal((await patch('not-a-uuid', 'NEW', 'IN_PROGRESS').expect(400)).body.error.code, 'INVALID_ID');
  const malformedEncoding = await read('%E0%A4%A').expect(400);
  assert.equal(malformedEncoding.body.error.code, 'INVALID_ID');
});

test('NUL text is rejected as validation instead of reaching PostgreSQL', async () => {
  for (const field of ['customerName', 'subject', 'description']) {
    const response = await create(input({ [field]: 'before\u0000after' })).expect(400);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
    assert.ok(response.body.error.fields[field]);
  }
  const response = await list('before\u0000after').expect(400);
  assert.equal(response.body.error.code, 'VALIDATION_ERROR');
  assert.equal(await db.inquiry.count(), 0);
});

test('database rejects missing contacts and blank required text independently of the API', async () => {
  const created = await create().expect(201);
  const id = created.body.inquiry.id;
  for (const data of [
    { email: null, phone: null }, { email: '  ', phone: '\t\n' },
    { customerName: '  ' }, { subject: '\t\n' }, { description: '' },
  ]) {
    await assert.rejects(db.inquiry.update({ where: { id }, data }));
  }
  assert.equal((await read(id).expect(200)).body.inquiry.customerName, 'Ada Customer');
});

test('creation requires text, valid contacts and UUID key and rejects client ownership or status', async () => {
  const invalid = [
    { customerName: '   ' }, { subject: '' }, { description: '\n ' },
    { email: undefined, phone: undefined }, { email: ' ', phone: null },
    { email: 'invalid-email' }, { email: null, phone: 'abc' },
    { email: null, phone: '+12' }, { email: null, phone: '1'.repeat(16) },
    { email: 'valid@example.test', phone: 'invalid-phone' },
    { email: 'invalid', phone: '+1 415 555 1234' },
    { submissionKey: 'invalid' }, { submissionKey: undefined },
    { customerName: 123 }, { email: 123 }, { phone: 123 },
    { customerName: 'x'.repeat(121) }, { subject: 'x'.repeat(201) }, { description: 'x'.repeat(5001) },
    { email: `${'a'.repeat(245)}@example.test` }, { phone: '1' + ' '.repeat(40) + '2' },
    { createdById: staffB.id }, { status: 'RESOLVED' }, { status: 'NEW' },
  ];
  for (const values of invalid) {
    const response = await create(input(values)).expect(400);
    assert.equal(response.body.error.code, 'VALIDATION_ERROR');
    assert.ok(response.body.error.fields);
  }
  assert.equal(await db.inquiry.count(), 0);
});

test('valid creation normalizes fields, returns NEW and can be retrieved with timestamps', async () => {
  const payload = input({ customerName: ' Ada Customer ', email: ' ADA@EXAMPLE.TEST ', phone: ' ',
    subject: ' Network failure ', description: '\nThe router loses its connection.  ' });
  const result = await create(payload).expect(201);
  const inquiry = result.body.inquiry;
  assert.equal(result.headers.location, `/api/inquiries/${inquiry.id}`);
  assert.equal(inquiry.customerName, 'Ada Customer');
  assert.equal(inquiry.email, 'ada@example.test');
  assert.equal(inquiry.phone, null);
  assert.equal(inquiry.subject, 'Network failure');
  assert.equal(inquiry.description, 'The router loses its connection.');
  assert.equal(inquiry.status, 'NEW');
  assert.ok(Number.isFinite(Date.parse(inquiry.createdAt)) && Number.isFinite(Date.parse(inquiry.updatedAt)));
  assert.deepEqual((await read(inquiry.id).expect(200)).body, result.body);
  assert.equal((await read(inquiry.id.toUpperCase()).expect(200)).body.inquiry.id, inquiry.id);
  assert.equal(result.headers['cache-control'], 'no-store');
});

test('phone-only, email-only, both contacts and exact text limits are accepted', async () => {
  const phoneOnly = await create(input({ email: null, phone: ' +1 (415) 555-1234 ' })).expect(201);
  assert.equal(phoneOnly.body.inquiry.email, null);
  assert.equal(phoneOnly.body.inquiry.phone, '+1 (415) 555-1234');
  await create(input({ email: 'valid@example.test', phone: '+44 20 7946 0958' })).expect(201);
  await create(input({ customerName: 'n'.repeat(120), subject: 's'.repeat(200), description: 'd'.repeat(5000) })).expect(201);
});

test('listing searches customer or subject case-insensitively and returns empty matches', async () => {
  const first = await create(input({ customerName: 'Alice Smith', subject: 'Router Issue' })).expect(201);
  await create(input({ customerName: 'Bob Jones', subject: 'Monitor Issue' })).expect(201);
  await create(input({ customerName: 'Alice Private', subject: 'Router Private' }), cookieB).expect(201);
  for (const term of ['aLiCe', 'rOuTeR', '  Router  ']) {
    const result = await list(term).expect(200);
    assert.deepEqual(result.body.inquiries.map((row: { id: string }) => row.id), [first.body.inquiry.id]);
    assert.ok(!('description' in result.body.inquiries[0]), 'List should return compact summaries.');
  }
  assert.deepEqual((await list('not-found').expect(200)).body, { inquiries: [] });
  assert.equal((await list('').expect(200)).body.inquiries.length, 2);
  await list('x'.repeat(201)).expect(400);
  await request(runtime!.app).get('/api/inquiries?search=a&search=b').set('Cookie', cookieA).expect(400);
});

test('listing is newest-first with ID descending to break tied creation timestamps', async () => {
  const records = await Promise.all([create().expect(201), create().expect(201), create().expect(201)]);
  const ids = records.map(result => result.body.inquiry.id as string).sort().reverse();
  await db.inquiry.updateMany({ data: { createdAt: new Date('2026-01-01T00:00:00Z') } });
  assert.deepEqual((await list().expect(200)).body.inquiries.map((row: { id: string }) => row.id), ids);
  const newestId = ids[2];
  await db.inquiry.update({ where: { id: newestId }, data: { createdAt: new Date('2026-02-01T00:00:00Z') } });
  assert.equal((await list().expect(200)).body.inquiries[0].id, newestId);
});

test('search treats percent, underscore and backslash as literal characters', async () => {
  const special = await create(input({ subject: '100%_router\\test' })).expect(201);
  await create(input({ subject: '100 percent router test' })).expect(201);
  for (const term of ['%', '_', '\\']) {
    assert.deepEqual((await list(term).expect(200)).body.inquiries.map((row: { id: string }) => row.id), [special.body.inquiry.id]);
  }
});

test('matching duplicate retries return the existing inquiry even after status changes', async () => {
  const payload = input();
  const initial = await create(payload).expect(201);
  const id = initial.body.inquiry.id;
  const retry = await create({ ...payload, customerName: ' Ada Customer ', email: 'ADA@EXAMPLE.TEST', phone: null,
    submissionKey: payload.submissionKey.toUpperCase() }).expect(200);
  assert.equal(retry.body.inquiry.id, id);
  await patch(id, 'NEW', 'IN_PROGRESS').expect(200);
  const afterStatus = await create(payload).expect(200);
  assert.equal(afterStatus.body.inquiry.id, id);
  assert.equal(afterStatus.body.inquiry.status, 'IN_PROGRESS');
  assert.equal(await db.inquiry.count(), 1);
  // The same UUID is independent for another owner.
  const other = await create(payload, cookieB).expect(201);
  assert.notEqual(other.body.inquiry.id, id);
});

test('reusing a submission key with changed creation fields conflicts without changing the record', async () => {
  const payload = input();
  const initial = await create(payload).expect(201);
  for (const changed of [{ customerName: 'Other Customer' }, { email: 'other@example.test' },
    { phone: '+1 415 555 1234' }, { subject: 'Other subject' }, { description: 'Other description' }]) {
    const conflict = await create({ ...payload, ...changed }).expect(409);
    assert.equal(conflict.body.error.code, 'SUBMISSION_KEY_CONFLICT');
  }
  assert.deepEqual((await read(initial.body.inquiry.id).expect(200)).body, initial.body);
  assert.equal(await db.inquiry.count(), 1);
});

test('simultaneous identical submissions create exactly one row', async () => {
  const payload = input();
  const results = await Promise.all(Array.from({ length: 6 }, () => create(payload)));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 200, 200, 200, 200, 201]);
  assert.equal(new Set(results.map(result => result.body.inquiry.id)).size, 1);
  assert.equal(await db.inquiry.count({ where: { createdById: staffA.id, submissionKey: payload.submissionKey } }), 1);
});

test('only the three allowed status transitions succeed; all other pairs conflict', async () => {
  const statuses = ['NEW', 'IN_PROGRESS', 'RESOLVED'] as const;
  const allowed = new Set(['NEW:IN_PROGRESS', 'IN_PROGRESS:RESOLVED', 'RESOLVED:IN_PROGRESS']);
  const created = await create().expect(201);
  const id = created.body.inquiry.id;
  for (const from of statuses) {
    for (const to of statuses) {
      await db.inquiry.update({ where: { id }, data: { status: from } });
      const valid = allowed.has(`${from}:${to}`);
      const result = await patch(id, from, to).expect(valid ? 200 : 409);
      if (!valid) assert.equal(result.body.error.code, 'INVALID_STATUS_TRANSITION');
      assert.equal((await read(id).expect(200)).body.inquiry.status, valid ? to : from);
    }
  }
});

test('status input requires both known statuses and rejects extra ownership fields', async () => {
  const id = (await create().expect(201)).body.inquiry.id;
  for (const body of [{ status: 'IN_PROGRESS' }, { expectedStatus: 'NEW' },
    { expectedStatus: 'UNKNOWN', status: 'IN_PROGRESS' }, { expectedStatus: 'NEW', status: 'UNKNOWN' },
    { expectedStatus: 'NEW', status: 'IN_PROGRESS', createdById: staffB.id }]) {
    await request(runtime!.app).patch(`/api/inquiries/${id}/status`).set('Origin', origin).set('Cookie', cookieA).send(body).expect(400);
  }
  assert.equal((await read(id).expect(200)).body.inquiry.status, 'NEW');
});

test('stale expectedStatus is rejected without overwriting the current state', async () => {
  const id = (await create().expect(201)).body.inquiry.id;
  await patch(id, 'NEW', 'IN_PROGRESS').expect(200);
  await patch(id, 'IN_PROGRESS', 'RESOLVED').expect(200);
  const stale = await patch(id, 'NEW', 'IN_PROGRESS').expect(409);
  assert.equal(stale.body.error.code, 'STALE_STATUS');
  assert.equal((await read(id).expect(200)).body.inquiry.status, 'RESOLVED');
});

test('simultaneous status writes with the same expectation have one winner', async () => {
  const id = (await create().expect(201)).body.inquiry.id;
  const results = await Promise.all([patch(id, 'NEW', 'IN_PROGRESS'), patch(id, 'NEW', 'IN_PROGRESS')]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  assert.equal(results.find(result => result.status === 409)!.body.error.code, 'STALE_STATUS');
  assert.equal((await read(id).expect(200)).body.inquiry.status, 'IN_PROGRESS');
});
