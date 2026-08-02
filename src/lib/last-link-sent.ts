import "server-only";

/** One `VerificationToken.groupBy` row: an identifier and its newest send. */
export type LinkSendRow = {
  identifier: string;
  _max: { createdAt: Date | null };
};

/**
 * Fold `VerificationToken` sends into "when was a link last issued to this
 * address", keyed on the lowercased identifier.
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
 * Keyed lowercase on purpose. `@auth/core` normalises the identifier
 * (`.normalize("NFKC").toLowerCase().trim()`, `lib/actions/signin/send-token.js`)
 * and emails are lowercased at every write (CLAUDE.md), so in a healthy
 * database no two rows collide. This survives the unhealthy one: a row
 * predating either rule must not read as "never invited", which is the one
 * answer this column must never invent.
 */
export function lastLinkSentByEmail(rows: LinkSendRow[]): Map<string, Date> {
  const byEmail = new Map<string, Date>();
  for (const row of rows) {
    const sentAt = row._max.createdAt;
    if (!sentAt) continue;
    const identifier = row.identifier.trim().toLowerCase();
    const seen = byEmail.get(identifier);
    // Newest wins regardless of the order the rows arrived in. Without this,
    // the rendered timestamp is whichever row came last — non-deterministic
    // rather than merely wrong, which is the harder kind to notice.
    if (!seen || sentAt > seen) byEmail.set(identifier, sentAt);
  }
  return byEmail;
}
