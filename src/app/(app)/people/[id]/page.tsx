import Link from "next/link";
import { notFound } from "next/navigation";
import { STATUS_LABELS } from "@/lib/asset-lifecycle";
import { requireRole } from "@/lib/authz";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fetchPersonView, type PersonAssignmentRow } from "./person-view";

/**
 * The per-person view (AM-03 DESIGN §5.1). The role gate is the whole guard:
 * enumerable cuids are not a vulnerability when every reader of this route is
 * authorised by role to read every person, so no obfuscation is added here.
 * `STAFF_RO` is absent from the gate deliberately — a read-only staff user
 * sees no person's assignment data anywhere except their own
 * /me/assignments (DESIGN §2.1).
 *
 * Which FIELDS a viewer sees is decided in the Prisma `select` by
 * `personSelectFor`, never by rendering less here: the conditionals below
 * render what was fetched, and for a PROCUREMENT or FINANCE viewer the email
 * never left the database.
 */

/** Deterministic and timezone-explicit — the server's locale is not the reader's. */
function formatTimestamp(value: Date): string {
  return `${value.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

export default async function PersonPage({
  params,
}: {
  // Async in Next 15 — a non-async signature typechecks and fails the build.
  params: Promise<{ id: string }>;
}) {
  const { role } = await requireRole("ADMIN_IT", "PROCUREMENT", "FINANCE");
  const { id } = await params;

  const view = await fetchPersonView(role, id);
  if (!view) {
    notFound();
  }
  const { person, deactivatedAt, open, past } = view;

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{person.name}</h1>

      <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
        {person.employeeRef !== undefined ? (
          <Field label="Employee ref" value={person.employeeRef} />
        ) : null}
        {person.email !== undefined ? (
          <Field label="Email" value={person.email} />
        ) : null}
      </dl>

      {deactivatedAt !== null ? (
        // Advisor condition 12. A leaver's open assignments are deliberately
        // NOT auto-returned and deactivation is deliberately NOT blocked on
        // outstanding kit (AM-03-CF-2 — blocking the AM-01 kill-switch on asset
        // state would be a security regression). This marker is what makes that
        // situation visible instead of invisible.
        <p className="border-destructive/50 text-destructive rounded-md border px-3 py-2 text-sm">
          This person&apos;s account was deactivated on{" "}
          {formatTimestamp(deactivatedAt)}. Anything still listed under
          &ldquo;currently held&rdquo; has not been returned.
        </p>
      ) : null}

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">Currently held</h2>
        {open.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            This person is not holding any assets.
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
                  <AssetCells assignment={assignment} />
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
            Nothing has been returned by this person yet.
          </p>
        ) : (
          <>
            <p className="text-muted-foreground text-sm">
              Status is the asset&apos;s status now, not its status at the time
              it was returned.
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tag</TableHead>
                  <TableHead>Make / model</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Checked out</TableHead>
                  <TableHead>Returned</TableHead>
                  <TableHead>Condition note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {past.map((assignment) => (
                  <TableRow key={assignment.id}>
                    <AssetCells assignment={assignment} />
                    <TableCell>
                      {formatTimestamp(assignment.checkedOutAt)}
                    </TableCell>
                    <TableCell>
                      {assignment.returnedAt
                        ? formatTimestamp(assignment.returnedAt)
                        : "—"}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {assignment.conditionNotes ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </section>
    </>
  );
}

/** The three columns both tables open with. */
function AssetCells({ assignment }: { assignment: PersonAssignmentRow }) {
  return (
    <>
      <TableCell>
        <Link
          href={`/assets/${assignment.asset.id}`}
          className="underline underline-offset-4"
        >
          {assignment.asset.tag ?? "Untagged"}
        </Link>
      </TableCell>
      <TableCell>
        {assignment.asset.make} {assignment.asset.model}
      </TableCell>
      <TableCell>{STATUS_LABELS[assignment.asset.status]}</TableCell>
    </>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div>
      <dt className="text-muted-foreground text-xs">{label}</dt>
      <dd>{value ? value : "—"}</dd>
    </div>
  );
}
