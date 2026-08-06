# ADR-002 — Production migrations run in the Vercel build, gated on `main`

- **Status:** Accepted
- **Date:** 2026-08-06
- **Tier:** T3 (production DDL automation + PII processing). Advisor ruling
  2026-08-06: **GO-WITH-CONDITIONS** on the build gate, **NO-GO as specified**
  on the dump-restore preflight.
- **Supersedes:** the README's "run `pnpm db:deploy` on schema changes until a
  deploy pipeline owns it".

## Context

CI deploys code but not migrations. On 2026-07-30 assigning a device 500'd with
`P2022: The column assignmentId does not exist`. Investigation found AM-02's
migration had **also** never been applied, so production had run without
`Asset_tag_required_when_tracked` and without the `actorId` RESTRICT FK for an
entire story. Only the missing column failed loudly; the missing CHECK was
silent.

There is no promotion step to hook. Vercel's Git integration builds and
promotes on push to `main`.

## Decision

`vercel.json` sets `"buildCommand": "bash scripts/vercel-build.sh"`. The script
applies `prisma migrate deploy` **only** when `VERCEL_ENV=production` **and**
`VERCEL_GIT_COMMIT_REF=main`, over a Production-scoped, Sensitive
`MIGRATE_DATABASE_URL`, then builds.

Invoked as `bash scripts/…` rather than `./scripts/…` so the pipeline does not
depend on a git mode bit surviving, and it calls the existing `pnpm db:deploy`
rather than introducing a second spelling of the same command.

### Why a hand-made variable rather than the Neon integration's

The Neon integration provisions `STORAGE_DATABASE_URL_UNPOOLED` and
`STORAGE_POSTGRES_URL_NON_POOLING`, but they are scoped **Production and
Preview**, are **not** marked Sensitive, and the integration re-syncs that scope
on its own schedule. Consuming them would leave a production DDL credential
sitting in every preview build container, with a string comparison as the only
thing not using it — the issue #14 shape exactly, where `?? "dev-secret"` passed
a whole test file because the guard was live and the capability was still
reachable.

`MIGRATE_DATABASE_URL` is created by hand, **Production scope only, Sensitive**.
A preview build then has no direct connection string under any code path,
including a buggy one. The `VERCEL_ENV` check remains as defence in depth, and
the two are independently falsifiable (C1).

### Why unpooled — a correctness requirement, not a preference

Prisma takes a Postgres **session** advisory lock (hard-coded 10s timeout) for
the duration of a migration. Session advisory locks over PgBouncer transaction
pooling are broken: the lock can be acquired on one backend and released on
another, or never released. This must never be "simplified" back to the pooled
`DATABASE_URL`.

Two concurrent production builds are safe but noisy: the second fails with
`Timed out trying to acquire a postgres advisory lock`. That fails closed, which
is right, but it is a red build on a good commit — redeploy, nothing is broken.

### Why not derive the direct URL at build time

Vercel redacts a Sensitive value from build logs **as an exact string**. A URL
derived by stripping `-pooler` at build time is a different string and **will
not be redacted** — one `set -x` prints a production credential in the clear.
The explicit variable is redacted; a derived one is not.

## What this does NOT cover

