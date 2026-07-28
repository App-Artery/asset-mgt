# CLAUDE.md — asset-mgt

Internal IT asset register (replaces Asset Tiger). Design: `docs/DESIGN.md` ·
ADR: `docs/adr/ADR-001-vercel-neon-stack.md` · Stories: `docs/intake/asset-mgt/PRD.md`.

## Non-negotiables

- **Rendering mode: dynamic SSR.** Next.js 15 App Router, `force-dynamic` at the
  root layout. NEVER `output: 'export'`; the later PWA (AM-06) is a manifest +
  service worker over the dynamic app.
- **Deploy target:** Vercel serverless functions pinned to `fra1`
  (`vercel.json`) + Neon Postgres `eu-central-1` via the **pooled** connection
  string. No Terraform — `vercel.json`, `.env.example`, and the README runbook
  are the configuration artefacts.
- **Env chokepoint:** `src/lib/env.ts` (`env()`). No `process.env` reads at
  module top level anywhere — `pnpm build` must succeed with zero env
  populated (CI proves this every run). Optional Vercel platform metadata may
  be read inline with a null fallback.
- **Authorisation:** `await requireRole(...)` (`src/lib/authz.ts`) is the FIRST
  statement of every mutating server action and route handler. Middleware
  (`src/middleware.ts`, edge-safe `src/auth.config.ts`, deny-by-default
  matcher) only authenticates; roles are always read from the DB, never from
  the JWT. Sessions are JWT. No open signup — users are provisioned, never
  self-registered.
- **`AssetEvent` and `UserEvent` are append-only.** Never write an update or
  delete against either, in code or SQL. Corrections are new events, and the
  audit insert happens in the same transaction as the mutation it records
  (`src/lib/user-admin.ts`). User deactivation is a flag (`deactivatedAt`),
  never a delete.
- **Emails are lowercased at every write and lookup** (sign-in policy, admin
  actions, seed). A case mismatch silently locks staff out.
- **Sign-in throttle lives in `src/lib/sign-in-policy.ts`**, counting
  `VerificationToken.createdAt` rows (3/email/15 min; global 30/hour and
  ~80/rolling 24h), called from the `signIn` callback in `src/auth.ts`. Every sign-in rejection is an
  indistinguishable `false` — /signin renders one uniform message for all
  outcomes; never add distinct error surfaces to that flow.
- **`Person.employeeRef`, never a national ID** — no national-ID column may be
  added anywhere (brief §7.3, Kenya DPA note in `docs/DPA-TRANSFER-NOTE.md`).
- **Real-DB tests:** integration tests run against real Postgres via
  `describe.skipIf(!process.env.TEST_DATABASE_URL)` (see
  `src/lib/db.integration.test.ts`); local Docker Postgres 17 / CI service
  container. Mocks cannot guard read/write seams.
- **Prisma:** client comes from `getDb()` in `src/lib/db.ts` — lazy-init
  `globalThis` singleton, plain instance, never a JS Proxy wrapper. Prisma is
  pinned to major 6.
- **Versions:** pnpm (pinned via `packageManager`), Node 22 (`.nvmrc` +
  `engines`), Postgres major 17 (compose + CI + backup — keep in sync with the
  Neon project).

## Process

- Conventional commits. CI (`ci` check: lint, typecheck, tests incl. real-DB,
  env-free build) is the required check on `main`.
- Security-touching work (auth, PII, deletion) floors at Tier 3 — advisor
  review before merge. First story: AM-01.
