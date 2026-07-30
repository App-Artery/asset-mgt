import "server-only";
import { Role, type Prisma } from "@prisma/client";

/**
 * THE person-data visibility chokepoint (AM-03 DESIGN §5.2, advisor condition 8).
 *
 * `personSelectFor(role)` is the ONLY place in this codebase a `Person` select
 * carrying PII may be written. That singularity is what makes the PII rule
 * verifiable the way `requireRole` is.
 *
 * To audit, grep BOTH shapes — a nested relation select and a direct query:
 *
 *   rg "person: \{ select|\.person\.find" src/
 *
 * Two hits are legitimate and are NOT chokepoint violations. They are named
 * here because an audit instruction that produces an unexplained false positive
 * on its first use teaches the next reviewer to wave hits through, which
 * destroys the property this docblock exists to create:
 *
 *   - `src/app/admin/users/page.tsx` — selects `employeeRef` only, on an
 *     ADMIN_IT-only route (predates AM-03). Narrower than
 *     personSelectFor(ADMIN_IT), so it cannot over-disclose.
 *   - `src/lib/asset-admin.ts` (the leaver guard) — selects `id` and the linked
 *     user's `deactivatedAt`. No PII field, and the row never leaves the
 *     function. Note it is `tx.person.findUnique`, which the first grep shape
 *     alone does not find — hence the second.
 *
 * Any OTHER hit selecting a Person field is a bug.
 *
 *   Field                 ADMIN_IT  PROCUREMENT  FINANCE  STAFF_RO
 *   Person.name           yes       yes          yes      own only
 *   Person.employeeRef    yes       yes          yes      no
 *   Person.email          yes       no           no       no
 *
 * `employeeRef`, not email, is the assign picker's disambiguator for two staff
 * with the same name: it is the organisation's own internal number — the field
 * the brief chose INSTEAD of a national ID (brief §7.3) — and unlike an email it
 * cannot be used to contact or enumerate anyone outside the tool. Email has no
 * operational purpose in assignment, so only ADMIN_IT (who administers the
 * accounts anyway) sees it.
 *
 * FINANCE is included deliberately: AM-05 gives finance an export built on this
 * data, and granting the export while denying the screen is incoherent.
 *
 * The tiers are enforced in the Prisma `select` — NEVER by rendering less in
 * JSX. Data that is not fetched cannot leak through a later UI change.
 */
export function personSelectFor(role: Role) {
  return {
    id: true,
    name: true,
    employeeRef: role !== Role.STAFF_RO,
    email: role === Role.ADMIN_IT,
  } satisfies Prisma.PersonSelect;
}

/**
 * Whether this role may see ANY person's assignment data — current holder,
 * holder history, the person views.
 *
 * `STAFF_RO` is false everywhere: a read-only staff user sees no holder and no
 * holder history anywhere in the app, and their own assignments only via
 * /me/assignments, whose scope is derived server-side from the session rather
 * than from any request input (DESIGN §5.1).
 *
 * Callers must branch on this BEFORE the query — the assignment data is not
 * fetched for a STAFF_RO viewer, not merely unrendered (advisor condition 9).
 * Widening this requires a review of docs/DPA-TRANSFER-NOTE.md, because the
 * minimisation claim we made in writing is what it implements.
 */
export function canViewAssignments(role: Role): boolean {
  return role !== Role.STAFF_RO;
}
