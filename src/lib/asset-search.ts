import "server-only";
import type { Prisma } from "@prisma/client";

/**
 * THE register search predicate (AM-07, issue #7).
 *
 * `assetSearchWhere(q)` takes a string and returns a clause over ASSET
 * ATTRIBUTES — tag, serial, make, model, and the category's name. Nothing else.
 * It has no `Role` parameter, and that absence is the whole security design of
 * this feature: a signature rather than a comment.
 *
 * ## Why there is no role argument
 *
 * The obvious shape for "search staff names as well, but only for roles allowed
 * to see who holds what" is a conditional where-fragment, gated on the same
 * role predicate the register's holder column already branches on:
 * `canView…(role) ? {…} : {}`. That is convention plus a tripwire, not
 * structure. Delete the ternary and this module still compiles, still
 * typechecks, and still passes everything except the one bespoke test somebody
 * remembered to write.
 *
 * The risk it would be guarding is not cosmetic either. A holder-name predicate
 * discloses who holds what even when no name is rendered anywhere, because the
 * RESULT SET is itself the disclosure: a reader types "grace", gets four
 * laptops back, and has learnt exactly what the register refuses to show them.
 * Rendering less does not help; the filter has to not exist.
 *
 * So the branch does not exist here. `/assets?q=` is asset-attribute-only and
 * therefore identical for every role — a property a test can assert head-on
 * (search the same term as ADMIN_IT and as STAFF_RO, compare the ids) and one
 * that fails loudly for ANY role-dependent search behaviour, not merely for the
 * one variant we thought of. The "who has Grace's laptop" lookup belongs
 * instead on a role-gated `/people` index, where route-level gating is the
 * guard — the only rung in this design that actually holds. That is a separate
 * issue and a separate consult.
 *
 * **No holder-name predicate may be added to `/assets` without a new advisor
 * ruling.** The T3 ruling on issue #7 is explicit about it.
 *
 * ## Why event notes are absent
 *
 * `AssetEvent.notes` is operator-typed free text rendered to all four roles,
 * and CLAUDE.md names it as the one place the no-staff-data-in-event-tables
 * rule can be bypassed — by a human typing a name into a box. Making it
 * searchable would hand every reader the name index this application
 * deliberately does not keep. Its absence is guarded behaviourally, not by
 * grep: `src/app/(app)/assets/page.integration.test.tsx` seeds an event note
 * containing a nonce and asserts that searching that nonce returns zero assets
 * for every role, including ADMIN_IT. A grep-guard would pass the moment
 * somebody reached notes through a relation filter spelled differently.
 *
 * ## Auditing this module
 *
 * Search this file for the two holder-side model names — the one carrying staff
 * PII and the one linking it to an asset. Both are named in the CLAUDE.md
 * non-negotiable governing what a STAFF_RO reader may see; neither is written
 * out anywhere above, because a docblock quoting the grep would defeat it.
 * Zero hits is the invariant.
 */

/**
 * Collapse runs of whitespace and trim, before anything is matched.
 *
 * `contains` is whitespace-sensitive (LEARNINGS §Zod), so a tag pasted out of a
 * spreadsheet as `"ThinkPad  X1 "` matches nothing at all against a model
 * stored as `"ThinkPad X1"` — a search that silently returns an empty register
 * for input that looks correct on screen.
 *
 * Exported because the page normalises at the PARSE boundary, so that one
 * string feeds the predicate, the exact-tag lookup, every link on the page and
 * the input's own value. `assetSearchWhere` applies it again regardless: a
 * caller who has not normalised is precisely the case that produces the silent
 * empty result set, and the operation is idempotent, so the second application
 * costs nothing.
 */
export function normaliseSearchTerm(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/**
 * The `?q=` clause: asset attributes only, the same for every role.
 *
 * A reviewer who sees a `role` parameter grow onto this signature should reject
 * the change without reading further — see the module docblock.
 */
export function assetSearchWhere(q: string): Prisma.AssetWhereInput {
  const contains = normaliseSearchTerm(q);

  // `mode: "insensitive"` on every branch. Postgres LIKE is case-sensitive, so
  // without it a search for `thinkpad` misses every `ThinkPad` the importer
  // wrote, and the feature only works for readers who type the way the CSV did.
  //
  // No trigram index, deliberately: `ILIKE '%…%'` is a Seq Scan, and at 402
  // rows today (a client projection near 4,000) that is the correct plan.
  // Revisit `pg_trgm` + GIN somewhere above ~50k rows, and verify with EXPLAIN
  // ANALYZE rather than assuming (LEARNINGS §Prisma).
  return {
    OR: [
      { tag: { contains, mode: "insensitive" } },
      { serial: { contains, mode: "insensitive" } },
      { make: { contains, mode: "insensitive" } },
      { model: { contains, mode: "insensitive" } },
      { category: { name: { contains, mode: "insensitive" } } },
    ],
  };
}