**The build gate covers builds, not deployments.** Vercel's promote endpoint
does not rebuild (`POST /v10/projects/{id}/promote/{deploymentId}` — _"This does
NOT rebuild the deployment"_), and neither does rollback. So **promoting a
preview deployment to production ships code that never ran `migrate deploy`**,
reintroducing the AM-02 failure mode. `vercel redeploy` _does_ rebuild.

Four things can trigger a production build, none of which is a push to `main`:

1. `vercel --prod` from any linked working tree — migrations from **uncommitted
   local code**. C8 stops the accidental case (wrong branch), not a determined
   one from a `main` checkout.
2. `vercel redeploy` / dashboard Redeploy. For an older commit this is a no-op:
   `migrate deploy` is forward-only and does not look for drift — **empirically
   verified 2026-08-06**, exits 0 with "No pending migrations to apply" when the
   database holds migrations absent from the folder. Rollback is therefore not
   blocked.
3. Deploy hooks — an **unauthenticated URL** that triggers a production build.
   None exist on this project; that must stay true.
4. REST `createDeployment` with `target: "production"`.

The only mechanism that catches drift regardless of cause is a runtime
assertion — **C3, deferred to #29**. It is what would have caught AM-02 on day
one.

## Consequences

- The build now performs a privileged, stateful, non-idempotent operation. That
  is the entire new risk surface.
- **A failed migration freezes every production deploy**, hotfixes included
  (P3009), until someone with the direct production credential resolves it by
  hand. So does editing an already-applied migration file — its SHA-256 changes
  and `migrate deploy` refuses to proceed, and **this repo has two hand-edited
  migrations** carrying "PRESERVE if regenerated" banners.
- **The migration always lands before the code.** The script migrates, then
  builds, then Vercel uploads and promotes. A build that fails on a type error
  leaves the schema forward while old code serves. Any migration that drops,
  renames or tightens breaks _currently-serving_ production the moment it
  applies — the mirror image of the incident being fixed, and worse, because the
  outage arrives with a green migration. Mitigation is the two-PR gate (C4,
  deferred to #30).
- **Instant rollback no longer restores the whole system** — code reverts,
  schema does not. Every migration must be survivable by the immediately
  previous deployment. This is a one-way door per migration shipped.
- Preview and production continue to share `DATABASE_URL` and `AUTH_SECRET`
  against one Neon project (#27). **Accepted risk, 2026-08-06**, with
  per-environment `AUTH_SECRET` and Neon preview branches as the named
  remediation. This ADR adds DDL to a DML capability preview already has.

## Alternatives rejected

- **A GitHub Actions job racing the Vercel build** — best-effort, not ordering.
- **Owning promotion in Actions** (disable Git deploys; build → migrate →
  `deploy --prebuilt --prod`) — strictly correct and permits a preflight, but
  three new secrets, and a broken workflow means no deploys at all.
- **Restoring the nightly `pg_dump` into a GitHub-hosted runner** — adds an
  unlisted non-EU processor to a Kenya DPA transfer chain, for data the
  preflight does not need. The constraints being tested reject rows on _shape_,
  not identity. Replaced by a Neon branch preflight (C6, #32). Note the existing
  artefact is itself the gap (#28).

## Condition disposition

The T3 gate requires every condition met or explicitly overruled, in writing,
one by one.

| #   | Condition                                                    | Disposition                                                                                                                                                                                                 |
| --- | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1  | Preview must not migrate, proven twice, independently        | **Met here**                                                                                                                                                                                                |
| C2  | Migrate target and runtime target provably the same database | **Met here**                                                                                                                                                                                                |
| C3  | `/health` asserts the serving code's schema is present       | **Deferred → #29**                                                                                                                                                                                          |
| C4  | Destructive DDL ships alone, under the two-PR gate           | **Deferred → #30**                                                                                                                                                                                          |
| C5  | Failure runbook executed before merge                        | **Partially met.** The runbook ships here (README §Recovering a failed migration). Its _execution_ against a Neon branch is deferred → #31. The runbook is therefore **written but unproven**, and says so. |
| C6  | Preflight uses a Neon branch and always deletes it           | **Deferred → #32**                                                                                                                                                                                          |
| C7  | The connection string never reaches a log                    | **Met here**                                                                                                                                                                                                |
| C8  | Production migration requires `main`                         | **Met here**                                                                                                                                                                                                |
| C9  | Confirm the build command actually took effect               | **Met here** (first production build log pasted into the PR)                                                                                                                                                |

**Overruling rationale for C3, C4, C6 (Kelvin, 2026-08-06):** each is a
substantial piece of work in its own right, and the core gate closes the
specific hole that caused the 2026-07-30 outage. They are filed with their
conditions intact rather than dropped.

**C5 is the risky deferral and is called out as such.** Shipping a mechanism
that can freeze all production deploys with no written recovery would be
indefensible, so the runbook ships; only the proof that its steps work is
deferred. Until #31 closes, treat the runbook as untested.

## Guards (each stated as the change that breaks it)

- **C1a** — script run with `VERCEL_ENV=preview` and `MIGRATE_DATABASE_URL`
  populated with a reachable throwaway database leaves `_prisma_migrations`
  untouched. _Deleting the `VERCEL_ENV` conditional turns this red._
- **C1a′** — `VERCEL_ENV` **unset, empty, or an unrecognised value** exits
  non-zero. _Replacing the `case` with `!= production` turns this red._

  Added after review. The original spelling was the only input in the script
  that failed OPEN, and it is reachable without touching the repository:
  `VERCEL_ENV` exists only while the project's "Automatically expose System
  Environment Variables" setting is on — a UI toggle, changeable by anyone with
  project access. A `!= production` test turns that toggle into a silent kill
  switch for this entire gate, printing a reassuring "skipping migrations" while
  promoting code ahead of its schema. Only `preview` and `development` skip;
  everything else refuses to build.

- **C1b** — `VERCEL_ENV=production` with `MIGRATE_DATABASE_URL` unset exits
  non-zero **before** the build. _Adding a fallback turns this red._
- **C1c** — the script run end-to-end in preview mode reaches `pnpm build`, and
  a build whose guard FAILS never invokes `pnpm` at all. _A shell typo turns the
  first red; adding `|| true` to the guard call turns the second red._ The
  second is the property the whole ADR exists to provide, and it rests on
  `set -e` over an unwrapped command.
- **C2** — migrate target and runtime target pointing at different databases
  exits non-zero **before** `migrate deploy`. _Deleting the comparison turns
  this red._ Compared on host, **port**, path and **`?schema=`**, with `-pooler`
  stripped only where Neon puts it (immediately before the first dot), and
  without printing either value. Dropping port or schema turns a dedicated test
  red: two Postgres instances on one host, or two schemas in one database, are
  not the same database.
- **C2′** — a **pooled** `MIGRATE_DATABASE_URL` exits non-zero. _Deleting the
  check turns this red._

  Added after review. Both sides of the C2 comparison are `-pooler`-stripped, so
  a pooled migrate URL sails through it, and the unpooled requirement was
  enforced by prose alone. Neon surfaces the pooled string more prominently than
  the direct one, so a credential rotation is a realistic route to a session
  advisory lock over transaction pooling — which by §Consequences freezes every
  production deploy.

  **Open question, resolved fail-closed.** C2 needs `DATABASE_URL` present in
  the build container. Sensitive variables are hidden from read-back — which is
  why `vercel env pull` returns it empty — but are still delivered to
  deployments; the docs do not state build-time availability outright, and this
  app cannot demonstrate it, because `force-dynamic` means `next build` has
  never needed the variable (that is the env-free build guarantee). So the
  script **requires both variables when it migrates and exits non-zero if
  either is missing**. If Vercel turns out not to inject `DATABASE_URL` at build
  time, the first production build fails loudly and we adjust the comparison —
  which is the correct failure direction. Skipping the check when the variable
  is absent would ship exactly the guard-that-cannot-fail shape this project has
  hit seven times. C9 makes this observable on the first build.

- **C7** — run with a sentinel connection value; the sentinel appears in
  neither stdout nor stderr. _Adding `set -x` turns this red._
- **C8** — `VERCEL_ENV=production` with `VERCEL_GIT_COMMIT_REF=feature/x` skips
  the migration **and** exits non-zero. _Deleting the ref check turns this red._
  A silent skip would be the AM-02 bug wearing a seatbelt.

`ci.yml` runs `pnpm build` directly and never through `buildCommand`, so the
env-free build non-negotiable is untouched — and it is also why the script needs
its own harness (C1c): otherwise it is untested code whose first execution is in
production.
