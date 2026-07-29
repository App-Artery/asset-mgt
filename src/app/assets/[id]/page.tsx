import Link from "next/link";
import { notFound } from "next/navigation";
import type { AssetStatus } from "@prisma/client";
import { ASSET_TRANSITIONS, STATUS_LABELS } from "@/lib/asset-lifecycle";
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
import { AssetForm } from "../asset-form";
import { LifecycleActions, type LifecycleMove } from "./lifecycle-actions";

/**
 * The moves offered from a status, derived from the single transition map so
 * AM-03 can add assignment without a second source of truth.
 *
 * ASSIGNED is deliberately never offered: it is in ASSET_TRANSITIONS (so the
 * lifecycle is complete) but assignment is AM-03's story. That also means
 * IN_STOCK is only offered where AM-02 owns the reason for it — receiving a
 * delivery or returning from repair, never returning from an assignment.
 */
function lifecycleMovesFor(status: AssetStatus): LifecycleMove[] {
  const allowed = ASSET_TRANSITIONS[status];
  const moves: LifecycleMove[] = [];
  if (status === "ON_ORDER" && allowed.includes("IN_STOCK")) {
    moves.push("RECEIVE");
  }
  if (status === "IN_REPAIR" && allowed.includes("IN_STOCK")) {
    moves.push("RETURN");
  }
  if (allowed.includes("IN_REPAIR")) moves.push("SEND_TO_REPAIR");
  if (allowed.includes("RETIRED")) moves.push("RETIRE");
  return moves;
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
  const { id } = await params;

  const db = getDb();
  const asset = await db.asset.findUnique({
    where: { id },
    include: {
      category: true,
      site: true,
      events: {
        // Newest first. TIMESTAMP(3) can tie for events written milliseconds
        // apart; cuid is monotonic, so it is the stable tie-breaker.
        orderBy: [{ at: "desc" }, { id: "desc" }],
        include: { actor: { select: { name: true, email: true } } },
      },
    },
  });
  if (!asset) {
    notFound();
  }

  const [categories, sites] = await Promise.all([
    db.category.findMany({ orderBy: { name: "asc" } }),
    db.site.findMany({ orderBy: { name: "asc" } }),
  ]);

  // Prisma's Decimal is not serialisable across the server/client boundary —
  // convert before it reaches any client component.
  const purchasePrice = asset.purchasePrice?.toString() ?? "";

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 p-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">
          {asset.tag ?? "Untagged asset"}
        </h1>
        <div className="flex items-baseline gap-4 text-sm">
          <Link href="/assets" className="underline underline-offset-4">
            Register
          </Link>
          <Link href="/" className="underline underline-offset-4">
            Home
          </Link>
        </div>
      </div>

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
      </dl>

      {canWrite ? (
        <>
          {/* Rendered for write roles only — but that is UX. requireRole
              inside each action is what enforces it. */}
          <section className="flex flex-col gap-4">
            <h2 className="text-lg font-medium">Lifecycle</h2>
            <LifecycleActions
              assetId={asset.id}
              moves={lifecycleMovesFor(asset.status)}
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
            {asset.events.map((event) => (
              <TableRow key={event.id}>
                <TableCell>{formatTimestamp(event.at)}</TableCell>
                <TableCell>{event.type}</TableCell>
                <TableCell>
                  {event.fromStatus || event.toStatus
                    ? `${statusLabel(event.fromStatus)} → ${statusLabel(event.toStatus)}`
                    : "—"}
                </TableCell>
                <TableCell>
                  {event.actor?.name ?? event.actor?.email ?? "System"}
                </TableCell>
                <TableCell className="whitespace-normal">
                  {event.notes ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </section>
    </main>
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
