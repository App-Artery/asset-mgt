import "server-only";

/** One `VerificationToken.groupBy` row: an identifier and its newest send. */
export type LinkSendRow = {
  identifier: string;
  _max: { createdAt: Date | null };
};

/**
 * Fold an address to the join key both sides of this lookup must agree on.
 *
 * This is `@auth/core`'s own `defaultNormalizer`, step for step and in its
 * order (`lib/actions/signin/send-token.js`): `.normalize("NFKC")`, then
 * `.toLowerCase()`, then `.trim()`. That is what `sendToken` applies to the
 * address BEFORE `createVerificationToken` inserts it, so it is what is
 * actually sitting in `VerificationToken.identifier`.
 *
 * The order is copied verbatim rather than re-derived. No claim is made here
 * that the three steps commute — the point is that this fold and the one that
 * produced the stored value are the same fold by construction, so the question
 * never has to be answered.
 *
 * Exported so the fold below and the lookup in
 * `src/app/(app)/admin/users/page.tsx` cannot drift apart. They must apply the
 * IDENTICAL fold: a key normalised on only one side is worse than no
 * normalisation at all, because it turns a match into a miss and the column
 * then reports "No link sent yet" about somebody who was sent one.
 */
export function normaliseIdentifier(identifier: string): string {
  return identifier.normalize("NFKC").toLowerCase().trim();
}

/**
 * Fold `VerificationToken` sends into "when was a link last issued to this
 * address", keyed on the normalised identifier.
 *
 * ## Why this is a function and not four lines in the page
 *
 * It exists to be tested from both input orders, which is the only way to
 * demonstrate what it does. `groupBy` returns one row per EXACT identifier, so
 * the interesting case — two identifiers differing only in case, competing for
 * one map key — is decided entirely by the `> newest` comparison below.
 *
 * A real-DB test cannot prove that comparison. Postgres does not promise an
 * order for a GROUP BY without ORDER BY, so a test that inserts rows in a
 * chosen order and asserts on the result is asserting against whatever the
 * planner did that day: it passed here against a plain last-write-wins `set`,
 * which is precisely the guard-that-defends-nothing pattern this project keeps
 * hitting (issue #12). Feeding this function both permutations directly is
 * deterministic, and it fails for either one if the comparison goes.
 *
 * Keyed through `normaliseIdentifier` on purpose. `@auth/core` normalises the
 * identifier before insert and emails are lowercased at every write
 * (CLAUDE.md), so in a healthy database no two rows collide. This survives the
 * unhealthy one: a row predating either rule must not read as "never invited",
 * which is the one answer this column must never invent.
 */
export function lastLinkSentByEmail(rows: LinkSendRow[]): Map<string, Date> {
  const byEmail = new Map<string, Date>();
  for (const row of rows) {
    const sentAt = row._max.createdAt;
    if (!sentAt) continue;
    const identifier = normaliseIdentifier(row.identifier);
    const seen = byEmail.get(identifier);
    // Newest wins regardless of the order the rows arrived in. Without this,
    // the rendered timestamp is whichever row came last — non-deterministic
    // rather than merely wrong, which is the harder kind to notice.
    if (!seen || sentAt > seen) byEmail.set(identifier, sentAt);
  }
  return byEmail;
}
