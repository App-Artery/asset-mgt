# AM-01 Design — Authentication and Roles

- **Tier:** T3 (auth/PII — security floor; advisor review of the final diff mandatory before merge)
- **Date:** 2026-07-28
- **Status:** Approved (Kelvin, 2026-07-28) — including the admin-users-screen scope call
- **Inputs:** PRD story AM-01 · advisor story ruling 2026-07-28 · scaffold `docs/DESIGN.md` (constraints inherited)

## Scope

Seed-based provisioning **plus a minimal admin users screen** — list, add (creates Person+User), change role, deactivate/reactivate. Nothing else: no invites, no bulk edit (bulk arrives with AM-04's import). The admin screen is AC-driven, not gold-plating: "role changeable at runtime by ADMIN_IT" already forces the surface to exist, and add/deactivate is the marginal delta that closes the new-starter flow before cutover. **This is the one place the ruling adds visible scope to the story — flagged per advisor.**

## Schema delta

- `User.deactivatedAt DateTime?` — deactivation is a flag, **never a delete** (deleting a User would sever AssetEvent actor attribution).
- New `UserEvent` model mirroring the AssetEvent pattern: `id, userId (subject), actorId, type (CREATED | ROLE_CHANGED | DEACTIVATED | REACTIVATED), fromRole?, toRole?, at`. **Append-only — no update/delete path is ever written; corrections are new events.** The audit insert happens in the same transaction as the mutation it records.

## Flows

**Sign-in (custom page, uniform response).** One email field. Every outcome — link sent, unknown email, deactivated user, throttled — returns the same "if your address is registered, a link has been sent" message; the default Auth.js pages are an enumeration oracle (unknown → visible AccessDenied) and are not used. Error page mapping stays generic.

**Throttle (Postgres-backed, no new infra).** In the existing `signIn` callback, count recent `VerificationToken` rows: max 3 requests per email per 15 min, global cap ~30/hour. The Resend 100/day cap is the DoS _target_ (burning it locks all staff out during cutover week), not a defence.

**Seed.** Idempotent script: reads a **gitignored** staff CSV (path via env/arg; real names+emails are Kenya-DPA personal data and never enter the repo — a synthetic example CSV ships instead) → creates Person+User rows, emails lowercased. First admin via `SEED_ADMIN_EMAIL`: creates-or-promotes exactly that user to `ADMIN_IT`; refuses to run unset; never downgrades an existing admin; no admin identity hardcoded. Residual risk is the admin mailbox itself — **client must keep it an org mailbox with MFA** (named client responsibility).

**Admin mutations.** All go through `requireRole("ADMIN_IT")` (sole authz helper, unchanged) and write their `UserEvent` in the same transaction. **Last-admin guard:** demotion or deactivation that would leave zero active admins is rejected transactionally (count active admins excluding the subject). Self-demotion allowed when another active admin remains; UI confirm only.

**Deactivation kill-switch.** Checked in BOTH the `signIn` callback (blocks new sessions) and `requireRole` (kills live JWT sessions at next request — works precisely because both read the DB, never the token).

## Session parameters

JWT `maxAge` **14 days** (identity only — roles/active-status are DB-read per request; a stolen field phone shouldn't hold a month of access). Magic-link token TTL **15 minutes** (delivery is seconds; Auth.js' 24h default is needless exposure). Single-use via adapter token consumption (review confirms).

**Email normalisation:** sign-in lookup and seed both store/compare lowercase — a case mismatch silently locks out staff.

## Real-DB test matrix (PRD "real DB"; LEARNINGS §Testing)

1. `signIn` rejects unknown email; rejects deactivated user.
2. `requireRole` across all four roles × allowed/denied combinations.
3. Role change effective on next request, same session, no redeploy.
4. Last-admin guard holds under the race (two concurrent demotions → one rejected).
5. Throttle trips at the per-email limit.
6. `UserEvent` written atomically with the role change; absent when the mutation fails.
7. Seed idempotency: re-run creates no duplicates, never downgrades the admin.

## Out of scope

Invites, bulk operations, SSO (open assumption — arrives if the client IdP materialises), password anything, org-mailbox MFA (client obligation), Resend domain verification (runbook item — must be done before UAT).
