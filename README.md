# Asset Management Tool

Cloud-based IT asset lifecycle management — an internal tool replacing Asset Tiger. Tracks every tagged asset (laptops, phones, desktops, printers, accessories) from purchase through assignment, repair, and retirement, under the organisation's own numeric tag scheme.

**Status:** intake complete — verdict **go**. Delivery not yet started.

## Intake artefacts

| Document | Purpose |
| --- | --- |
| [Discovery Brief](docs/intake/asset-mgt/DISCOVERY-BRIEF.md) | The problem, users, scope, build-vs-adopt decision, open assumptions |
| [Solution Sketch](docs/intake/asset-mgt/SOLUTION.md) | Technical shape: Next.js 15, Prisma/Postgres (Neon), Auth.js, PWA, Vercel |
| [PRD](docs/intake/asset-mgt/PRD.md) | Seven stories in two milestones; Milestone 1 is the Asset Tiger cutover path |

## Next steps

1. `/scaffold` — bootstrap the application from the approved Discovery Brief.
2. `/ship` — first story **AM-01 (auth/roles, Tier 3)**, advisor review mandatory.

---

Built by [App Artery](https://app-artery.com).
