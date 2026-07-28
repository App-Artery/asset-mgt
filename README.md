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
pnpm dev                     # http://localhost:3000
```

Everything is auth-gated (deny-by-default middleware); until AM-01 seeds
users, pages redirect to the sign-in route. `GET /health` returns build info
once authenticated.

### Scripts

| Command                                                   | What it does                                                                                         |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `pnpm dev` / `pnpm build` / `pnpm start`                  | Next.js dev / production build / serve                                                               |
| `pnpm lint` / `pnpm typecheck`                            | ESLint (flat config) / `tsc --noEmit`                                                                |
| `pnpm test`                                               | Vitest. Real-DB integration tests run only when `TEST_DATABASE_URL` is set — with it unset they skip |
| `pnpm db:migrate` / `pnpm db:deploy` / `pnpm db:generate` | Prisma migrate dev / deploy / generate                                                               |
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
6. **Deploy** — push to `main`; verify `/health` on the production URL
   (expect a redirect to sign-in when unauthenticated — the app is
   deny-by-default; the JSON body needs a session).
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
