import "server-only";
import type { Prisma, Role } from "@prisma/client";
import { getDb } from "@/lib/db";
import { personSelectFor } from "@/lib/person-visibility";

/**
 * The per-person view's data fetch, kept out of `page.tsx` so it is directly
 * assertable: the field tiers of DESIGN §5.2 are a property of what this
 * function RETURNS, and a test that only inspects rendered HTML passes just as
 * well when the data was fetched and merely hidden.
 *
 * The Person select is `personSelectFor(role)` verbatim — not spread, not
 * widened, not added to (advisor condition 8). The linked User is fetched as
 * its own query rather than as a nested relation for the same reason: the
 * Person select stays literally the chokepoint's return value.
 */

/** No `person` relation is traversed: the person is already the page's subject. */
const assignmentSelect = {
  id: true,
  checkedOutAt: true,
  returnedAt: true,
  conditionNotes: true,
  asset: {
    select: { id: true, tag: true, make: true, model: true, status: true },
  },
} satisfies Prisma.AssignmentSelect;

export type PersonAssignmentRow = Prisma.AssignmentGetPayload<{
  select: typeof assignmentSelect;
}>;

/**
 * `employeeRef` and `email` are optional because their presence is decided by
 * `personSelectFor` at query time: for a PROCUREMENT or FINANCE viewer the
 * `email` key is not merely empty, it was never selected and never left the
 * database.
 */
export type VisiblePerson = {
  id: string;
  name: string;
  employeeRef?: string | null;
  email?: string | null;
};

export type PersonView = {
  person: VisiblePerson;
  /** Non-null when the person's linked User account has been deactivated. */
  deactivatedAt: Date | null;
  open: PersonAssignmentRow[];
  past: PersonAssignmentRow[];
};

/** Null when no such person exists — the caller turns that into notFound(). */
export async function fetchPersonView(
  role: Role,
  id: string,
): Promise<PersonView | null> {
  const db = getDb();
  const person = await db.person.findUnique({
    where: { id },
    select: personSelectFor(role),
  });
  if (!person) {
    return null;
  }

  // Two assignment queries rather than one partitioned in JS: each hits the
  // [personId, returnedAt] index, and the past list is the unbounded one, so
  // it is the one a later pagination change touches.
  const [linkedUser, open, past] = await Promise.all([
    db.user.findUnique({
      where: { personId: id },
      select: { deactivatedAt: true },
    }),
    db.assignment.findMany({
      where: { personId: id, returnedAt: null },
      orderBy: [{ checkedOutAt: "desc" }, { id: "desc" }],
      select: assignmentSelect,
    }),
    db.assignment.findMany({
      where: { personId: id, returnedAt: { not: null } },
      orderBy: [{ returnedAt: "desc" }, { id: "desc" }],
      select: assignmentSelect,
    }),
  ]);

  return {
    person,
    deactivatedAt: linkedUser?.deactivatedAt ?? null,
    open,
    past,
  };
}
