import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { STATUS_LABELS } from "@/lib/asset-lifecycle";
import { requireRole } from "@/lib/authz";
import { getDb } from "@/lib/db";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * The self-scoped route (AM-03 DESIGN §5.1, advisor condition 10).
 *
 * This page takes NO props: no `params`, no `searchParams`, and it reads no
 * form data. The person whose assignments are shown is derived server-side
 * from `session.user.id -> User.personId`. There is no IDOR surface because
 * there is nothing to tamper with — and that property is verifiable by grep,
 * the same way `requireRole` coverage is. Do not add an "impersonate" or
 * "view as" affordance here; scoping this route by an identifier taken from
 * request input is precisely the structural IDOR the design rejected.
 *
 * `requireRole` covers all four roles: this is the ONLY place a `STAFF_RO`
 * user sees assignment data, and only ever their own (DESIGN §2.1).
 */

/** Deterministic and timezone-explicit — the server's locale is not the reader's. */
function formatTimestamp(value: Date): string {
  return `${value.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * No `person` relation is traversed anywhere on this page: the scope IS the
 * signed-in person, so their own name adds nothing and fetching a Person row
 * here would put person data on the one route a STAFF_RO user can reach.
 */
const assignmentSelect = {
  id: true,
  checkedOutAt: true,
  returnedAt: true,
  asset: {
    select: { id: true, tag: true, make: true, model: true, status: true },
  },
} satisfies Prisma.AssignmentSelect;

type AssignmentRow = Prisma.AssignmentGetPayload<{
  select: typeof assignmentSelect;
}>;

export default async function MyAssignmentsPage() {
  const { userId } = await requireRole(
    "ADMIN_IT",
    "PROCUREMENT",
    "FINANCE",
    "STAFF_RO",
  );

  const db = getDb();
  // The whole scope of this page, derived from the session and nothing else.
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { personId: true },
  });
  const personId = user?.personId ?? null;

  // Two queries rather than one partitioned in JS: each hits the
  // [personId, returnedAt] index, and the past list is the one that grows
  // without bound, so it is the one a later pagination change touches.
  let open: AssignmentRow[] = [];
  let past: AssignmentRow[] = [];
  if (personId) {
    [open, past] = await Promise.all([
      db.assignment.findMany({
        where: { personId, returnedAt: null },
        orderBy: [{ checkedOutAt: "desc" }, { id: "desc" }],
        select: assignmentSelect,
      }),
      db.assignment.findMany({
        where: { personId, returnedAt: { not: null } },
        orderBy: [{ returnedAt: "desc" }, { id: "desc" }],
        select: assignmentSelect,
      }),
    ]);
  }

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">My assignments</h1>

      {personId === null ? (
        // A provisioned user with no linked Person is legitimate — contractors
        // and staff seeded without a record. An empty state, never a 500.
        <p className="text-muted-foreground text-sm">
          Your account is not linked to a staff record, so there is nothing to
          show here yet. Ask IT to link it.
        </p>
      ) : (
        <>
          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-medium">Currently held</h2>
            {open.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                You are not holding any assets.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Tag</TableHead>
                    <TableHead>Make / model</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Checked out</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {open.map((assignment) => (
                    <TableRow key={assignment.id}>
                      <TableCell>
                        <AssetLink
                          id={assignment.asset.id}
                          tag={assignment.asset.tag}
                        />
                      </TableCell>
                      <TableCell>
                        {assignment.asset.make} {assignment.asset.model}
                      </TableCell>
                      <TableCell>
                        {STATUS_LABELS[assignment.asset.status]}
                      </TableCell>
                      <TableCell>
                        {formatTimestamp(assignment.checkedOutAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </section>

          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-medium">Previously held</h2>
            {past.length === 0 ? (
              <p className="text-muted-foreground text-sm">
                Nothing has been returned yet.
              </p>
            ) : (
              <>
                <p className="text-muted-foreground text-sm">
                  Status is the asset&apos;s status now, not its status at the
                  time it was returned.
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Tag</TableHead>
                      <TableHead>Make / model</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Checked out</TableHead>
                      <TableHead>Returned</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {past.map((assignment) => (
                      <TableRow key={assignment.id}>
                        <TableCell>
                          <AssetLink
                            id={assignment.asset.id}
                            tag={assignment.asset.tag}
                          />
                        </TableCell>
                        <TableCell>
                          {assignment.asset.make} {assignment.asset.model}
                        </TableCell>
                        <TableCell>
                          {STATUS_LABELS[assignment.asset.status]}
                        </TableCell>
                        <TableCell>
                          {formatTimestamp(assignment.checkedOutAt)}
                        </TableCell>
                        <TableCell>
                          {assignment.returnedAt
                            ? formatTimestamp(assignment.returnedAt)
                            : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </>
            )}
          </section>
        </>
      )}
    </>
  );
}

function AssetLink({ id, tag }: { id: string; tag: string | null }) {
  return (
    <Link href={`/assets/${id}`} className="underline underline-offset-4">
      {tag ?? "Untagged"}
    </Link>
  );
}
