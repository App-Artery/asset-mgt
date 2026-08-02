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
  (`src/lib/user-admin.ts`, `src/lib/asset-admin.ts`). User deactivation is a
  flag (`deactivatedAt`), never a delete.
- **`Assignment` is a state row, not an audit row** — the one bounded
  exception to the rule above. Exactly two columns are mutable,
  `returnedAt` and `conditionNotes`, set exactly once, by the return
  path, on a row where `returnedAt IS NULL`. Every other column is
  write-once at insert; `Assignment` rows are never deleted. The audit
  anchor is the `ASSIGNED`/`RETURNED` `AssetEvent` pair. Enforcement is
  application-level, not a constraint: the update is predicated on
  `returnedAt IS NULL` with a `count === 1` assertion
  (`src/lib/asset-admin.ts`). `AssetEvent` and `UserEvent` remain
  append-only and this exception does not extend to them.
- **No personal data in event tables.** The application never writes a
  name, email or employee ref into `AssetEvent.notes` or any `UserEvent`
  field, and no new code may. The person link is
  `AssetEvent.assignmentId` → `Assignment.personId` — exactly one copy,
  joinable. Those tables are never updated and never deleted, so a name
  change or a DPA erasure request against a copied-in name is
  unhonourable by construction.
  **What the code cannot enforce:** `notes` is operator-typed free text,
  rendered to all four roles including `STAFF_RO` — who are otherwise
  shown no person data at all. Every form writing it carries a "never
  personal data" hint (`EventNoteHint`); that is guidance, not a
  guarantee, and it is the one place §`STAFF_RO`-sees-no-person-data can
  be bypassed. **Any feature that indexes or searches `AssetEvent.notes`
  must exclude it from `STAFF_RO` reach, or close this first** (AM-07).
- **Nothing in this codebase is ever deleted.** `RETIRED` is an asset's delete
  (`db.asset.delete()` appears nowhere and must not); `deactivatedAt` is a
  user's; categories and sites are renamed, never removed. A delete would
  sever the audit trail that is the whole point of the register.
- **Asset status transitions go through `src/lib/asset-lifecycle.ts`** — the
  transition map is the single source of truth and status is not editable via
  the plain update path. `transitionAssetStatus` locks the asset row
  (`SELECT … FOR UPDATE`) before reading the current status: without it two
  concurrent transitions both pass the guard and the history records a
  transition that never happened.
- **Exactly one `AssetEvent` per action, never two.** The type is
  `ASSIGNED` when the action opens an assignment, `RETURNED` when it
  closes one, `STATUS_CHANGED` otherwise — so retiring an assigned
  asset writes a single `RETURNED` event carrying
  `fromStatus=ASSIGNED, toStatus=RETIRED`. **Status questions are
  answered by querying `fromStatus`/`toStatus`, never by event type.**
- **A tag is mandatory from delivery onwards**, enforced by the
  `Asset_tag_required_when_tracked` CHECK constraint (hand-written in the
  `am02_asset_lifecycle` migration — Prisma has no CHECK primitive, so preserve
  the block if that migration is ever regenerated). `ON_ORDER` and `RETIRED`
  are exempt: not yet delivered, and dead-on-arrival kit that goes back to the
  supplier untagged. Application guards exist for the error message; the
  constraint is the enforcement.
- **Emails are lowercased at every write and lookup** (sign-in policy, admin
  actions, seed). A case mismatch silently locks staff out.
- **Sign-in throttle lives in `src/lib/sign-in-policy.ts`**, counting
  `VerificationToken.createdAt` rows (3/email/15 min; global 30/hour and
  ~80/rolling 24h), called from the `signIn` callback in `src/auth.ts`. Every sign-in rejection is an
  indistinguishable `false` — /signin renders one uniform message for all
  outcomes; never add distinct error surfaces to that flow.
- **`Person.employeeRef`, never a national ID** — no national-ID column may be
  added anywhere (brief §7.3, Kenya DPA note in `docs/DPA-TRANSFER-NOTE.md`).
- **`STAFF_RO` sees no person data.** No current holder and no holder
  history anywhere in the app, except that user's own
  `/me/assignments` — the data is **not fetched** for that viewer, not
  merely unrendered, so a later UI change cannot leak it. Person field
  visibility lives in exactly one place, `personSelectFor(role)` in
  `src/lib/person-visibility.ts`, which is the only place in the
  codebase a `Person` select **carrying PII** may be written — that
  module's docblock names the two benign exceptions and gives the exact
  grep to audit with. Widening it requires a DPA note review
  (`docs/DPA-TRANSFER-NOTE.md`).
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
- **What satisfies the T3 gate.** A ruling from the `advisor` agent obtained
  before merge, with every condition it names either met or explicitly
  overruled **in the PR body, one by one, in writing**. The gate is not "an
  advisor was consulted" — an unanswered condition is an unmet gate. Ask for a
  ruling with conditions in that shape and the review is checkable by anyone.
- **Red-prove every guard a condition names**, by deleting the production line
  that defends it and watching the test fail. A ruling does not make its own
  conditions true: on #14 the advisor's "no fallback, ever" condition was
  implemented and guarded, and `?? "dev-secret"` still passed the whole file —
  throw unreachable, sessions signed with a known value. Guards written to
  satisfy a ruling fail the same way as any other (see #12).
- **If the advisor is genuinely unavailable**, the floor is satisfied instead
  by all three of: the guards enumerated in the design doc _before_
  implementation, Kelvin's recorded decision naming that specific list, and
  each guard proven red. "No advisor available, so we skipped it" is not a
  resolution — it is the thing this clause exists to prevent. Precedent and
  worked example: `docs/features/AM-09/DESIGN.md` §7.
- The advisor was non-responsive throughout AM-09 (2026-08-02), which is what
  prompted the clause above. It was re-tested on 2026-08-02 and is **working**:
  a full three-question T3 consult returned in ~9 minutes and a trivial probe
  in ~4 seconds, with and without an explicit model override. The
  invalid-`model:`-fails-silently theory recorded in the studio LEARNINGS
  §Tooling is **ruled out for this agent** — its frontmatter is valid. Root
  cause of the AM-09 failure remains unknown and unreproduced, so if it
  recurs, fall back rather than spending the session diagnosing it.
