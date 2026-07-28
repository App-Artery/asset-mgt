import "server-only";
import { redirect } from "next/navigation";
import type { Role } from "@prisma/client";
import { auth } from "@/auth";
import { getDb } from "@/lib/db";

/**
 * Thrown when an authenticated user lacks the required role. Mutating
 * handlers must let this propagate (fail loudly) — never swallow it.
 */
export class AuthorizationError extends Error {
  constructor(required: readonly Role[]) {
    super(`Requires one of roles: ${required.join(", ")}`);
    this.name = "AuthorizationError";
  }
}

/**
 * THE authorisation chokepoint (docs/DESIGN.md security constraint 2).
 *
 * `await requireRole(...)` MUST be the first statement of every mutating
 * server action and route handler — no exceptions. This is deliberately the
 * only authorisation helper in the codebase so review can verify coverage
 * mechanically (grep for mutating actions without it).
 *
 * - Actor identity comes from the session (never from client input).
 * - The role is read from the DB on every call — never from the JWT — which
 *   is what makes role changes effective without redeploy (AM-01 AC).
 * - A deactivated user is unauthorized regardless of role: this is the leaver
 *   kill-switch for live JWT sessions, and it works precisely because status
 *   is DB-read per request, never trusted from the token.
 * - Unauthenticated → redirect to sign-in. Wrong role → AuthorizationError.
 */
export async function requireRole(
  ...allowed: Role[]
): Promise<{ userId: string; role: Role }> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    redirect("/signin");
  }
  const user = await getDb().user.findUnique({
    where: { id: userId },
    select: { role: true, deactivatedAt: true },
  });
  if (!user || user.deactivatedAt !== null || !allowed.includes(user.role)) {
    throw new AuthorizationError(allowed);
  }
  return { userId, role: user.role };
}
