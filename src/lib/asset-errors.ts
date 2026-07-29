import "server-only";
import { Prisma } from "@prisma/client";
import { TagRequiredError } from "@/lib/asset-admin";
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
 * Returns the form message for a known write failure, or null when the caller
 * must rethrow. Never maps AuthorizationError — that must always fail loudly.
 */
export function mapAssetError(error: unknown): ActionFailure | null {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    return { ok: false, message: DUPLICATE_TAG_MESSAGE };
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
