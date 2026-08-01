import type { AssetCondition, AssetEventType, Role } from "@prisma/client";

/**
 * Human labels for the enums this app renders (AM-09 DESIGN §4.1).
 *
 * The app already had one of these — `STATUS_LABELS`, which deliberately lives
 * beside the transition map in `asset-lifecycle.ts` because status labels and
 * status transitions must not drift apart. It is not moved here: the rule is one
 * label map per enum, not one module for all of them.
 *
 * Everything else rendered its database value. A register row read
 * "In repair … DEFECTIVE" — two vocabularies in adjacent columns, one of them
 * shouting. These maps close that.
 *
 * Client-safe by construction: the only import is a type, so no module here
 * drags the Prisma client into the browser bundle. Same rule as
 * `asset-lifecycle.ts` and `status-chip.tsx`.
 *
 * Each map is typed `Record<Enum, string>` rather than a looser lookup, so
 * adding a value to the schema fails `tsc` here instead of rendering raw in a
 * table months later.
 */

/** Asset condition, an ordinal scale from best to worst. */
export const CONDITION_LABELS: Readonly<Record<AssetCondition, string>> = {
  NEW: "New",
  GOOD: "Good",
  FAIR: "Fair",
  POOR: "Poor",
  DEFECTIVE: "Defective",
};

/**
 * The order conditions are offered in — best to worst, which is the scale's own
 * order and not alphabetical.
 *
 * This lives here, not in the form that renders it, because it used to live in
 * the form: a hand-maintained tuple of string literals with nothing connecting
 * it to the schema, so a condition added to Prisma would simply never appear in
 * its own picker. `satisfies readonly AssetCondition[]` rejects a value that is
 * not in the enum; the set-equality test in labels.test.ts covers the direction
 * types cannot — a value in the enum that is missing here.
 */
export const CONDITION_ORDER = [
  "NEW",
  "GOOD",
  "FAIR",
  "POOR",
  "DEFECTIVE",
] as const satisfies readonly AssetCondition[];

/**
 * Roles, named for what the person does rather than what the enum says.
 *
 * `STAFF_RO` reads "Staff (read-only)" and not "Staff": read-only is the whole
 * point of the role, it is what an admin is choosing when they pick it, and the
 * parenthetical is the only place in the UI that says so.
 */
export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  ADMIN_IT: "IT admin",
  PROCUREMENT: "Procurement",
  FINANCE: "Finance",
  STAFF_RO: "Staff (read-only)",
};

/**
 * The order roles are offered in — least privileged first, so the default
 * landing spot in a picker is the safest one. Same reasoning as
 * `CONDITION_ORDER`: it was a hand-maintained tuple in the add-user form with
 * nothing tying it to the enum.
 */
export const ROLE_ORDER = [
  "STAFF_RO",
  "PROCUREMENT",
  "FINANCE",
  "ADMIN_IT",
] as const satisfies readonly Role[];

/**
 * Asset event types, as they read in an asset's history.
 *
 * Deliberately past tense: every row in that table is something that already
 * happened, and the append-only trail never describes an intention.
 *
 * `STATUS_CHANGED` is the catch-all the write layer uses for any transition that
 * neither opens nor closes an assignment, so its label stays equally general —
 * the history answers "what changed" from the `fromStatus`/`toStatus` pair
 * rendered beside it, never from the event type alone (CLAUDE.md).
 */
export const EVENT_TYPE_LABELS: Readonly<Record<AssetEventType, string>> = {
  CREATED: "Created",
  UPDATED: "Updated",
  STATUS_CHANGED: "Status changed",
  ASSIGNED: "Assigned",
  RETURNED: "Returned",
  IMPORTED: "Imported",
  CORRECTION: "Correction",
};
