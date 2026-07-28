import "server-only";
import type { PrismaClient } from "@prisma/client";

/**
 * Sign-in admission policy — the single decision point behind the Auth.js
 * `signIn` callback (src/auth.ts). Extracted so the real-DB test matrix
 * exercises the exact code path production uses.
 *
 * Every rejection returns a bare `false`: unknown email, deactivated user and
 * throttled request are indistinguishable to the caller. The uniform /signin
 * UX (no enumeration oracle) depends on this function never growing distinct
 * error signals.
 */

/** Max magic-link requests per email address per window. */
export const PER_EMAIL_LIMIT = 3;
export const PER_EMAIL_WINDOW_MS = 15 * 60 * 1000;
/**
 * Global cap across all addresses. The Resend free tier (100 emails/day) is
 * the DoS target during cutover week — burning it locks all staff out — so
 * the cap protects the quota, not any single mailbox.
 */
export const GLOBAL_LIMIT = 30;
export const GLOBAL_WINDOW_MS = 60 * 60 * 1000;

export async function isSignInAllowed(
  db: PrismaClient,
  rawEmail: string | null | undefined,
  { verificationRequest }: { verificationRequest: boolean },
): Promise<boolean> {
  if (!rawEmail) {
    return false;
  }
  // Lowercase at every lookup — a case mismatch silently locks out staff.
  const email = rawEmail.trim().toLowerCase();

  const user = await db.user.findUnique({
    where: { email },
    select: { deactivatedAt: true },
  });
  // No open signup: only provisioned users sign in. Deactivation blocks new
  // sessions here; requireRole kills live JWT sessions at next request.
  if (!user || user.deactivatedAt !== null) {
    return false;
  }

  // Throttle only the email-send flow (`verificationRequest`), not the
  // link-click verification. Counts run BEFORE the adapter inserts this
  // request's token, so the limit means "at most N sends per window".
  if (verificationRequest) {
    const now = Date.now();
    const [perEmail, global] = await Promise.all([
      db.verificationToken.count({
        where: {
          identifier: email,
          createdAt: { gte: new Date(now - PER_EMAIL_WINDOW_MS) },
        },
      }),
      db.verificationToken.count({
        where: { createdAt: { gte: new Date(now - GLOBAL_WINDOW_MS) } },
      }),
    ]);
    if (perEmail >= PER_EMAIL_LIMIT || global >= GLOBAL_LIMIT) {
      return false;
    }
  }

  return true;
}
