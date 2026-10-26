import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parse } from 'dotenv';
import pg from 'pg';
import { chromium, type Page } from 'playwright';
import { createServer } from 'vite';
import { createApp } from '../../server/src/app.js';
import { hashPassword } from '../../server/src/lib/password.js';
import { createPrismaClient } from '../../server/src/lib/prisma.js';

// Browser QA uses real Express/PostgreSQL, without touching development records.
const root = fileURLToPath(new URL('../../', import.meta.url));
const schema = `ui_test_${randomUUID().replaceAll('-', '')}`;
const origin = 'http://127.0.0.1:5180';
const email = `browser.${'support'.repeat(5)}@regional.assessment.example.test`;
const longSubject = 'Intermittent office connectivity during video calls and remote support sessions. '.repeat(2).trim();
const password = randomBytes(18).toString('hex');
const screenshots = join(root, 'artifacts', 'ui');
let stage = 'database setup';

async function checkPage(page: Page, label: string, width: number) {
  await page.evaluate(() => document.fonts.ready);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.ok(!overflow, `${label} must not overflow at ${width}px.`);
  if (await page.locator('.app-shell').count()) {
    const main = await page.locator('#main-content').boundingBox();
    const header = await page.locator('.header-inner').boundingBox();
    const footer = await page.locator('.app-footer').boundingBox();
    assert.ok(main && header && footer, 'Shared layout regions must exist.');
    assert.ok(Math.abs(main.x - header.x) < 1 && Math.abs(main.width - header.width) < 1 && Math.abs(footer.x - main.x) < 1, 'Header, content and footer must share container alignment.');
    assert.ok(footer.y >= main.y + main.height - 1, 'Footer must follow rather than cover main content.');
    if (width === 1440) {
      const headerBox = await page.locator('.app-header').boundingBox();
      assert.ok(headerBox && headerBox.height >= 70 && headerBox.height <= 74, 'Desktop header should be approximately 72px high.');
    }
  }
  // A static JS string avoids transpiler helpers being captured by page.evaluate.
  const lowContrast = await page.evaluate(String.raw`(() => {
    function rgb(value) { return value.match(/[\d.]+/g)?.slice(0, 3).map(Number); }
    function luminance(color) {
      return color.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
        .reduce((total, value, index) => total + value * [.2126, .7152, .0722][index], 0);
    }
    return [...document.querySelectorAll('.page-description, .field-hint, .eyebrow, .date-cell, .list-footnote, dt, .detail-meta, .status-badge')]
      .filter(element => element.getClientRects().length > 0).some(element => {
        const foreground = rgb(getComputedStyle(element).color);
        let parent = element;
        while (parent && getComputedStyle(parent).backgroundColor === 'rgba(0, 0, 0, 0)') parent = parent.parentElement;
        const background = rgb(parent ? getComputedStyle(parent).backgroundColor : 'rgb(247, 246, 242)');
        const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
        return (values[0] + .05) / (values[1] + .05) < 4.5;
      });
  })()`);
  assert.ok(!lowContrast, `${label} muted text and status labels must meet a 4.5:1 contrast ratio.`);
  await page.screenshot({ path: join(screenshots, `${width}-${label}.png`), fullPage: true });
  console.log(`Checked ${label} at ${width}px: no horizontal overflow.`);
}

