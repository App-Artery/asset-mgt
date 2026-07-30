import "server-only";
import { Prisma } from "@prisma/client";
import { PersonNotAssignableError, TagRequiredError } from "@/lib/asset-admin";
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
 * Whether a P2002 came from the `Asset.tag` unique index rather than AM-03's
 * `Assignment_one_open_per_asset`.
 *
 * Prisma reports the offending index/field in `meta.target` — field names for
 * schema-declared uniques, the DB constraint name for the hand-written partial
 * index (which the Prisma schema cannot see). Only these two unique indexes
 * exist on the asset write path, so "mentions tag" is a complete discriminator
 * TODAY. Adding a third unique index means revisiting this function — pinned by
 * a real-DB test asserting each message against a genuine Postgres error, not
 * an assumed error shape.
 */
function isTagUniqueViolation(
  error: Prisma.PrismaClientKnownRequestError,
): boolean {
  const target = error.meta?.target;
  const parts = Array.isArray(target)
    ? target.map(String)
    : typeof target === "string"
      ? [target]
      : [];
  return parts.some((part) => part.toLowerCase().includes("tag"));
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
    // receiveAndTagAsset. Discriminate on the target before claiming a cause.
    return {
      ok: false,
      message: isTagUniqueViolation(error)
        ? DUPLICATE_TAG_MESSAGE
        : ALREADY_ASSIGNED_MESSAGE,
    };
  }
  if (error instanceof PersonNotAssignableError) {
    return { ok: false, message: PERSON_NOT_ASSIGNABLE_MESSAGE };
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
