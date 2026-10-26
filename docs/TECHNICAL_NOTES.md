# Technical notes

[Project overview and setup](../README.md) · [Implementation decisions](../DECISIONS.md)

This reference describes the implemented API, security boundaries, data policies,
and verification tools. Run npm commands from the project root unless stated otherwise.

## Migrations and hosting

Migrations create staff/inquiry tables, then the PostgreSQL session table, then
nonblank-text/contact CHECK constraints. Session table auto-creation is disabled.
The CHECK migration deliberately fails on invalid existing rows; investigate them
without resetting or automatically deleting data. Never edit applied migrations
or substitute `db push`. For future schema work, `npm run db:migrate -- --name NAME`
uses Prisma's development shadow database and requires CREATEDB or a separately
configured shadow database; this is unnecessary for the committed-migration
setup in the [README](../README.md#setup-powershell-project-root).

Use `npm run db:generate` to regenerate the Prisma client independently. Generation
and `npm run db:validate` do not require a live database; validation still requires
a syntactically valid `DATABASE_URL`.

`npm run build` generates the Prisma client and both `dist/` directories. Start
the built API with `npm run start -w server`. Vite preview is a local preview,
not a production hosting setup. Production needs a same-origin HTTPS reverse
proxy for `/api` and frontend history fallback to `index.html`.

Production configuration requires HTTPS trusted origins and Secure cookies. Set
`TRUST_PROXY=loopback` only behind a local proxy that overwrites forwarded headers
and prevents direct public access to Express. The listener binds to loopback.
Changing `SESSION_SECRET` invalidates existing cookies. Configuration requires at
least 32 secret bytes and exact trusted origins; follow the README's secret-generation
instructions.

## Authentication and API policies

| Method | Endpoint | Behavior |
| --- | --- | --- |
| POST | `/api/auth/login` | JSON email/password; rotates and persists session, returns safe staff ID/email |
| GET | `/api/auth/me` | Current staff, or 401 |
| POST | `/api/auth/logout` | Send `{}`; destroys stored session, clears cookie, returns 204 |
| POST | `/api/inquiries` | New inquiry 201; identical submission retry 200; changed retry 409 |
| GET | `/api/inquiries?search=router` | Owned summaries; empty array for no matches |
| GET | `/api/inquiries/:id` | Owned detail |
| PATCH | `/api/inquiries/:id/status` | Atomic status comparison/update; conflict 409 |

Every inquiry endpoint requires backend authentication. Every read/update includes
the session owner. The same 404 covers missing and inaccessible records; malformed
UUIDs/URL encoding return 400. Extra creation/update fields are rejected, including
client-supplied ownership and initial status. API responses use `Cache-Control:
no-store`. Errors follow `{ "error": { "code": "...", "message": "..." } }`, with
`fields` on validation failures; unexpected errors reveal no internal diagnostics.

All API writes require `Content-Type: application/json` and an exact allowlisted
`Origin`, including login/logout. Missing/null/untrusted Origins return 403;
unsupported media/encoding returns 415. Browser same-origin requests supply Origin
and cookies automatically; CLI clients must supply them explicitly. CORS is not
enabled. This protects browser requests; CLI clients can set their own headers.

Session cookies are signed opaque IDs, host-only, HttpOnly, SameSite=Lax and
Secure on HTTPS (always Secure in production). PostgreSQL stores sessions, which
survive restarts; logout invalidates cookie replay. Expiry is fixed at eight hours.
Login normalizes email, never trims passwords, uses salted scrypt, and returns
the same 401 for unknown accounts and wrong passwords. Login allows ten attempts
per IP per fifteen minutes, including invalid/successful attempts. Limits are in
memory and reset on restart; this is a single-process assessment trade-off.

Creation accepts `customerName`, `email`, `phone`, `subject`, `description`, and a
UUID `submissionKey`. Text is trimmed, required, NUL-free and limited to 120/200/
5,000 characters. Blank/omitted contacts become null. At least one valid contact
is required; both must be valid if supplied. Email is lowercased and limited to
254 characters; phone permits ordinary formatting, an optional leading `+`, and
7–15 digits within 40 characters. Database constraints protect lengths, owner
foreign keys, uniqueness, nonblank text and contact presence. Format validation
and normalization are API responsibilities.

A new form starts with a fresh submission key retained through retries. The unique
owner/key constraint arbitrates concurrent creates. Same normalized creation
fields return the saved inquiry even after status changes; changed fields return
`SUBMISSION_KEY_CONFLICT`. Different keys can capture otherwise identical inquiries.
Details expose neither owner ID nor key. Search matches owned customer names or
subjects case-insensitively, treats `%`, `_` and backslash literally, and limits
trimmed search to 200 characters. Results are unpaginated, newest first, with ID
descending as a tie-breaker.

Status writes send `{ "expectedStatus": "NEW", "status": "IN_PROGRESS" }`.
Only NEW → IN_PROGRESS, IN_PROGRESS → RESOLVED and RESOLVED → IN_PROGRESS are
allowed. The database compares owner/ID/expected status in the update itself.
Stale expectations return `STALE_STATUS`; disallowed edges return
`INVALID_STATUS_TRANSITION`. Comparison uses status, not full record revision:
a cycle back to the original status is accepted.

## Frontend behavior and verification

Session restoration gates content; a failed check offers retry. Protected 401s
return to sign-in, while a late response from an older session cannot invalidate a
new login. Loading, empty list, no matches, unavailable detail, validation and
retryable save errors have explicit states. Search debounces 250ms and aborts/
ignores older reads. Save guards prevent repeated submits; values and keys survive
failed requests within the form. Navigation/reload discards the draft. Leaving a
pending save ignores late UI navigation but does not cancel the server write;
check the list before creating a replacement after an uncertain save.

Status conflicts refetch current data and require a fresh action. A failed refetch
blocks further status actions until Refresh succeeds. Mutations are never retried
automatically. Layouts include mobile cards, labelled statuses, linked form errors,
keyboard focus, a skip link, wrapped long content and reduced-motion support.

```powershell
npm run test:server  # 28 PostgreSQL/Supertest integration tests
npm run test:client  # 12 RTL/Vitest interaction and request-order tests
npm run test:browser # real stack in installed Microsoft Edge
```

Server suites use `TEST_DATABASE_URL` if set, otherwise `DATABASE_URL`. Each suite
replays migrations in a random isolated schema, inserts fixtures and drops only
that schema. No development tables are seeded, reset or truncated. Browser QA
uses the same isolation, ephemeral API port, client port 5180 and installed Edge
(`channel: msedge`); no browser download is needed. Forced interruption can leave
test schemas. Browser output/screenshots are ignored under `artifacts/ui/`.

Tests cover authentication lifecycle, safe errors, ownership, normalization,
database checks, duplicate races, all status pairs and concurrent/stale writes.
Frontend tests control failed saves, pending guards, conflict recovery, session
restoration/expiry, session-check network failure with successful retry, logout
failure with successful retry, validation and late responses. Edge checks exercise all four
screens at 375/768/1440px, keyboard paths and real API actions. These do not replace
a full screen-reader audit, other-browser checks or deployed TLS/proxy testing.
Further failure-test gaps are listed in [DECISIONS.md](../DECISIONS.md#prioritized-future-improvement-and-testing-gaps).
There is no configured lint script. Prisma validation/generation do not prove
database connectivity; migration status, seeds and integration tests do.

The submission demo recording is complete and uploaded; see the
[Demo video](../README.md#demo-video). Do not show `.env` or secrets.

## Source map

`client/src/pages/` holds the four screens; `auth/` restores sessions; `components/`
provides shared controls/shell; `lib/` holds fetch/types/validation. `server/src/`
contains the app factory, config, middleware, routes and inquiry service.
`server/prisma/` contains schema, ordered migrations and repeatable seed/verifier.
`server/tests/`, `client/src/tests/` and `client/scripts/browser-check.ts` contain
the three verification layers. Codex assisted with implementation and review;
the candidate must understand the submitted source and verification limits.

