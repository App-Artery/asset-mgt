import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Role,
  type AssetEventType,
  type AssetStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import { ASSET_TRANSITIONS, STATUS_LABELS } from "@/lib/asset-lifecycle";
import { requireRole } from "@/lib/authz";
import { getDb } from "@/lib/db";
import { canViewAssignments, personSelectFor } from "@/lib/person-visibility";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AssetForm } from "../asset-form";
import type { PickerPerson, ReturnDestination } from "./assignment-actions";
import { LifecycleActions, type LifecycleMove } from "./lifecycle-actions";

/**
 * The moves offered from a status, derived from the single transition map so
 * there is never a second source of truth about what is legal.
 *
 * The one place the map alone is not enough: out of ASSIGNED, IN_STOCK and
 * IN_REPAIR are BOTH reached by taking the asset back from its holder. So
 * ASSIGNED offers no "send to repair" button — a repair-bound return is the
 * return action with toStatus=IN_REPAIR, which keeps closing the assignment and
 * changing the status in one transaction and one event (AM-03 DESIGN §4.2).
 * Retire stays available: the write layer closes the assignment itself, and
 * stolen kit must be retirable without recording a fictional return.
 */
function lifecycleMovesFor(status: AssetStatus): LifecycleMove[] {
  const allowed = ASSET_TRANSITIONS[status];
  const moves: LifecycleMove[] = [];
  if (status === "ON_ORDER" && allowed.includes("IN_STOCK")) {
    moves.push("RECEIVE");
  }
  if (allowed.includes("ASSIGNED")) {
    moves.push("ASSIGN");
  }
  if (status === "ASSIGNED") {
    if (allowed.includes("IN_STOCK") || allowed.includes("IN_REPAIR")) {
      moves.push("RETURN_FROM_PERSON");
    }
  } else {
    if (status === "IN_REPAIR" && allowed.includes("IN_STOCK")) {
      moves.push("RETURN");
    }
    if (allowed.includes("IN_REPAIR")) {
      moves.push("SEND_TO_REPAIR");
    }
  }
  if (allowed.includes("RETIRED")) {
    moves.push("RETIRE");
  }
  return moves;
}

/** The return form's destination options, from the same transition map. */
const RETURN_DESTINATIONS: readonly ReturnDestination[] = [
  "IN_STOCK",
  "IN_REPAIR",
];

function returnDestinationsFor(status: AssetStatus): ReturnDestination[] {
  return RETURN_DESTINATIONS.filter((destination) =>
    ASSET_TRANSITIONS[status].includes(destination),
  );
}

/** <input type="date"> wants YYYY-MM-DD; dates are written at UTC midnight. */
function toDateInput(value: Date | null): string {
  return value ? value.toISOString().slice(0, 10) : "";
}

/** A CREATED event has no fromStatus; an UPDATED event has neither. */
function statusLabel(status: AssetStatus | null): string {
  return status ? STATUS_LABELS[status] : "—";
}

