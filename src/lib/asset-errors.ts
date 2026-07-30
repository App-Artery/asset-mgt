import "server-only";
import { Prisma } from "@prisma/client";
import {
  ConditionNotesRequiredError,
  PersonNotAssignableError,
  TagRequiredError,
} from "@/lib/asset-admin";
import { IllegalTransitionError } from "@/lib/asset-lifecycle";

/**
 * Maps write-path failures to the messages the asset forms show.
 *
 * Lives outside src/app/assets/actions.ts because a "use server" module may
 * only export async functions, which would make this logic reachable from a
 * test only through an action — and the TagRequiredError guard fires first on
 * every path that could otherwise produce a CHECK violation. Extracted so the
 * classification can be tested directly against real Postgres errors.
 */

export type ActionFailure = { ok: false; message: string };

export const DUPLICATE_TAG_MESSAGE = "An asset with that tag already exists.";
export const TAG_REQUIRED_MESSAGE =
  "A tag is required before this asset can move into stock.";
export const ILLEGAL_TRANSITION_MESSAGE =
  "That status change isn't allowed from this asset's current status.";
export const INVALID_FIELDS_MESSAGE =
  "Check the form: category, make and model are required, and any price must be zero or more.";
export const ALREADY_ASSIGNED_MESSAGE =
  "That asset is already assigned to someone. Refresh and take it back first.";
export const PERSON_NOT_ASSIGNABLE_MESSAGE =
  "That person's account has been deactivated, so they cannot be given assets.";
export const CONDITION_NOTES_REQUIRED_MESSAGE =
  "Add a note describing the condition — required for repairs and for poor or defective kit.";

/** The CHECK constraint the tag rule is enforced by (see the am02 migration). */
const TAG_CONSTRAINT = "Asset_tag_required_when_tracked";

/**
 * A violation of the tag CHECK constraint, in either shape Prisma reports it:
 * P2010 (PrismaClientKnownRequestError) from a raw query, and
 * PrismaClientUnknownRequestError with no `code` field from the model layer.
 * Both carry the constraint name in the message text.
 *
 * Matched on the constraint name, NOT on the SQLSTATE "23514". The client's tag
 * scheme is numeric, and Prisma echoes row and argument values into its error
 * messages — so an asset legitimately tagged "23514" makes any other error on
 * that row (a P2003 FK violation, say) match a bare SQLSTATE substring test and
 * get swallowed as a tag problem instead of being rethrown. Verified against
 * Postgres 17: the constraint name appears in both CHECK shapes and in neither
 * of the P2002/P2003 messages.
 */
export function isTagConstraintViolation(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) &&
    !(error instanceof Prisma.PrismaClientUnknownRequestError)
  ) {
    return false;
  }
  return error.message.includes(TAG_CONSTRAINT);
}

/**
 * Which unique index a P2002 came from, or null when it is one we do not
 * recognise and the caller must rethrow.
 *
 * Both indexes are matched POSITIVELY and anything else falls through to a
 * rethrow. An earlier version asked only "does the target mention tag?" and
 * treated every other P2002 as an assignment conflict — which is the exact
 * mistake this file's N2 lesson is about, one level up: a confidently wrong
 * sentence instead of a loud failure. Verified against real Postgres errors,
 * `Person.email` collides as `{modelName:"Person", target:["email"]}`, so that
 * default would have told an operator "that asset is already assigned to
 * someone" when a duplicate person was the actual problem.
 *
 * Shapes confirmed against Prisma 6.19.3 + Postgres 17, not assumed:
 *   tag         → { modelName: "Asset",      target: ["tag"] }
 *   assignment  → { modelName: "Assignment", target: ["assetId"] }
 */
type UniqueIndex = "tag" | "openAssignment";

function uniqueIndexFor(
  error: Prisma.PrismaClientKnownRequestError,
): UniqueIndex | null {
  const target = error.meta?.target;
  const parts = (
    Array.isArray(target)
      ? target.map(String)
      : typeof target === "string"
        ? [target]
        : []
  ).map((part) => part.toLowerCase());
  const model = String(
    (error.meta as { modelName?: unknown } | undefined)?.modelName ?? "",
  );

  if (model === "Asset" && parts.includes("tag")) {
    return "tag";
  }
  if (model === "Assignment" && parts.includes("assetid")) {
    return "openAssignment";
  }
  return null;
}

/**
 * Returns the form message for a known write failure, or null when the caller
 * must rethrow. Never maps AuthorizationError — that must always fail loudly.
 */
export function mapAssetError(error: unknown): ActionFailure | null {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    // P2002 is no longer synonymous with "duplicate tag": AM-03 added a second
    // unique index (Assignment_one_open_per_asset). Reporting an assignment
    // conflict as a tag collision would send the operator hunting for a tag
    // that was never the issue — the same reasoning as the tag/assetId split in
    // receiveAndTagAsset. An UNRECOGNISED unique index falls through to null:
    // the caller rethrows, and a new index announces itself as a real failure
    // rather than as a plausible-sounding lie about one of the two we know.
    switch (uniqueIndexFor(error)) {
      case "tag":
        return { ok: false, message: DUPLICATE_TAG_MESSAGE };
      case "openAssignment":
        return { ok: false, message: ALREADY_ASSIGNED_MESSAGE };
      default:
        return null;
    }
  }
  if (error instanceof PersonNotAssignableError) {
    return { ok: false, message: PERSON_NOT_ASSIGNABLE_MESSAGE };
  }
  if (error instanceof ConditionNotesRequiredError) {
    return { ok: false, message: CONDITION_NOTES_REQUIRED_MESSAGE };
  }
  if (error instanceof IllegalTransitionError) {
    return { ok: false, message: ILLEGAL_TRANSITION_MESSAGE };
  }
  // The app guard should mean the constraint never fires; it is defence in
  // depth for a path that reaches the DB without passing tagRequiredFor.
  if (error instanceof TagRequiredError || isTagConstraintViolation(error)) {
    return { ok: false, message: TAG_REQUIRED_MESSAGE };
  }
  return null;
}
