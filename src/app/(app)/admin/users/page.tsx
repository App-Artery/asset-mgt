import { requireRole } from "@/lib/authz";
import { getDb } from "@/lib/db";
import { AddUserForm } from "./add-user-form";
import { UsersTable, type AdminUserRow } from "./users-table";

export default async function AdminUsersPage() {
  const { userId } = await requireRole("ADMIN_IT");
  const db = getDb();
  // One clock for the whole page, so no two rows disagree about "now"
  // (same rule as the asset history — src/lib/relative-time.ts).
  const now = new Date();

  const [users, linkSends] = await Promise.all([
    /**
     * `User.emailVerified` IS the last successful magic-link sign-in (issue
     * #11). Nothing in this codebase writes it — `grep -rn emailVerified src
     * prisma` returns only the schema and the init migration. The single
     * writer is the Auth.js adapter: `@auth/core` `handleLoginOrRegister`
     * (lib/actions/callback/handle-login.js) calls
     * `updateUser({ id, emailVerified: new Date() })` on EVERY successful
     * email redemption for a user that already exists, not only the first.
     * So null means "provisioned, never signed in", and a value is the
     * timestamp of the most recent sign-in.
     *
     * PRECONDITION — this holds ONLY while Resend is the sole provider.
     * That write sits behind `account.type === "email"`. An OAuth or WebAuthn
     * provider signs a user in without ever touching `emailVerified`, and
     * this column silently degrades to "last magic-link sign-in, if they ever
     * used one" — an admin reading "never signed in" about somebody who signs
     * in daily. `src/auth.providers.test.ts` asserts the config has exactly
     * one provider and goes red the moment a second is added, which is what
     * forces whoever adds it back to this comment.
     *
     * Deliberately NOT a `User.lastSignedInAt` column: that buys a migration
     * and a write on the sign-in path to store what the adapter already
     * stores, and `@auth/core` awaits `events.signIn` with no local
     * try/catch — a throwing write becomes a `CallbackRouteError` and dumps
     * the user back on /signin. The cost of getting that wrong is a lockout;
     * the cost of `emailVerified` rotting on an upgrade is a wrong label.
     * `next-auth` is pinned to a beta, so the real-DB test in
     * `page.integration.test.tsx` drives the adapter itself and is what makes
     * such an upgrade loud. (Advisor ruling, issue #11.)
     */
    db.user.findMany({
      orderBy: { email: "asc" },
      select: {
        id: true,
        name: true,
        email: true,
        role: true,
        deactivatedAt: true,
        emailVerified: true,
        person: { select: { employeeRef: true } },
      },
    }),
    /**
     * Companion signal: was a magic link ever issued for this address?
     *
     * `emailVerified` alone cannot tell "invited, link never arrived" from
     * "never invited" — and the first of those is the symptom this screen
     * exists to catch (`AUTH_EMAIL_FROM` drifting off the Resend-verified
     * domain silently limits delivery to the account owner, and the user just
     * never appears).
     *
     * `identifier` and `createdAt` ONLY, NEVER `token`. `token` is the bearer
     * credential in the magic link; selecting it would ship a working
     * sign-in link for another person inside this page's payload.
     *
     * Strictly read-only. `src/lib/sign-in-policy.ts` counts these same rows
     * for the send throttle, so deleting or pruning them to tidy this display
     * would silently widen the rate limit.
     *
     * A surviving row means "issued and not redeemed": `@auth/prisma-adapter`
     * `useVerificationToken` DELETEs the row on successful use, so a consumed
     * link leaves nothing behind. Not filtered by `expires` on purpose — an
     * undelivered link that has since timed out is exactly the case being
     * hunted, and excluding it would report that person as never invited.
     */
    db.verificationToken.groupBy({
      by: ["identifier"],
      _max: { createdAt: true },
    }),
  ]);

  /**
   * Keyed on the lowercased address on BOTH sides. `@auth/core` normalises the
   * identifier before insert (lib/actions/signin/send-token.js) and user
   * emails are lowercased at every write (CLAUDE.md) — but matching raw would
   * turn any row that predates either rule into a silent "never invited",
   * which is the one answer this column must never get wrong.
   */
  const lastLinkSentByEmail = new Map<string, Date>();
  for (const send of linkSends) {
    const sentAt = send._max.createdAt;
    if (!sentAt) continue;
    const identifier = send.identifier.trim().toLowerCase();
    const seen = lastLinkSentByEmail.get(identifier);
    if (!seen || sentAt > seen) {
      lastLinkSentByEmail.set(identifier, sentAt);
    }
  }

  const rows: AdminUserRow[] = users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    employeeRef: user.person?.employeeRef ?? null,
    role: user.role,
    deactivated: user.deactivatedAt !== null,
    lastSignInAt: user.emailVerified,
    lastLinkSentAt:
      lastLinkSentByEmail.get(user.email.trim().toLowerCase()) ?? null,
  }));

  return (
    <>
      {/* Data first, the control one step away (AM-09 DESIGN §3 rule 1): the
          roster is what this page is for, and provisioning is what you came to
          do about twice a month. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <AddUserForm />
      </div>
      <UsersTable users={rows} currentAdminId={userId} now={now} />
    </>
  );
}
