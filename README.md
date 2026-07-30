# Asset Management Tool (`asset-mgt`)

Cloud-based IT asset lifecycle management — an internal tool replacing Asset Tiger. Tracks every tagged asset (laptops, phones, desktops, printers, accessories) from purchase through assignment, repair, and retirement, under the organisation's own numeric tag scheme.

**Status:** scaffold complete — delivery in progress. First story: **AM-01 (auth/roles, Tier 3)**.

**Stack:** Next.js 15 (App Router, dynamic SSR) · Prisma 6 + Postgres 17 · Auth.js v5 (Resend magic-link, JWT sessions) · Tailwind v4 + shadcn/ui · Vitest · Vercel (`fra1`) + Neon (`eu-central-1`). Design and constraints: [docs/DESIGN.md](docs/DESIGN.md) · [ADR-001](docs/adr/ADR-001-vercel-neon-stack.md) · [CLAUDE.md](CLAUDE.md).

## Quickstart

Prereqs: Node 22 (`.nvmrc`), pnpm (version pinned in `package.json`
`packageManager`), Docker.

```sh
pnpm install                 # also runs prisma generate
cp .env.example .env         # fill in real values; never commit .env
docker compose up -d         # Postgres 17 (+ asset_mgt_test database)
pnpm db:migrate              # apply migrations to the dev database
SEED_ADMIN_EMAIL=you@example.com STAFF_CSV=scripts/staff.example.csv pnpm db:seed
pnpm db:seed:reference       # categories + sites — an asset needs a category
pnpm dev                     # http://localhost:3000
```

Everything is auth-gated (deny-by-default middleware); `/signin` is the only
public page. Users are provisioned by seed or by an admin — there is no open
signup. `GET /health` returns build info once authenticated.

`pnpm db:seed` loads `.env` (so it targets whatever `DATABASE_URL` points at)
and explicit env vars override it — always pass a local `DATABASE_URL` when
seeding the Docker database if your `.env` holds the production string. It
refuses to run without `SEED_ADMIN_EMAIL`, creates-or-promotes that user to
`ADMIN_IT`, never downgrades an existing role, and is idempotent. A real
staff CSV is personal data: keep it in `seed-data/` (gitignored) — only the
synthetic `scripts/staff.example.csv` may be committed.

`pnpm db:seed:reference` loads the same way and seeds the asset categories and
sites. It reads `type,name` rows from `REFERENCE_CSV`, defaulting to the
generic `scripts/reference.example.csv`; real client site names belong in
`seed-data/`, not the repo. It is idempotent (re-running duplicates and renames
nothing), fails on an unknown `type` naming the offending row rather than
skipping it, and exits non-zero if the run would finish with zero categories —
an asset cannot be created without one. Admins can add and rename categories
and sites afterwards at `/admin/reference` without a deploy.

### Scripts

| Command                                                   | What it does                                                                                         |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `pnpm dev` / `pnpm build` / `pnpm start`                  | Next.js dev / production build / serve                                                               |
| `pnpm lint` / `pnpm typecheck`                            | ESLint (flat config) / `tsc --noEmit`                                                                |
| `pnpm test`                                               | Vitest. Real-DB integration tests run only when `TEST_DATABASE_URL` is set — with it unset they skip |
| `pnpm db:migrate` / `pnpm db:deploy` / `pnpm db:generate` | Prisma migrate dev / deploy / generate                                                               |
| `pnpm db:seed`                                            | Seed staff + first admin (needs `SEED_ADMIN_EMAIL`; optional `STAFF_CSV`)                            |
| `pnpm db:seed:reference`                                  | Seed asset categories + sites (optional `REFERENCE_CSV`); fails if it would leave zero categories    |
| `pnpm format`                                             | Prettier over the repo                                                                               |

Husky runs lint-staged on commit and full-repo lint + typecheck on push. CI
(the `ci` required check) runs lint, typecheck, the full test suite against a
Postgres 17 service container, and an env-free build. `pnpm build` must always
succeed with no env vars set — required config is read lazily through
`src/lib/env.ts`.

## Provisioning runbook (manual — substitutes for IaC state)

There is deliberately no Terraform ([ADR-001](docs/adr/ADR-001-vercel-neon-stack.md)).
This runbook plus `vercel.json` and `.env.example` are the configuration
record — keep all three current when anything here changes.

1. **Vercel project** — import `App-Artery/asset-mgt` into the Vercel team
   (Hobby; ToS risk accepted, ADR-001). Framework preset: Next.js. Production
   branch: `main` (previews per PR are automatic). Function region `fra1` is
   pinned by `vercel.json`.
2. **Neon Postgres** — `vercel integration add neon`, region **eu-central-1**
   (colocated with `fra1`). Use the **pooled** connection string as
   `DATABASE_URL`. Verify the Neon project's Postgres major and keep
   `docker-compose.yml`, `.github/workflows/ci.yml`, and
   `.github/workflows/backup.yml` pinned to the same major (currently 17).
3. **Resend** — create the API key (`AUTH_RESEND_KEY`) and **verify a sending
   domain**: the free-tier default sender (`onboarding@resend.dev`) only
   delivers to the Resend account owner, so magic links will NOT reach staff
   until a verified domain backs `AUTH_EMAIL_FROM`.
