import Link from "next/link";
import { AssetStatus, type Prisma } from "@prisma/client";
import { Plus } from "lucide-react";
import { z } from "zod";
import { STATUS_LABELS } from "@/lib/asset-lifecycle";
import { CONDITION_LABELS } from "@/lib/labels";
import { requireRole } from "@/lib/authz";
import { getDb } from "@/lib/db";
import {
  PERSON_NAME_SELECT,
  canViewAssignments,
} from "@/lib/person-visibility";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { StatusChip } from "@/components/ui/status-chip";
import { AssetCardList } from "./asset-card-list";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/** Empty selects submit ""; normalise before validation, not after. */
const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

// safeParse, so a malformed shared link renders the default register rather
// than a 500 (LEARNINGS §Zod).
const filterSchema = z.object({
  status: z.preprocess(blankToUndefined, z.enum(AssetStatus).optional()),
  categoryId: z.preprocess(blankToUndefined, z.string().min(1).optional()),
  siteId: z.preprocess(blankToUndefined, z.string().min(1).optional()),
});

export default async function AssetsPage({
  searchParams,
}: {
  // Async in Next 15 — a non-async signature typechecks and fails the build.
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { role } = await requireRole(
    "ADMIN_IT",
    "PROCUREMENT",
    "FINANCE",
    "STAFF_RO",
  );
  const canWrite = role === "ADMIN_IT" || role === "PROCUREMENT";
  // Checked BEFORE the holder query, never in the JSX: for a STAFF_RO viewer the
  // register carries no assignment and no person data at all, because none is
  // fetched (advisor condition 9).
  const canSeeHolders = canViewAssignments(role);

  const parsed = filterSchema.safeParse(await searchParams);
  const filters = parsed.success ? parsed.data : {};

  // Truthiness, not != null: "" passes a null check and matches nothing
  // (LEARNINGS §Prisma).
  const where: Prisma.AssetWhereInput = {};
  if (filters.status) where.status = filters.status;
  if (filters.categoryId) where.categoryId = filters.categoryId;
  if (filters.siteId) where.siteId = filters.siteId;

  const db = getDb();
  const [assets, categories, sites] = await Promise.all([
    db.asset.findMany({
      where,
      orderBy: [{ createdAt: "desc" }],
      select: {
        id: true,
        tag: true,
        make: true,
        model: true,
        status: true,
        condition: true,
        category: { select: { name: true } },
        site: { select: { name: true } },
      },
    }),
    db.category.findMany({ orderBy: { name: "asc" } }),
    db.site.findMany({ orderBy: { name: "asc" } }),
  ]);

  // A second query rather than an `assignments` include on the one above: a
  // role-conditional include gives the whole row a union type, and the branch
  // that matters most — the one where nothing person-shaped is fetched — is
  // then the hardest to read. One extra query, and the STAFF_RO path never
  // touches the Assignment or Person tables.
  const holders =
    canSeeHolders && assets.length > 0
      ? await db.assignment.findMany({
          where: { returnedAt: null, assetId: { in: assets.map((a) => a.id) } },
          // The register shows a name and nothing else, so it fetches a name
          // and nothing else. personSelectFor(ADMIN_IT) would pull an email
          // into this payload that no cell renders — within the tier, so not a
          // leak, but it spends the "data not fetched cannot leak" property for
          // no benefit.
          select: { assetId: true, person: { select: PERSON_NAME_SELECT } },
        })
      : [];
  // At most one open assignment per asset — the partial unique index is what
  // makes this Map safe to build.
  const holderByAsset = new Map(
    holders.map((holder) => [holder.assetId, holder.person]),
  );

  // Mapped ONCE, then rendered twice — the table above md and the card list
  // below it. Both shapes read this array, so a role-conditional cannot be
  // right in one shape and missing from the other.
  //
  // There is deliberately NO `canSeeHolders ?` here. holderByAsset is empty for
  // a STAFF_RO viewer because the query above never ran, so a ternary would be
  // unreachable — it was written, and deleting it left every test green
  // (LEARNINGS §Testing: a secondary guard behind a working primary defends
  // nothing you can demonstrate). The guard is the fetch, and only the fetch:
  // data that was never selected cannot leak through any later UI change.
  // Counted from the rows already fetched, not with three more COUNT queries:
  // the register is a page-sized list, so the arithmetic is free here and a
  // round trip there. Singular/plural matters — "1 assets" reads as a bug.
  const assignedCount = assets.filter((a) => a.status === "ASSIGNED").length;
  const repairCount = assets.filter((a) => a.status === "IN_REPAIR").length;
  const summary = [
    `${assets.length} ${assets.length === 1 ? "asset" : "assets"}`,
    assignedCount > 0 ? `${assignedCount} assigned` : null,
    repairCount > 0 ? `${repairCount} in repair` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const rows = assets.map((asset) => ({
    id: asset.id,
    tag: asset.tag,
    make: asset.make,
    model: asset.model,
    status: asset.status,
    categoryName: asset.category.name,
    siteName: asset.site?.name ?? null,
    condition: asset.condition,
    holder: holderByAsset.get(asset.id) ?? null,
  }));

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <h1 className="text-2xl font-semibold tracking-tight">
            Asset register
          </h1>
          {/* Counts describe what is on screen, so they follow the filters
              rather than the whole table — a filtered register that still
              claimed the full count would be lying about what you can see. */}
          <p className="text-muted-foreground text-sm tabular-nums">
            {summary}
          </p>
        </div>
        {/* "Add asset" is a page action, not navigation — it stays here after
            the shell took over the nav links. */}
        {canWrite ? (
          <Button asChild size="sm">
            <Link href="/assets/new">
              <Plus aria-hidden="true" />
              Add asset
            </Link>
          </Button>
        ) : null}
      </div>

      {/* A plain GET form: filters live in the URL, so a filtered register is
          a shareable link and the page stays a server component. */}
      <form method="get" className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-status">Status</Label>
          <Select
            id="filter-status"
            name="status"
            defaultValue={filters.status ?? ""}
          >
            <option value="">All</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-category">Category</Label>
          <Select
            id="filter-category"
            name="categoryId"
            defaultValue={filters.categoryId ?? ""}
          >
            <option value="">All</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="filter-site">Site</Label>
          <Select
            id="filter-site"
            name="siteId"
            defaultValue={filters.siteId ?? ""}
          >
            <option value="">All</option>
            {sites.map((site) => (
              <option key={site.id} value={site.id}>
                {site.name}
              </option>
            ))}
          </Select>
        </div>
        <Button type="submit" variant="outline">
          Filter
        </Button>
        <Link
          href="/assets"
          className="text-muted-foreground pb-2 text-sm underline underline-offset-4"
        >
          Clear
        </Link>
      </form>

      {assets.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No assets match. {canWrite ? "Add one to get started." : null}
        </p>
      ) : (
        <>
          {/* Above md: the dense table. Its whitespace-nowrap and horizontal
              overflow are correct here and only here. */}
          <div data-testid="asset-table" className="hidden md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tag</TableHead>
                  <TableHead>Make / model</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Status</TableHead>
                  {canSeeHolders ? <TableHead>Held by</TableHead> : null}
                  <TableHead>Site</TableHead>
                  <TableHead>Condition</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <Link
                        href={`/assets/${row.id}`}
                        className="font-mono tabular-nums underline underline-offset-4"
                      >
                        {row.tag ?? "Untagged"}
                      </Link>
                    </TableCell>
                    <TableCell>
                      {row.make} {row.model}
                    </TableCell>
                    <TableCell>{row.categoryName}</TableCell>
                    <TableCell>
                      <StatusChip status={row.status} />
                    </TableCell>
                    {canSeeHolders ? (
                      <TableCell>
                        {/* Rendered only inside canSeeHolders, so the link can
                            never appear for a viewer /people/[id] would
                            reject. row.holder is null for those viewers
                            anyway — nothing was fetched. */}
                        {row.holder ? (
                          <Link
                            href={`/people/${row.holder.id}`}
                            className="underline underline-offset-4"
                          >
                            {row.holder.name}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                    ) : null}
                    <TableCell>{row.siteName ?? "—"}</TableCell>
                    <TableCell>
                      {row.condition ? CONDITION_LABELS[row.condition] : "—"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Below md: one card per asset, tag first (AM-06). */}
          <AssetCardList assets={rows} />
        </>
      )}
    </>
  );
}
