# Retro — Build-gated production migrations (ADR-002)

- **Merged:** PR #34 — 2026-08-07, squashed as `a5ec8a6`. 6 files, 4 commits.
  CI green throughout; first production build verified live.
- **Tier:** 3. Advisor **GO-WITH-CONDITIONS** (2026-08-06) on the build gate,
  **NO-GO as specified** on the preflight. Reviewer **REQUEST CHANGES** → five
  blocking findings → **APPROVE WITH NITS**. Copilot found one more.
- **Path:** "add a migrate deploy step" → brainstorm → advisor consult → nine
  conditions → scope split → implement → review → re-review → merge → C9 from
  the first production build.
- **Opened:** #27–#33 (seven issues). **Closed:** none — this shipped the gate,
  not the whole ruling.

## What shipped

`vercel.json` → `bash scripts/vercel-build.sh` → `scripts/migrate-if-production.sh`
→ `pnpm build`. Migrations apply only when `VERCEL_ENV=production` **and**
`VERCEL_GIT_COMMIT_REF=main`, over a Production-scoped, sensitive
`MIGRATE_DATABASE_URL` (unpooled — Prisma's session advisory lock is broken by
PgBouncer). Plus a written-but-unproven failure runbook, and ADR-002.

The first production build confirmed all of it live: `buildCommand` took effect
(no dashboard override), the production branch was taken, `DATABASE_URL` **is**
injected at build time, Vercel redacted the credential, and "No pending
migrations to apply" — production was already in sync.

## What surprised us

1. **"Before promotion" was not expressible, and the gate has a structural hole
   I called airtight.** Vercel's Git integration builds and promotes on push;
   there is no promotion step to hook. Worse, **promote and rollback do not
   rebuild** — so promoting a preview deployment still ships code that never
   migrated. I had told Kelvin "Vercel does not promote a build that exited
   non-zero, so code can never reach production ahead of its schema." True of
   builds, false of deployments. The advisor found it by reading the REST API
   docs rather than the happy path.

2. **The one input that decides whether production migrates failed OPEN.** Every
   other input in the script failed closed; `VERCEL_ENV` unset meant "skip and
   build". And it is reachable without touching the repository — that variable
   exists only while Vercel's "Automatically expose System Environment
   Variables" toggle is on, a UI setting outside code review. Flipping it would
   have silently disabled the entire gate while printing "skipping migrations".

3. **The mutation I used to prove that guard tested its presence, not its
   default.** M1 deleted the conditional and three tests went red, which felt
   like proof. Deleting a branch and changing its _fallback_ are different
   mutations, and only the second was the bug.

4. **Fixing one guard-that-cannot-fail, I shipped another.** The replacement C2
   test asserted only two negatives — satisfied by a run that exited at the
   `case` and never evaluated C2 at all. The reviewer demonstrated it. Two
   instances of this project's signature failure in one branch.

5. **The runbook would have sent an incident responder the wrong way.** It said
   an urgent hotfix could ship by reverting the migration commit. P3009 is
   raised from `_prisma_migrations` rows, not the folder, so the revert leaves
   the failed row and the red build untouched — a revert PR, a review and
   another failed build, during an outage, for nothing.

6. **Asking about PII surfaced a bigger pre-existing gap than the one I asked
   about.** The question was whether restoring a prod dump into a GitHub runner
   breached the DPA note. Answer: the note lists three processors and GitHub is
   not among them, yet `backup.yml` has been shipping staff names, emails and
   `employeeRef` there nightly since it became an advisor condition. The
   preflight would have deepened a gap that already existed (#28).

7. **The security risk I recorded as "accepted" was not real.** ADR-002 recorded
   preview and production sharing `DATABASE_URL` and `AUTH_SECRET`, and #27 was
   opened on it. Both traced to README step 4's "(Production + Preview)" — a
   line documenting intent that was never applied. `vercel env ls` shows all four
   Production-only, and has for ten days. My own project memory had the correct
   state ("preview deployments have no env vars — non-functional") and I did not
   reconcile the two. I trusted prose over the platform, and the advisor did too,
   because I handed it the prose.

8. **Two empirical probes beat two plausible arguments.** Whether an instant
   rollback would be _blocked_ by `migrate deploy` finding the database ahead of
   the folder: reasoned both ways, then tested — exits 0, "No pending
   migrations". And whether Vercel injects a sensitive `DATABASE_URL` at build
   time: unanswerable from the docs, and settled the moment the first production
   build got past C2.

9. **A configuration artefact was unreachable.** `.env.example` matches the
   session's `.env*` deny rule, and it is one of the three files this repo names
   as its configuration record in lieu of Terraform. Two of three were updated;
   the third became #33 and the README was reworded so nothing asserted
   something false in the meantime.

## What we'd do differently

- **Check a platform's deploy verbs before claiming a build-time gate is
  complete.** Promote, rollback, redeploy and deploy hooks each either skip the
  build or trigger it from somewhere unexpected. The happy path is one of five.
- **Mutate a conditional's default, not just its presence.** "Delete the check"
  and "make the check's fallback permissive" are different tests, and for any
  guard reading an environment variable the second is the real one.
- **A test whose assertions are all negative proves nothing about reach.** Pair
  every `not.toContain` with one positive marker asserting the code got there.
- **Verify configuration claims against the platform, not the doc that
  describes it** — and when memory and a doc disagree, that disagreement is the
  finding, not noise to resolve in favour of the tidier source.
- **Shell and CI guards are structurally outside mutation testing.** Stryker
  covers TS modules; `scripts/*.sh` and workflow YAML cannot be scoped into it,
  so hand red-proving stays the only mechanism there — and this delivery is the
  eighth and ninth recurrence of guards that pass while broken.
