# Solution Sketch — Internal IT Asset Register (`asset-mgt`)

- **Date:** 2026-07-24
- **Effort band:** **M**
- **Companion docs:** `DISCOVERY-BRIEF.md` (why), `PRD.md` (what, in order)

## Stack

- **Application:** Next.js 15 (App Router, TypeScript) as a single full-stack app — server actions/route handlers for mutations. A separate NestJS service is *not* justified at 3 writers / 70 readers doing CRUD and reports; introduce one only if the Oracle integration later demands long-running jobs.
- **Data:** PostgreSQL + Prisma.
- **UI:** Tailwind CSS v4 + shadcn/ui; mobile-first layouts for the flows field workers touch (lookup, assign, return).
- **Auth:** Auth.js — provider depends on the client's IdP (open assumption 4 in the brief): org SSO if Google Workspace/M365 exists, otherwise email magic-link via SES. Role claims: `ADMIN_IT`, `PROCUREMENT`, `FINANCE`, `STAFF_RO`.
- **PWA:** web manifest + service worker; installable on Android/iOS; cached reads only — no offline writes at MVP.
- **Infra (Terraform, AWS):** OpenNext on Lambda + CloudFront; Aurora Serverless v2 with 0-ACU auto-pause (fallback: smallest RDS instance if ASv2 auto-pause is unavailable in the chosen region — verify at scaffold); SES for auth email. Region: af-south-1 vs eu-west-1 decided at scaffold with Kenya DPA transfer safeguards documented.

## Data shape

```
Asset       id, tag (unique, NULLABLE until delivery), categoryId, make, model, serial,
            purchasedAt, purchasePrice, supplier, warrantyUntil, status, condition, siteId
Person      id, name, email, employeeRef   ← employee number, NOT national ID (brief §7.3)
Assignment  id, assetId, personId, checkedOutAt, returnedAt, conditionNotes
AssetEvent  id, assetId, type, fromStatus, toStatus, actorId, notes, at   ← append-only audit trail
Category    id, name                       ← "any IT asset": laptops → headphones
Site        id, name
User        id, personId, role
ImportBatch id, source, runAt, dryRun, rowsOk, rowsFailed, report
```

**Lifecycle:** `ON_ORDER → IN_STOCK` (tag assigned at delivery) `↔ ASSIGNED`; `{IN_STOCK, ASSIGNED} → IN_REPAIR → IN_STOCK`; any → `RETIRED`. Client's reality is repair-heavy — most stock is used/in-repair/repaired, hardly ever new — so the repair loop and condition tracking are first-class, not edge cases. All transitions validated and appended to `AssetEvent`.

## Integration points

1. **Asset Tiger import** — client holds a backup/export; schema unknown until inspected (week 1). Import harness: dry-run with row-level error report, idempotent re-runs, reconciliation against Asset Tiger totals.
2. **Finance export** — v1 is a CSV/report export whose columns are agreed with the finance user in week 1. The client's Oracle product is unidentified; direct API integration is post-MVP.
3. **Org IdP** — TBC; determines Auth.js provider.
4. **SES** — auth email (and post-MVP alerts).

## Risky decisions

1. **Hosting: scale-to-zero vs always-on.** The build's economics only hold if idle cost is near zero — an always-on minimal footprint (~$25–40/month) exceeds the subscription being escaped. Recommend Lambda + Aurora Serverless v2 auto-pause; cold starts of a few seconds are acceptable for an internal tool. **ADR at scaffold**; verify ASv2 0-ACU support in the chosen region first.
2. **Auth and identity.** Provider choice (SSO vs magic-link) and the decision to store `employeeRef` rather than national ID. Security-touching → **floors at Tier 3, advisor review mandatory** (studio rule).
3. **Finance "integration" as an export contract.** Building against an unidentified Oracle product would be speculation; v1 ships a stable, versioned export whose shape finance signs off. Risk accepted and named in the brief; direct integration is a post-MVP story once the product is identified.

## Cost sanity check

Target run cost: single-digit dollars/month at this usage (Lambda + CloudFront within/near free tiers; ASv2 pausing to storage-only when idle; SES cents). This is the number that makes "own it instead of renting it" true rather than rhetorical.
