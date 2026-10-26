# Implementation decisions

See [technical notes](docs/TECHNICAL_NOTES.md) for API and verification details.

## Assumptions

This is a staff-only assessment with a small dataset, one API process and a
same-origin frontend/API deployment. Each inquiry belongs to its creating staff
member; staff cannot transfer or view another owner's records. Email or phone is
sufficient contact. Registration, assignment, notifications and real-time updates
are outside scope.

## Three design choices

1. **Persistent cookie sessions.** Express signs an opaque session ID in an
   HttpOnly, host-only, SameSite=Lax cookie; PostgreSQL holds the session. This
   supports restart persistence and logout invalidation without browser token
   storage. Login rotates the ID and waits for persistence; sessions expire after
   eight hours. Secure cookies on HTTPS, exact trusted Origins on writes and
   default-off proxy trust define the deployment boundary. Generic credential
   errors and a login limiter reduce disclosure and repeated attempts.

2. **Owner-scoped queries and database consistency.** Every read/update includes
   the authenticated owner; inaccessible and missing records share a 404.
   Strict Zod input normalizes text/contact fields and rejects injected ownership
   or initial status. Database lengths, foreign keys and CHECK constraints protect
   basic integrity. A unique owner/submission-key constraint arbitrates concurrent
   creates: identical normalized retries return the saved record; changed payloads
   conflict. Conditional UPDATE RETURNING compares owner, ID and expected status
   atomically, preventing a stale write from overwriting a different status.

3. **Page-local React state and native fetch.** Four screens need no global query
   library. A small auth context gates rendering during session restoration;
   pages own loading, validation and retry state. Aborted reads ignore late
   responses. Session generations reject old-session 401 side effects, and
   unmounted forms ignore delayed save navigation. Pending guards prevent repeated
   submission; values and submission keys survive failed saves. Status conflicts
   refetch and require another user action; failed refetches disable status actions.

## Accepted trade-offs

The limiter is in memory and resets on restart; multiple API instances would
require shared counters. Lists are unpaginated. Phone validation checks format,
not existence. Different submission keys may represent identical real-world
inquiries. Drafts do not survive navigation/reload, and leaving a pending save
does not cancel its server write. Status comparison accepts an intervening cycle
back to the original status; full revision tracking is omitted.

## Prioritized future improvement and testing gaps

First, add integration tests for session-store outages during login/logout and
recovery, verifying safe errors and avoiding false success. This targets a critical
authentication boundary before expanding product scope. Existing PostgreSQL,
frontend and Edge tests cover ownership, duplicate/status races and selected UI
failures, including session-check network recovery and logout failure/retry.
Remaining gaps include session-store and broader database outages,
a full screen-reader audit, Safari/Firefox and deployed
TLS/proxy testing.

## AI assistance

Codex assisted with scaffolding, APIs, migrations, screens, tests and documentation.
For submission preparation, Codex added tests that fail session restoration once
and retry successfully, and fail logout once before a successful retry. Both
passed without application changes. The candidate remains responsible for reviewing,
understanding and explaining the assisted code.

