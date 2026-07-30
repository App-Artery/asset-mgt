import type { AssetCondition, AssetStatus } from "@prisma/client";

/**
 * The asset lifecycle as data (docs/features/AM-02/PLAN.md §Lifecycle):
 *
 *   ON_ORDER ──tag──> IN_STOCK <──> ASSIGNED
 *                        ↑             │
 *                        └── IN_REPAIR ┘      any ──> RETIRED (terminal)
 *
 * Pure and dependency-free — the only import is a type, so the 5×5 matrix is a
 * fast unit test rather than a DB round-trip, and the module is importable from
 * both server and client code.
 *
 * IN_STOCK <-> ASSIGNED are in the map but have NO UI in AM-02: AM-03 owns
 * assignment. The map is deliberately complete now so AM-03 adds assignment
 * records and screens without touching lifecycle logic.
 */
export const ASSET_TRANSITIONS: Readonly<
  Record<AssetStatus, readonly AssetStatus[]>
> = {
  ON_ORDER: ["IN_STOCK", "RETIRED"],
  IN_STOCK: ["ASSIGNED", "IN_REPAIR", "RETIRED"],
  ASSIGNED: ["IN_STOCK", "IN_REPAIR", "RETIRED"],
  IN_REPAIR: ["IN_STOCK", "RETIRED"],
  // Terminal. Un-retiring a mistakenly-retired asset is a post-MVP
  // CORRECTION-event path, deliberately deferred (PLAN.md §Decisions 1).
  RETIRED: [],
};

/**
 * Human-readable status names. Lives here, beside the transition map, so the
 * register and the detail page cannot drift into showing the same status two
 * different ways. Client-safe: this module's only import is a type.
 */
export const STATUS_LABELS: Readonly<Record<AssetStatus, string>> = {
  ON_ORDER: "On order",
  IN_STOCK: "In stock",
  ASSIGNED: "Assigned",
  IN_REPAIR: "In repair",
  RETIRED: "Retired",
};

/** Statuses that do not require a tag — mirrors the exemptions in the DB CHECK. */
const TAG_EXEMPT_STATUSES: readonly AssetStatus[] = ["ON_ORDER", "RETIRED"];

/**
 * Whether a return must carry a free-text condition note (AM-03 DESIGN §4.4).
 *
 * The AssetCondition enum is mandatory on EVERY return — that is the structured
 * field answering "in what state", and it is one click. Prose is demanded only
 * where it carries information: kit going to repair, or coming back POOR or
 * DEFECTIVE. Requiring it on every routine "GOOD, back on the shelf" return
 * trains operators to type "ok" and destroys the signal.
 *
 * Compared as string literals rather than through the Prisma enum objects on
 * purpose: this module is client-safe, and a value import of @prisma/client
 * would drag the client into the browser bundle.
 */
export function conditionNotesRequiredFor(
  toStatus: AssetStatus,
  condition: AssetCondition,
): boolean {
  return (
    toStatus === "IN_REPAIR" ||
    condition === "POOR" ||
    condition === "DEFECTIVE"
  );
}

/** Rejection of a status change the lifecycle does not permit. */
export class IllegalTransitionError extends Error {
  readonly from: AssetStatus;
  readonly to: AssetStatus;

  constructor(from: AssetStatus, to: AssetStatus) {
    super(`Illegal asset status transition: ${from} -> ${to}`);
    this.name = "IllegalTransitionError";
    this.from = from;
    this.to = to;
  }
}

/**
 * True when `to` is reachable from `from`. A self-transition is FALSE, not a
 * silent no-op: re-submitting "send to repair" on an already-in-repair asset is
 * a stale form, and the audit trail must not record a change that never
 * happened.
 */
export function canTransition(from: AssetStatus, to: AssetStatus): boolean {
  return ASSET_TRANSITIONS[from].includes(to);
}

/** canTransition, as a guard. Throws IllegalTransitionError carrying from/to. */
export function assertTransition(from: AssetStatus, to: AssetStatus): void {
  if (!canTransition(from, to)) {
    throw new IllegalTransitionError(from, to);
  }
}

/**
 * Mirrors the `Asset_tag_required_when_tracked` CHECK constraint
 * (prisma/migrations/20260729141256_am02_asset_lifecycle): a tag is mandatory
 * from delivery onwards, exempt only for ON_ORDER (not yet delivered) and
 * RETIRED (dead-on-arrival kit may never have earned one).
 *
 * This is the friendly-message guard; the constraint is the real enforcement.
 */
export function tagRequiredFor(status: AssetStatus): boolean {
  return !TAG_EXEMPT_STATUSES.includes(status);
}
