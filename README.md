# Customer Inquiry Manager

A small staff workspace using React, TypeScript, Vite, Tailwind CSS, Express,
PostgreSQL and Prisma. Staff sign in, capture customer inquiries, search their
own records and update statuses.

See [DECISIONS.md](DECISIONS.md) for assumptions and trade-offs, and
[Technical notes](docs/TECHNICAL_NOTES.md) for API, security, migration and testing reference.

## Prerequisites

- Node.js 22.16.x and npm 10.x are the verified versions; see package engines.
- PostgreSQL and a dedicated empty assessment database with migration permission.
  Backend/browser tests also require schema-creation permission. Docker is optional.
- Installed Microsoft Edge for the optional browser checks.

## Setup (PowerShell, project root)

```powershell
npm ci
if (-not (Test-Path client/.env)) { Copy-Item client/.env.example client/.env }
if (-not (Test-Path server/.env)) { Copy-Item server/.env.example server/.env }
```

If needed, provision a database using
`psql -h localhost -U postgres -d postgres -W`, then:

```sql
CREATE ROLE inquiry_dev LOGIN;
\password inquiry_dev
CREATE DATABASE customer_inquiry_dev OWNER inquiry_dev;
\q
```

Edit `server/.env`: replace the placeholder `DATABASE_URL` with this database's
connection URL, URL-encoding special password characters. Keep
`TRUSTED_ORIGINS=http://localhost:5173`, `NODE_ENV=development` and `TRUST_PROXY=`
for local development. Preserve existing configuration. Never commit real
`.env` files or put secrets in public client `VITE_*` variables.

Generate a random session secret without displaying it; an existing nonempty
secret is preserved and must already contain at least 32 bytes:

```powershell
@'
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
const path = 'server/.env';
let text = readFileSync(path, 'utf8');
if (!/^SESSION_SECRET=.+$/m.test(text)) {
  text = text.replace(/^SESSION_SECRET=.*\r?$/m, '');
  writeFileSync(path, text + '\nSESSION_SECRET=' + randomBytes(32).toString('hex') + '\n');
}
'@ | node --input-type=module
```

Apply committed migrations and prepare the demo accounts:

```powershell
npm run db:validate
npm run db:deploy
npm run db:status
npm run db:seed
npm run db:verify
```

Seeding generates Prisma's client, upserts the two demo emails and refreshes their
password hashes without deleting other records. It can be repeated. Verification
expects exactly two staff and checks both passwords without displaying hashes.
Seed only the dedicated assessment database. Deployment needs no shadow database;
do not reset data, edit applied migrations or substitute `db push`.

## Start and sign in

```powershell
npm run dev
```

Open http://localhost:5173. Vite proxies `/api` to http://127.0.0.1:3000.
`GET /api/health` checks liveness only, not database readiness.

| Demo email | Public local-only password |
| --- | --- |
| alex@example.test | Alex-Demo-2026! |
| sam@example.test | Sam-Demo-2026! |

Never use these public credentials for real accounts.

## Checks and builds

Run from the project root after setup:

```powershell
npm run typecheck
npm run build
npm test
npm run test:server
npm run test:client
npm run test:browser
```

`npm test` runs both suites: 28 PostgreSQL integration tests and 12 frontend tests;
the individual suite commands are alternatives. Browser QA uses installed Edge,
an ephemeral API port and unused port 5180. Database fixtures live in isolated
schemas; see [testing details and gaps](docs/TECHNICAL_NOTES.md#frontend-behavior-and-verification).
There is no lint script.

To use a separate test database for both suites, set `TEST_DATABASE_URL` in the
shell environment. Backend and browser checks create and remove random schemas
there; otherwise they use the configured `DATABASE_URL` with the same isolation.
Neither suite resets development data.

Builds generate both `dist/` directories. Start the built API with
`npm run start -w server`; `npm run preview -w client` previews the frontend.
Production routing and HTTPS requirements are in the technical notes.

## Limitations and submission

This small assessment uses unpaginated lists and a per-process login limiter.
Drafts disappear on navigation/reload; status comparison detects changed status,
not every intervening revision. Full screen-reader, other-browser and deployed
TLS/proxy testing remain incomplete. Additional failure-test gaps are documented
in DECISIONS.md. Prepare the 3–5 minute recording separately; never show secrets.

