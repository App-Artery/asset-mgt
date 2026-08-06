#!/usr/bin/env bash
#
# Apply pending Prisma migrations, but ONLY for a production deployment built
# from `main` (ADR-002).
#
# Split out from vercel-build.sh so the decision can be tested without running
# a Next build: every guard below has a test in
# scripts/migrate-if-production.test.ts, and `ci.yml` never invokes the Vercel
# buildCommand, so without that harness this file's first execution would be in
# production.
#
# NEVER add `set -x` (ADR-002 C7). Vercel redacts a sensitive value from build
# logs as an EXACT string match, so a URL that has been transformed in any way
# is no longer redacted — one trace flag prints a production credential in the
# clear.
set -euo pipefail

env_name="${VERCEL_ENV:-}"
git_ref="${VERCEL_GIT_COMMIT_REF:-}"

# Preview and development builds stop here. This is the SECOND guard, not the
# first: `MIGRATE_DATABASE_URL` is scoped to Production only, so a preview build
# has no direct connection string to misuse even if this check is deleted.
# Defence in depth, independently falsifiable (C1a).
if [ "$env_name" != "production" ]; then
  echo "migrate: VERCEL_ENV=${env_name:-unset} is not production — skipping migrations."
  exit 0
fi

# C8. A production deployment must come from `main`. `vercel --prod` from a
# feature branch is the realistic accident, and it would migrate production
# from uncommitted local code.
#
# This FAILS rather than skipping. A silent skip is the AM-02 bug wearing a
# seatbelt: the deploy would promote code whose schema never landed, which is
# exactly the incident ADR-002 exists to prevent.
if [ "$git_ref" != "main" ]; then
  echo "migrate: refusing to build a production deployment from ref '${git_ref:-unset}' — expected 'main' (ADR-002 C8)." >&2
  exit 1
fi

# C1b. Fail closed. A missing variable must break the build, never skip
# silently — silent skipping IS the bug this exists to fix.
: "${MIGRATE_DATABASE_URL:?migrate: MIGRATE_DATABASE_URL is unset — refusing to build a production deployment that cannot migrate (ADR-002 C1)}"
: "${DATABASE_URL:?migrate: DATABASE_URL is unset — cannot prove the migration target matches the runtime target (ADR-002 C2)}"

# C2. The database we migrate must be the database the app will serve. Getting
# this wrong reproduces AM-02 with the automation green, which is the worst
# available version of that incident.
#
# Compared on host+path with `-pooler` and query params normalised away, in node
# rather than shell because URL parsing in shell is how you get a guard that
# passes on a string it should have rejected. Values are read from the
# environment, never passed as arguments, and neither is ever printed (C7).
node -e '
  const normalise = (raw) => {
    const url = new URL(raw);
    return url.hostname.replace("-pooler", "") + url.pathname;
  };
  let migrateTarget, runtimeTarget;
  try {
    migrateTarget = normalise(process.env.MIGRATE_DATABASE_URL);
    runtimeTarget = normalise(process.env.DATABASE_URL);
  } catch {
    console.error("migrate: a connection string is not a parseable URL (ADR-002 C2).");
    process.exit(1);
  }
  if (migrateTarget !== runtimeTarget) {
    console.error("migrate: MIGRATE_DATABASE_URL and DATABASE_URL point at different databases — refusing to migrate (ADR-002 C2).");
    process.exit(1);
  }
'

echo "migrate: applying pending migrations to the production database…"
# The UNPOOLED string, and that is a correctness requirement rather than a
# preference: Prisma holds a Postgres SESSION advisory lock for the duration of
# a migration, and session locks over PgBouncer transaction pooling are broken —
# the lock can be acquired on one backend and released on another, or never
# released. Never "simplify" this back to DATABASE_URL.
DATABASE_URL="$MIGRATE_DATABASE_URL" pnpm db:deploy