4. **Vercel env vars** (Production + Preview): `DATABASE_URL`, `AUTH_SECRET`
   (`openssl rand -base64 32`), `AUTH_RESEND_KEY`, `AUTH_EMAIL_FROM`. All
   enumerated with placeholders in [.env.example](.env.example) — real secrets
   live only in Vercel env vars and gitignored `.env`.
5. **Migrations** — run `pnpm db:deploy` against the Neon `DATABASE_URL` at
   provisioning (and on schema changes until a deploy pipeline owns it).
6. **Deploy and seed** — push to `main`. Then provision users against Neon:
   `DATABASE_URL=<neon-pooled-url> SEED_ADMIN_EMAIL=<org-admin-mailbox> STAFF_CSV=seed-data/staff.csv pnpm db:seed`
   (the admin mailbox must be an org mailbox with MFA — client obligation,
   AM-01 design), then the reference data the register needs:
   `DATABASE_URL=<neon-pooled-url> REFERENCE_CSV=seed-data/reference.csv pnpm db:seed:reference`
   (omit `REFERENCE_CSV` to seed the generic defaults; the run exits non-zero
   rather than leaving zero categories, since an asset cannot be created
   without one). Sign in at `/signin` with the admin email via magic link
   (needs the verified Resend domain from step 3), then verify `/health`
   returns JSON while authenticated and confirm `/admin/users` lists the
   seeded staff and `/admin/reference` lists the categories.
   Unauthenticated requests redirect to `/signin` — that is the
   deny-by-default gate working.
7. **Nightly backups — REQUIRED before AM-04 cutover sign-off** (advisor
   condition): set the `DATABASE_URL` repo secret in GitHub
   (Settings → Secrets → Actions) to the Neon connection string, then run the
   **Nightly DB backup** workflow manually and verify a green run with a
   non-empty dump artifact. Until the secret exists the workflow no-ops with
   a warning. Neon's free-tier restore window is short; after Asset Tiger is
   cancelled these dumps are the independent copy.
8. **Kenya DPA** — staff PII is processed in the EU; see
   [docs/DPA-TRANSFER-NOTE.md](docs/DPA-TRANSFER-NOTE.md). ODPC
   data-controller registration is the client's obligation via its own
   counsel — flag at handover.

## Runbook — data integrity

`Asset.status = 'ASSIGNED'` and the existence of an open `Assignment` row
(`returnedAt IS NULL`) are two halves of one invariant, maintained
transactionally in `src/lib/asset-admin.ts`. It **cannot** be enforced in SQL —
a CHECK constraint cannot reference another table — so direct SQL, or a future
write path that bypasses that module, can desynchronise them. Detection is by
reconciliation query; both halves must return zero rows.

```sql
-- Assets marked ASSIGNED with no open assignment
SELECT a."id", a."tag" FROM "Asset" a
WHERE a."status" = 'ASSIGNED'
  AND NOT EXISTS (SELECT 1 FROM "Assignment" x
                  WHERE x."assetId" = a."id" AND x."returnedAt" IS NULL);

-- Open assignments whose asset is not ASSIGNED
SELECT x."id", x."assetId" FROM "Assignment" x
JOIN "Asset" a ON a."id" = x."assetId"
WHERE x."returnedAt" IS NULL AND a."status" <> 'ASSIGNED';
```

When the two disagree, **the open `Assignment` row is the source of truth for
holdership** — `Asset.status = 'ASSIGNED'` is a transactionally-maintained
projection of it. Reconcile by bringing the asset's status back into line, never
by closing an assignment that was not actually returned: that would fabricate a
return in the audit trail.

Run it — and every other `psql` or Prisma command in this repo — against an
**explicitly named database**. The gitignored `.env` holds the **production**
`DATABASE_URL` and the Prisma CLI autoloads it, so a bare `pnpm db:migrate` or
`prisma studio` can silently hit production ([AM-01 retro](docs/retros/am-01.md),
item 5); `psql` has no such default, so pass the connection string every time:

```sh
psql "$TARGET_DATABASE_URL" -f reconcile.sql   # never a bare psql / prisma
```

## Intake artefacts

| Document                                                    | Purpose                                                                      |
| ----------------------------------------------------------- | ---------------------------------------------------------------------------- |
| [Discovery Brief](docs/intake/asset-mgt/DISCOVERY-BRIEF.md) | The problem, users, scope, build-vs-adopt decision, open assumptions         |
| [Solution Sketch](docs/intake/asset-mgt/SOLUTION.md)        | Technical shape: Next.js 15, Prisma/Postgres (Neon), Auth.js, PWA, Vercel    |
| [PRD](docs/intake/asset-mgt/PRD.md)                         | Seven stories in two milestones; Milestone 1 is the Asset Tiger cutover path |
| [Scaffold design](docs/DESIGN.md)                           | The approved skeleton this repo implements                                   |
| [ADR-001](docs/adr/ADR-001-vercel-neon-stack.md)            | Vercel + Neon stack decision and accepted risks                              |

---

Built by [App Artery](https://app-artery.com).
