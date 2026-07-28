# AM-01 Implementation Plan — Authentication and Roles

## Context

AM-01 turns the deployed-but-locked scaffold into a usable tool: seeded staff, magic-link sign-in, four enforced roles, runtime role management with audit. Tier T3; design approved at `docs/features/AM-01/DESIGN.md` (advisor-ruled). Branch `feat/am-01` exists with the design committed. After approval this plan is committed to `docs/features/AM-01/PLAN.md`, implementation is dispatched to one `engineer` subagent (tasks are interdependent — no parallel fan-out), then `reviewer` + mandatory advisor security review before the PR merges.

Scaffold already provides (reuse, do not rebuild): split Auth.js config (`src/auth.config.ts` edge / `src/auth.ts` node), JWT sessions, deny-by-default `src/middleware.ts`, functional no-open-signup `signIn` callback, `requireRole()` chokepoint (`src/lib/authz.ts`), lazy `env()` (`src/lib/env.ts`), `getDb()` singleton, Button + test harness with the `describe.skipIf(!TEST_DATABASE_URL)` real-DB pattern (`src/lib/db.integration.test.ts`).

## Tasks (one conventional commit each)

### 1. Schema: `UserEvent` + deactivation + token timestamps

`prisma/schema.prisma`:

- `User.deactivatedAt DateTime?`
- `UserEvent` model mirroring AssetEvent's append-only pattern: `id`, `userId` (subject, FK), `actorId String?` (FK, null = system/seed), `type UserEventType {CREATED, ROLE_CHANGED, DEACTIVATED, REACTIVATED}`, `fromRole Role?`, `toRole Role?`, `at DateTime @default(now())`. Named relations to disambiguate from `User.assetEvents`. Same header comment as AssetEvent: append-only, no update/delete path may ever be written.
- `VerificationToken.createdAt DateTime @default(now())` — adapter inserts ignore it, default fills; makes throttle windows computable.

Migration `am01_auth_roles` via `pnpm db:migrate` against Docker Postgres.

### 2. Auth hardening

- `src/auth.config.ts`: `session.maxAge = 14 * 24 * 3600`; `pages: { signIn: "/signin", verifyRequest: "/signin?sent=1", error: "/signin" }` (edge-safe, no new imports).
- `src/auth.ts`: Resend provider `maxAge: 15 * 60` (magic-link TTL). `signIn` callback: lowercase the email before lookup; reject unknown **or deactivated** users; on `email.verificationRequest`, throttle via `VerificationToken.createdAt` counts — ≥3 for this identifier in 15 min → reject; ≥30 globally in 1 h → reject. All rejections return `false` (indistinguishable to the caller; uniform UX handled by task 3).
- `src/lib/authz.ts`: `requireRole` also selects `deactivatedAt`; a deactivated user is treated as unauthorized (leaver kill-switch — works because role/status are DB-read per request, never from the JWT).

### 3. Uniform sign-in flow

- `src/app/signin/page.tsx` + server action: one email field; the action calls `signIn("resend", { email, redirect: false })` and **renders the identical "If your address is registered, a sign-in link has been sent" confirmation for every outcome** — success, unknown email, deactivated, throttled (rejections surface as AccessDenied; catch and show the same message). Auth.js error query params map to the same generic copy. No enumeration oracle.
- `src/middleware.ts`: add `signin` to the matcher exclusions (the only new public route).

### 4. Admin users screen

- `src/app/admin/users/page.tsx`: gated by `requireRole("ADMIN_IT")`; table (name, email, employeeRef, role, status) + add-user form. Minimal hand-written shadcn-style components (scaffold pattern — no shadcn CLI, LEARNINGS §Next.js).
- `src/app/admin/users/actions.ts` — every action starts with `await requireRole("ADMIN_IT")`:
  - `createUser`: transaction creating Person + User (lowercased email, chosen role) + `UserEvent CREATED`.
  - `changeRole`: interactive transaction — last-admin guard (count active admins excluding subject; reject if zero would remain) race-safe under concurrency (row locking or serializable isolation — test 4 proves it), update, `UserEvent ROLE_CHANGED` with from/to.
  - `deactivate` / `reactivate`: same guard shape for deactivation; sets/clears `deactivatedAt`; `UserEvent DEACTIVATED/REACTIVATED`. Never a delete.
  - Self-demotion permitted when another active admin remains; client-side confirm only.
- `src/app/page.tsx`: show signed-in identity + DB-read role, link to `/admin/users` for admins, sign-out button.

### 5. Seed script

- `scripts/seed-staff.ts`, run as `pnpm db:seed` (tsx + dotenv-cli — tsx does not autoload env files, LEARNINGS §Prisma). Requires `SEED_ADMIN_EMAIL` (refuses to run unset); reads staff CSV path from `STAFF_CSV` env/argv. Upserts by lowercased email → Person + User (default `STAFF_RO`), never downgrades an existing role, creates-or-promotes the admin to `ADMIN_IT`, writes `UserEvent CREATED` (actorId null) for new rows. Idempotent by construction.
- `scripts/staff.example.csv` — synthetic data only; `.gitignore` gains the real-data pattern (`seed-data/`). Real staff CSV never enters the repo (Kenya DPA).

### 6. Tests (design's real-DB matrix — must execute, not skip, locally and in CI)

Real-DB (skipIf pattern, `*.integration.test.ts`): (1) signIn rejects unknown + deactivated; (2) `requireRole` all four roles × allowed/denied; (3) role change effective next request without redeploy; (4) last-admin guard under two concurrent demotions; (5) throttle trips at per-email limit; (6) `UserEvent` atomic with the mutation (present on success, absent on induced failure); (7) seed idempotency + never-downgrade. Session identity mocked via `vi.mock("@/auth")`; DB always real. Component test: sign-in form renders the uniform message for success and failure action results.

### 7. Docs

README: `pnpm db:seed` in quickstart; prod runbook step — run seed against Neon with `SEED_ADMIN_EMAIL`, then verify authenticated `/health` (closes runbook step 6). `CLAUDE.md`: UserEvent append-only rule, email normalisation, throttle location.

## Verification

- Engineer: `pnpm lint`, `pnpm typecheck`, `pnpm test` with `TEST_DATABASE_URL` set (full suite — T3), `pnpm build` env-free; push; CI green.
- `reviewer` subagent: full diff vs ACs + design. Then **advisor security review (mandatory T3 gate)** of the final diff. Blocking findings loop through the fix path; same finding blocking twice → impasse to Kelvin.
- Post-merge smoke on production: seed with real CSV + `SEED_ADMIN_EMAIL`, magic-link sign-in as admin (Resend domain must be verified — runbook), role change round-trip, authenticated `/health`.