async function run() {
  const env = parse(await readFile(join(root, 'server', '.env'), 'utf8').catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return '';
    throw error;
  }));
  const connectionString = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? env.DATABASE_URL;
  if (!connectionString) throw new Error('Database configuration is required.');
  const admin = new pg.Pool({ connectionString, connectionTimeoutMillis: 5000 });
  let schemaCreated = false;
  let runtime: ReturnType<typeof createApp> | undefined;
  let listener: ReturnType<ReturnType<typeof createApp>['app']['listen']> | undefined;
  let vite: Awaited<ReturnType<typeof createServer>> | undefined;
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  let db: ReturnType<typeof createPrismaClient> | undefined;
  try {
    await admin.query(`CREATE SCHEMA "${schema}"`);
    schemaCreated = true;
    const client = await admin.connect();
    try {
      await client.query(`SET search_path TO "${schema}"`);
      const migrations = join(root, 'server', 'prisma', 'migrations');
      const names = (await readdir(migrations, { withFileTypes: true })).filter(entry => entry.isDirectory()).map(entry => entry.name).sort();
      for (const name of names) await client.query(await readFile(join(migrations, name, 'migration.sql'), 'utf8'));
      await client.query('INSERT INTO "Staff" (id, email, "passwordHash") VALUES ($1, $2, $3)', [randomUUID(), email, await hashPassword(password)]);
    } finally {
      await client.query('RESET search_path');
      client.release();
    }
    const testUrl = new URL(connectionString);
    testUrl.searchParams.set('schema', schema);
    db = createPrismaClient(testUrl.toString());
    const staff = await db.staff.findUniqueOrThrow({ where: { email }, select: { id: true } });
    await db.inquiry.createMany({ data: [
      { customerName: 'Morgan Avery', email: 'morgan@example.test', subject: 'Office router keeps disconnecting', description: 'The connection drops during calls.\nStarted after yesterday’s restart.', status: 'NEW' },
      { customerName: 'Jamie Park', email: 'jamie@example.test', subject: 'Help activating a software license', description: 'The activation code is not being accepted.', status: 'IN_PROGRESS' },
      { customerName: 'Cameron Reed', phone: '+1 (415) 555-0184', subject: 'New workstation setup', description: 'Please confirm the workstation is ready.', status: 'RESOLVED' },
    ].map(data => ({ ...data, createdById: staff.id, submissionKey: randomUUID() })) });

    stage = 'local QA servers';
    runtime = createApp({ databaseUrl: testUrl.toString(), sessionSecret: randomBytes(32).toString('hex'), trustedOrigins: [origin], production: false, trustProxy: false });
    listener = runtime.app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => listener!.once('listening', resolve));
    const address = listener.address();
    assert.ok(address && typeof address === 'object');
    process.chdir(join(root, 'client'));
    vite = await createServer({ root: join(root, 'client'), configFile: join(root, 'client', 'vite.config.ts'),
      server: { host: '127.0.0.1', port: 5180, strictPort: true, proxy: { '/api': `http://127.0.0.1:${address.port}` } } });
    await vite.listen();
    await mkdir(screenshots, { recursive: true });
    stage = 'Edge launch';
    browser = await chromium.launch({ channel: 'msedge', headless: true });
    const context = await browser.newContext({ reducedMotion: 'reduce' });
    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', () => pageErrors.push('Unexpected browser runtime error.'));
    let savedId = '';

    for (const width of [375, 768, 1440]) {
      stage = `screens and keyboard at ${width}px`;
      await page.setViewportSize({ width, height: 900 });
      await page.goto(`${origin}/sign-in`);
      await page.getByRole('heading', { name: 'Welcome back' }).waitFor();
      await checkPage(page, 'sign-in', width);
      await page.getByLabel('Email address').focus();
      await page.keyboard.type(email);
      await page.keyboard.press('Tab');
      assert.equal(await page.locator('#password').evaluate(element => document.activeElement === element), true, 'Tab should reach password.');
      await page.keyboard.type(password);
      await page.keyboard.press('Tab');
      assert.equal(await page.getByRole('button', { name: 'Sign in', exact: true }).evaluate(element => document.activeElement === element), true, 'Tab should reach sign-in.');
      await page.keyboard.press('Enter');
      await page.getByRole('heading', { name: 'My inquiries' }).waitFor();
      await page.getByText('Office router keeps disconnecting', { exact: true }).filter({ visible: true }).waitFor();
      const skipLink = page.getByRole('link', { name: 'Skip to content' });
      await skipLink.focus();
      await page.keyboard.press('Enter');
      assert.equal(await page.locator('#main-content').evaluate(element => document.activeElement === element), true, 'Skip link should move focus to main content.');
      await checkPage(page, 'inquiry-list', width);
      assert.ok(await page.locator('.open-link .chevron-right').count() > 0, 'Rendered table links must use the right-chevron icon.');
      assert.ok(!(await page.locator('.open-link').first().textContent())?.includes(String.fromCodePoint(0x2197)), 'Rendered links must not show the northeast arrow.');
      await page.getByLabel('Search inquiries').fill('no-such-customer');
      await page.getByRole('heading', { name: 'No matching inquiries' }).waitFor();
      await page.getByRole('button', { name: 'Clear search' }).click();
      await page.getByText('Office router keeps disconnecting', { exact: true }).filter({ visible: true }).waitFor();
      await page.getByRole('link', { name: 'New inquiry' }).click();
      const breadcrumb = page.getByRole('navigation', { name: 'Breadcrumb' });
      assert.equal(await breadcrumb.locator('[aria-current="page"]').textContent(), 'New inquiry');
      if (width === 375) {
        await page.getByRole('button', { name: 'Save inquiry' }).click();
        await page.getByText('Enter an email address or phone number.', { exact: true }).waitFor();
        const emailDescription = await page.getByLabel('Email address').getAttribute('aria-describedby');
        assert.ok(emailDescription?.includes('contact-hint') && emailDescription.includes('email-error'), 'Contact help and validation must both be associated with the field.');
        await page.waitForFunction(() => document.activeElement?.id === 'customerName');
        await checkPage(page, 'create-validation', width);
        await breadcrumb.getByRole('link', { name: 'My inquiries' }).focus();
        await page.keyboard.press('Enter');
        await page.getByRole('heading', { name: 'My inquiries' }).waitFor();
        await page.getByRole('link', { name: 'New inquiry' }).click();
      }
      await page.getByLabel('Customer name').fill('Taylor Quinn');
      await page.getByLabel('Email address').fill('taylor@example.test');
      await page.getByLabel('Subject', { exact: true }).fill('Laptop cannot connect to the office network');
      await page.getByLabel('Description', { exact: true }).fill('The laptop connects at home, but cannot join the office network.\nPlease check the wireless configuration.');
      assert.equal(await page.getByText('Provide at least one: email or phone.', { exact: true }).count(), 1, 'Contact fields should share one clear hint.');
      for (const label of ['Email address', 'Phone number']) {
        const describedBy = await page.getByLabel(label).getAttribute('aria-describedby');
        assert.ok(describedBy?.split(' ').includes('contact-hint'), 'Each contact field should reference the shared hint.');
      }
      await checkPage(page, 'create-inquiry', width);
      if (!savedId) {
        let releaseSave!: () => void;
        const saveGate = new Promise<void>(resolve => { releaseSave = resolve; });
        await page.route('**/api/inquiries', async route => {
          if (route.request().method() === 'POST') await saveGate;
          await route.continue();
        });
        await page.getByRole('button', { name: 'Save inquiry' }).focus();
        await page.keyboard.press('Enter');
        try {
          const saving = page.getByRole('button', { name: 'Saving inquiry…' });
          await saving.waitFor();
          assert.ok(await saving.isDisabled(), 'Pending creation must disable repeated submission.');
          await checkPage(page, 'create-pending', width);
        } finally { releaseSave(); }
        await page.waitForURL(/\/inquiries\/[0-9a-f-]{36}$/);
        await page.unroute('**/api/inquiries');
        savedId = page.url().split('/').at(-1)!;
      } else await page.goto(`${origin}/inquiries/${savedId}`);
      await page.getByRole('heading', { name: width === 375 ? 'Laptop cannot connect to the office network' : longSubject }).waitFor();
      assert.equal(await page.locator('.breadcrumbs [aria-current="page"]').textContent(), 'Inquiry details');
      assert.equal(await page.locator('.detail-panel').count(), 1, 'Details must use one unified panel.');
      assert.equal(await page.locator('.status-panel').count(), 0, 'The disconnected next-step card must be removed.');
      const actionArea = await page.locator('.detail-actions').boundingBox();
      const detailPanel = await page.locator('.detail-panel').boundingBox();
      assert.ok(actionArea && detailPanel && actionArea.y + actionArea.height <= detailPanel.y, 'Status controls must appear before the detail panel.');
      assert.equal(await page.locator('.detail-meta time').count(), 2, 'Created and updated dates must appear below the subject.');
      const description = await page.locator('.detail-description').boundingBox();
      const customer = await page.locator('.detail-customer').boundingBox();
      assert.ok(description && customer);
      if (width > 700) assert.ok(description.width > customer.width * 1.9 && Math.abs(description.y - customer.y) < 1, 'Desktop details should use approximately 2:1 columns.');
      else assert.ok(description.y + description.height <= customer.y, 'Mobile details must stack description and customer.');
      await checkPage(page, 'inquiry-detail', width);
      if (width === 375) {
        stage = 'real API stale status conflict';
        await page.getByRole('button', { name: 'Start working' }).click();
        await page.getByRole('button', { name: 'Mark as resolved' }).waitFor();
        await db.inquiry.update({ where: { id: savedId }, data: { status: 'RESOLVED' } });
        await page.getByRole('button', { name: 'Mark as resolved' }).click();
        await page.getByText('This inquiry changed. The latest version is shown. Choose a status action again.').waitFor();
        await checkPage(page, 'detail-stale-feedback', width);
        await page.getByRole('button', { name: 'Reopen inquiry' }).waitFor();
        await page.getByRole('button', { name: 'Reopen inquiry' }).click();
        await page.getByRole('button', { name: 'Mark as resolved' }).waitFor();
        // Exercise long content and line breaks in the following viewport checks.
        await db.inquiry.update({ where: { id: savedId }, data: { customerName: 'Customer'.repeat(15), subject: longSubject,
          email: `support.${'contact'.repeat(6)}@customer.example.test`,
          description: 'A long reference value: ' + 'x'.repeat(400) + '\n\nPlease keep these line breaks.' } });
        await page.getByRole('button', { name: 'Refresh', exact: true }).click();
        await page.getByRole('heading', { name: longSubject }).waitFor();
        await checkPage(page, 'detail-long-content', width);
        console.log('Real API creation, allowed status changes, and stale-conflict recovery passed.');
      }
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await page.getByRole('heading', { name: 'Welcome back' }).waitFor();
    }
    stage = 'unavailable detail and empty workspace';
    await page.getByLabel('Email address').fill(email);
    await page.getByLabel('Password').fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('heading', { name: 'My inquiries' }).waitFor();
    await page.goto(`${origin}/inquiries/not-a-uuid`);
    await page.getByRole('heading', { name: 'Inquiry unavailable' }).waitFor();
    await db.inquiry.deleteMany(); // Isolated QA schema only.
    await page.goto(`${origin}/inquiries`);
    await page.getByRole('heading', { name: 'A clear space to start' }).waitFor();
    assert.equal(pageErrors.length, 0, 'Browser should have no uncaught runtime errors.');
    console.log('All 12 responsive screen checks, keyboard sign-in/save, direct links, search, empty and unavailable states passed.');
  } finally {
    await browser?.close();
    await vite?.close();
    if (listener) await new Promise<void>((resolve, reject) => listener!.close(error => error ? reject(error) : resolve()));
    await runtime?.close();
    await db?.$disconnect();
    if (schemaCreated && /^ui_test_[a-f0-9]{32}$/.test(schema)) await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
}

run().catch(error => {
  console.error(`Browser checks failed during ${stage}.`);
  if (error instanceof assert.AssertionError) console.error(error.message);
  process.exitCode = 1;
});
