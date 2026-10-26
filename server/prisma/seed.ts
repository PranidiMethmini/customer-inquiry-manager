import 'dotenv/config';
import { createPrismaClient } from '../src/lib/prisma.js';
import { hashPassword } from '../src/lib/password.js';
import { demoAccounts } from './demo-accounts.js';

const prisma = createPrismaClient();
try {
  const records = await Promise.all(demoAccounts.map(async ({ email, password }) => ({
    email, passwordHash: await hashPassword(password),
  })));
  await prisma.$transaction(records.map(({ email, passwordHash }) =>
    prisma.staff.upsert({
      where: { email },
      create: { email, passwordHash },
      update: { passwordHash },
    }),
  ));
  console.log('Seeded two demo accounts. Existing demo passwords were refreshed.');
} catch {
  console.error('Seed failed. Check the development DATABASE_URL and migrations.');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