/** Deterministic and timezone-explicit — the server's locale is not the reader's. */
function formatTimestamp(value: Date): string {
  return `${value.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

/**
 * What the history's "Who" column shows when there is no name to show.
 *
 * `System` means the event genuinely has no actor (the seed script). `IT` is
 * the neutral label for an actor this viewer may not be told about — either a
 * STAFF_RO viewer, for whom the actor is not selected at all, or an actor whose
 * account has no name and whose email this viewer's role does not include.
 */
const SYSTEM_ACTOR_LABEL = "System";
const IT_ACTOR_LABEL = "IT";

type HistoryRow = {
  id: string;
  at: Date;
  type: AssetEventType;
  fromStatus: AssetStatus | null;
  toStatus: AssetStatus | null;
  notes: string | null;
  who: string;
};

const EVENT_FIELDS = {
  id: true,
  at: true,
  type: true,
  fromStatus: true,
  toStatus: true,
  notes: true,
} as const;

function whoLabel(actor: { name: string | null; email?: string } | null) {
  if (actor === null) return SYSTEM_ACTOR_LABEL;
  return actor.name ?? actor.email ?? IT_ACTOR_LABEL;
}

/**
 * The status history, with actor identity tiered exactly as person data is
 * (AM-03 DESIGN §5.3, advisor condition 11 — this closes a live leak on main,
 * where `name ?? email` was rendered for all four roles and any actor without a
 * name exposed their email address to every staff user).
 *
 * Three query branches rather than one query with `email: role === ADMIN_IT`:
 * Prisma types a boolean-valued select field as PRESENT whatever the boolean
 * turns out to be, so that shape reads as "email is always here" and only the
 * runtime disagrees. Written out, the ONE branch selecting an email is the one
 * guarded by an ADMIN_IT check, and review can see it without trusting a type.
 *
 * A STAFF_RO viewer still sees the whole history — they just see no person on
 * it, because none is fetched.
 */
async function historyFor(
  db: PrismaClient,
  assetId: string,
  role: Role,
): Promise<HistoryRow[]> {
  // Newest first. TIMESTAMP(3) can tie for events written milliseconds apart;
  // cuid is monotonic, so it is the stable tie-breaker.
  const query = {
    where: { assetId },
    orderBy: [{ at: "desc" }, { id: "desc" }],
  } satisfies Prisma.AssetEventFindManyArgs;

  if (!canViewAssignments(role)) {
    const events = await db.assetEvent.findMany({
      ...query,
      select: EVENT_FIELDS,
    });
    return events.map((event) => ({ ...event, who: IT_ACTOR_LABEL }));
  }

  if (role === Role.ADMIN_IT) {
    const events = await db.assetEvent.findMany({
      ...query,
      select: {
        ...EVENT_FIELDS,
        actor: { select: { name: true, email: true } },
      },
    });
    return events.map(({ actor, ...event }) => ({
      ...event,
      who: whoLabel(actor),
    }));
  }

  const events = await db.assetEvent.findMany({
    ...query,
    select: { ...EVENT_FIELDS, actor: { select: { name: true } } },
  });
  return events.map(({ actor, ...event }) => ({
    ...event,
    who: whoLabel(actor),
  }));
}

export default async function AssetDetailPage({
  params,
}: {
  // Async in Next 15 — a non-async signature typechecks and fails the build.
  params: Promise<{ id: string }>;
}) {
  const { role } = await requireRole(
    "ADMIN_IT",
    "PROCUREMENT",
    "FINANCE",
    "STAFF_RO",
  );
  const canWrite = role === "ADMIN_IT" || role === "PROCUREMENT";
  // THE gate for every person-shaped read on this page (advisor condition 9).
  // It is checked BEFORE each query, never in the JSX: a STAFF_RO viewer's page
  // does not fetch the assignment or the person, so no later UI change can leak
  // what was never loaded.
  const canSeeHolders = canViewAssignments(role);
  const { id } = await params;

  const db = getDb();
  const asset = await db.asset.findUnique({
    where: { id },
    include: { category: true, site: true },
  });
  if (!asset) {
    notFound();
  }

  const moves = lifecycleMovesFor(asset.status);
  const [history, categories, sites] = await Promise.all([
    historyFor(db, asset.id, role),
    db.category.findMany({ orderBy: { name: "asc" } }),
    db.site.findMany({ orderBy: { name: "asc" } }),
  ]);

  // Every holder this asset has ever had, newest first; the open one (at most
  // one, by the partial unique index) is the current holder.
  const assignments = canSeeHolders
    ? await db.assignment.findMany({
        where: { assetId: asset.id },
        orderBy: [{ checkedOutAt: "desc" }, { id: "desc" }],
        select: {
          id: true,
          checkedOutAt: true,
          returnedAt: true,
          conditionNotes: true,
          person: { select: personSelectFor(role) },
        },
      })
    : [];
  const holder = assignments.find((row) => row.returnedAt === null) ?? null;

  // Only fetched when the assign form will actually render — the picker is the
  // one place this page loads people who have nothing to do with this asset.
  const people: PickerPerson[] =
    canWrite && moves.includes("ASSIGN")
      ? (
          await db.person.findMany({
            orderBy: { name: "asc" },
            select: personSelectFor(role),
          })
        ).map((person) => ({
          id: person.id,
          name: person.name,
          // Email is deliberately dropped rather than passed and unused: the
          // picker disambiguates by employeeRef, and nothing that crosses to
          // the client needs an address.
          employeeRef: person.employeeRef,
        }))
      : [];

  // Prisma's Decimal is not serialisable across the server/client boundary —
  // convert before it reaches any client component.
  const purchasePrice = asset.purchasePrice?.toString() ?? "";

  return (
    <>
      <h1 className="font-mono text-2xl font-semibold tracking-tight tabular-nums">
        {asset.tag ?? "Untagged asset"}
      </h1>

      <dl className="grid grid-cols-2 gap-x-8 gap-y-3 text-sm sm:grid-cols-3">
        <Field label="Status" value={STATUS_LABELS[asset.status]} />
        <Field label="Make / model" value={`${asset.make} ${asset.model}`} />
        <Field label="Category" value={asset.category.name} />
        <Field label="Serial" value={asset.serial} />
        <Field label="Site" value={asset.site?.name ?? null} />
        <Field label="Condition" value={asset.condition} />
        <Field label="Supplier" value={asset.supplier} />
        <Field label="Purchased" value={toDateInput(asset.purchasedAt)} />
        <Field label="Purchase price" value={purchasePrice} />
        <Field
          label="Warranty until"
          value={toDateInput(asset.warrantyUntil)}
        />
        {canSeeHolders ? (
          <div>
            <dt className="text-muted-foreground text-xs">Held by</dt>
            <dd>
              {holder ? (
                <Link
                  href={`/people/${holder.person.id}`}
                  className="underline underline-offset-4"
                >
                  {holder.person.name}
                  {holder.person.employeeRef
                    ? ` (${holder.person.employeeRef})`
                    : ""}
                </Link>
              ) : (
                "—"
              )}
            </dd>
          </div>
        ) : null}
      </dl>

      {canWrite ? (
        <>
          {/* Rendered for write roles only — but that is UX. requireRole
              inside each action is what enforces it. */}
          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-medium">Lifecycle</h2>
            <LifecycleActions
              assetId={asset.id}
              moves={moves}
              people={people}
              returnDestinations={returnDestinationsFor(asset.status)}
            />
          </section>
          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-medium">Edit details</h2>
            <p className="text-muted-foreground text-sm">
              Status is not editable here — it only ever changes through a
              lifecycle action, so every change lands in the history below.
            </p>
            <AssetForm
              categories={categories}
              sites={sites}
              asset={{
                id: asset.id,
                tag: asset.tag ?? "",
                categoryId: asset.categoryId,
                make: asset.make,
                model: asset.model,
                serial: asset.serial ?? "",
                purchasedAt: toDateInput(asset.purchasedAt),
                purchasePrice,
                supplier: asset.supplier ?? "",
                warrantyUntil: toDateInput(asset.warrantyUntil),
                condition: asset.condition ?? "",
                siteId: asset.siteId ?? "",
              }}
            />
          </section>
        </>
      ) : null}

      {canSeeHolders ? (
        <section className="flex flex-col gap-4">
          <h2 className="text-lg font-medium">Holders</h2>
          {assignments.length === 0 ? (
            <p className="text-muted-foreground text-sm">
              This asset has never been assigned.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Person</TableHead>
                  <TableHead>Employee ref</TableHead>
                  <TableHead>Checked out</TableHead>
                  <TableHead>Returned</TableHead>
                  <TableHead>Condition note</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {assignments.map((assignment) => (
                  <TableRow key={assignment.id}>
                    <TableCell>
                      {/* The only route to /people/[id]. Rendered solely inside
                          this canSeeHolders branch, so the link cannot appear
                          for a viewer the route would reject anyway. */}
                      <Link
                        href={`/people/${assignment.person.id}`}
                        className="underline underline-offset-4"
                      >
                        {assignment.person.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {assignment.person.employeeRef ?? "—"}
                    </TableCell>
                    <TableCell>
                      {formatTimestamp(assignment.checkedOutAt)}
                    </TableCell>
                    <TableCell>
                      {assignment.returnedAt
                        ? formatTimestamp(assignment.returnedAt)
                        : "Still held"}
                    </TableCell>
                    <TableCell className="whitespace-normal">
                      {assignment.conditionNotes ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </section>
      ) : null}

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium">History</h2>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>When</TableHead>
              <TableHead>Event</TableHead>
              <TableHead>Change</TableHead>
              <TableHead>Who</TableHead>
              <TableHead>Notes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {history.map((event) => (
              <TableRow key={event.id}>
                <TableCell>{formatTimestamp(event.at)}</TableCell>
                <TableCell>{event.type}</TableCell>
                <TableCell>
                  {event.fromStatus || event.toStatus
                    ? `${statusLabel(event.fromStatus)} → ${statusLabel(event.toStatus)}`
                    : "—"}
                </TableCell>
                <TableCell>{event.who}</TableCell>
                <TableCell className="whitespace-normal">
                  {event.notes ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
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
