import 'dotenv/config';
import assert from 'node:assert/strict';
import { createPrismaClient } from '../src/lib/prisma.js';
import { verifyPassword } from '../src/lib/password.js';
import { demoAccounts } from './demo-accounts.js';

const prisma = createPrismaClient();
try {
  assert.equal(await prisma.staff.count(), 2, 'Expected exactly two staff accounts in the assessment database.');
  for (const account of demoAccounts) {
    const staff = await prisma.staff.findUniqueOrThrow({ where: { email: account.email } });
    assert.ok(await verifyPassword(account.password, staff.passwordHash), 'Demo password verification failed.');
  }
  console.log('Verified exactly two staff accounts and both demo passwords; hashes omitted.');
} catch {
  console.error('Seed verification failed. Check database connectivity, migrations, and the two demo accounts.');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
