import Link from "next/link";
import { AssetStatus, type Prisma } from "@prisma/client";
import { Plus } from "lucide-react";
import { z } from "zod";
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
import { EstateBar, type EstateCounts } from "@/components/estate-bar";
import { AssetCardList } from "./asset-card-list";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

/**
 * The sticky treatment for every header cell.
 *
 * `sticky top-0` alone is not enough: the row beneath scrolls THROUGH the
 * header unless the header paints an opaque background, and the bottom border
 * has to be a shadow because a `<th>` border does not travel with a sticky
 * element in every engine.
 */
const STICKY_HEAD =
  "bg-background sticky top-0 z-10 shadow-[inset_0_-1px_0_var(--border)]";

/** Empty selects submit ""; normalise before validation, not after. */
const blankToUndefined = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

/**
 * A column header that is also its own sort control.
 *
 * A link, not a button: sort is URL state, so this works with JavaScript off
 * and a sorted register is a shareable link. `aria-sort` on the cell is what
 * tells a screen reader which column is ordered and which way — the arrow is
 * decorative and hidden from it.
 */
function SortableHead({
  column,
  label,
  active,
  direction,
  href,
}: {
  column: SortColumn;
  label: string;
  active: SortColumn;
  direction: "asc" | "desc";
  href: string;
}) {
  const isActive = column === active;
  return (
    <TableHead
      className={STICKY_HEAD}
      aria-sort={
        isActive ? (direction === "asc" ? "ascending" : "descending") : "none"
      }
    >
      <Link
        href={href}
        className="hover:text-foreground focus-visible:ring-ring inline-flex items-center gap-1 rounded-sm focus-visible:ring-2 focus-visible:outline-none"
      >
        {label}
        <span aria-hidden="true" className={isActive ? "" : "opacity-0"}>
          {direction === "asc" ? "↑" : "↓"}
        </span>
      </Link>
    </TableHead>
  );
}

/**
 * The columns a reader may sort by, and how each maps onto Prisma.
 *
 * "Held by" is deliberately absent: the holder is fetched by a SECOND query
 * (see below), so the database cannot order the register by it without the join
 * this page exists to avoid for STAFF_RO. Offering a sort that silently did
 * nothing would be worse than not offering it.
 */
const SORT_COLUMNS = [
  "tag",
  "item",
  "category",
  "status",
  "site",
  "condition",
] as const;

type SortColumn = (typeof SORT_COLUMNS)[number];

function orderByFor(
  column: SortColumn,
  direction: "asc" | "desc",
): Prisma.AssetOrderByWithRelationInput[] {
  // `nulls: "last"` on every nullable column: an untagged asset or one with no
  // site is missing information, and missing information belongs at the end
  // whichever way the column is pointed — not floated to the top on desc.
  const primary: Record<SortColumn, Prisma.AssetOrderByWithRelationInput[]> = {
    tag: [{ tag: { sort: direction, nulls: "last" } }],
    item: [{ make: direction }, { model: direction }],
    category: [{ category: { name: direction } }],
    // The enum's declaration order is the lifecycle order, so sorting by status
    // walks ON_ORDER → RETIRED rather than alphabetically.
    status: [{ status: direction }],
    site: [{ site: { name: direction } }],
    condition: [{ condition: { sort: direction, nulls: "last" } }],
  };
  // A stable tie-break, so two assets that match on the sort key keep a fixed
  // order between renders instead of drifting with the planner.
  return [...primary[column], { id: "asc" }];
}

// A malformed shared link renders the default register rather than a 500
// (LEARNINGS §Zod).
//
// Every param the UI can produce has to appear HERE too: `.object()` strips
// unknown keys silently, so a filter wired into the where-builder but not the
// schema is dropped with no error anywhere (LEARNINGS §Zod).
//
// `.catch(undefined)` per field, not one safeParse over the object: the object
// form is all-or-nothing, so a single junk param discards every VALID one
// beside it. That was survivable with three filters and is not with five —
// a typo in `dir` would silently throw away the status and category someone
// had actually chosen. Each field now falls back on its own.
const filterSchema = z.object({
  status: z.preprocess(
    blankToUndefined,
    z.enum(AssetStatus).optional().catch(undefined),
  ),
  categoryId: z.preprocess(
    blankToUndefined,
    z.string().min(1).optional().catch(undefined),
  ),
  siteId: z.preprocess(
    blankToUndefined,
    z.string().min(1).optional().catch(undefined),
  ),
  sort: z.preprocess(
    blankToUndefined,
    z.enum(SORT_COLUMNS).optional().catch(undefined),
  ),
  dir: z.preprocess(
    blankToUndefined,
    z.enum(["asc", "desc"]).optional().catch(undefined),
  ),
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
  //
  // Two where clauses, and the difference between them is deliberate. The
  // estate bar has to show what EVERY status holds — otherwise filtering to
  // "In repair" would leave a bar reading "In repair 21" and nothing else, and
  // there would be no way back. So the bar counts against everything except the
  // status filter, while the table applies all three. This is NOT the
  // count-query-parity bug (LEARNINGS §Prisma): the clauses differ by exactly
  // one field, on purpose, and the counts describe the same set the reader is
  // choosing between.
  const scopeFilters: Prisma.AssetWhereInput = {};
  if (filters.categoryId) scopeFilters.categoryId = filters.categoryId;
  if (filters.siteId) scopeFilters.siteId = filters.siteId;

  const where: Prisma.AssetWhereInput = { ...scopeFilters };
  if (filters.status) where.status = filters.status;

  const sortColumn: SortColumn = filters.sort ?? "tag";
  const sortDirection = filters.dir ?? "asc";

  const db = getDb();
  const [assets, statusCounts, categories, sites] = await Promise.all([
    db.asset.findMany({
      where,
      orderBy: orderByFor(sortColumn, sortDirection),
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
    db.asset.groupBy({
      by: ["status"],
      where: scopeFilters,
      _count: { _all: true },
    }),
    db.category.findMany({ orderBy: { name: "asc" } }),
    db.site.findMany({ orderBy: { name: "asc" } }),
  ]);

  // groupBy omits statuses with no rows; the bar needs all five present, so a
  // zero is a real answer ("nothing is in repair") rather than a missing key.
  const counts: EstateCounts = {
    ON_ORDER: 0,
    IN_STOCK: 0,
    ASSIGNED: 0,
    IN_REPAIR: 0,
    RETIRED: 0,
  };
  for (const row of statusCounts) {
    counts[row.status] = row._count._all;
  }

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
  // Singular/plural matters — "1 assets" reads as a bug. When a filter is on,
  // the count says what it is a subset OF, so the number never looks like the
  // whole register.
  const estateTotal = Object.values(counts).reduce((sum, n) => sum + n, 0);
  const isFiltered = assets.length !== estateTotal;
  const summary = isFiltered
    ? `${assets.length} of ${estateTotal}`
    : `${assets.length} ${assets.length === 1 ? "asset" : "assets"}`;

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

  /**
   * Every control on this page is a link, so each one has to rebuild the whole
   * query string. One builder, so a new param cannot be preserved by the status
   * chips and dropped by the column headers.
   */
  const hrefWith = (overrides: Record<string, string | null>) => {
    const params = new URLSearchParams();
    const merged: Record<string, string | null | undefined> = {
      status: filters.status ?? null,
      categoryId: filters.categoryId ?? null,
      siteId: filters.siteId ?? null,
      sort: filters.sort ?? null,
      dir: filters.dir ?? null,
      ...overrides,
    };
    for (const [key, value] of Object.entries(merged)) {
      if (value) params.set(key, value);
    }
    const query = params.toString();
    return query ? `/assets?${query}` : "/assets";
  };

  const sortHref = (column: SortColumn) =>
    hrefWith({
      sort: column,
      // Clicking the active column flips it; clicking a new one starts
      // ascending, which is the reading order for every column here.
      dir: column === sortColumn && sortDirection === "asc" ? "desc" : "asc",
    });

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        {/* The title is a label, not a masthead. An operator opening this forty
            times a day knows what page they are on — the rail says so, and it
            is the app's home. What changes is the count, so the count gets the
            weight the heading gives up. */}
        <div className="flex items-baseline gap-2.5">
          <h1 className="font-semibold tracking-tight">Asset register</h1>
          {/* Counts describe what is on screen, so they follow the filters
              rather than the whole table — a filtered register that still
              claimed the full count would be lying about what you can see.
              The per-status breakdown that used to live here is now the estate
              bar below, which shows the same numbers and acts on them. */}
          <p className="text-muted-foreground font-mono text-sm tabular-nums">
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

      {/* The status summary IS the status filter (AM-09 DESIGN §4.2). It
          replaces the Status select below, so status now takes one click
          instead of select-then-submit — and the counts it shows are what make
          the click worth offering. */}
      <EstateBar
        counts={counts}
        active={filters.status ?? null}
        hrefFor={(status) => hrefWith({ status })}
      />

      {/* A plain GET form: filters live in the URL, so a filtered register is
          a shareable link and the page stays a server component.
          `sort`/`dir` ride along as hidden inputs — without them, submitting
          the category filter would silently reset a chosen sort, and status
          would be dropped entirely because the bar owns it now. */}
      <form method="get" className="flex flex-wrap items-end gap-3">
        {filters.status ? (
          <input type="hidden" name="status" value={filters.status} />
        ) : null}
        {filters.sort ? (
          <input type="hidden" name="sort" value={filters.sort} />
        ) : null}
        {filters.dir ? (
          <input type="hidden" name="dir" value={filters.dir} />
        ) : null}
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
            {/* The table region owns the vertical scroll so the header can
                stick to it — and so the estate bar and filters stay on screen
                while a 400-row register scrolls under them. */}
            <Table containerClassName="max-h-[calc(100vh-19rem)] min-h-64">
              <TableHeader>
                <TableRow>
                  <SortableHead
                    column="tag"
                    label="Tag"
                    active={sortColumn}
                    direction={sortDirection}
                    href={sortHref("tag")}
                  />
                  <SortableHead
                    column="item"
                    label="Make / model"
                    active={sortColumn}
                    direction={sortDirection}
                    href={sortHref("item")}
                  />
                  <SortableHead
                    column="category"
                    label="Category"
                    active={sortColumn}
                    direction={sortDirection}
                    href={sortHref("category")}
                  />
                  <SortableHead
                    column="status"
                    label="Status"
                    active={sortColumn}
                    direction={sortDirection}
                    href={sortHref("status")}
                  />
                  {/* Not sortable: the holder comes from a second query, so the
                      database cannot order by it. See SORT_COLUMNS. */}
                  {canSeeHolders ? (
                    <TableHead className={STICKY_HEAD}>Held by</TableHead>
                  ) : null}
                  <SortableHead
                    column="site"
                    label="Site"
                    active={sortColumn}
                    direction={sortDirection}
                    href={sortHref("site")}
                  />
                  <SortableHead
                    column="condition"
                    label="Condition"
                    active={sortColumn}
                    direction={sortDirection}
                    href={sortHref("condition")}
                  />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => (
                  <TableRow
                    key={row.id}
                    // Retired kit recedes rather than disappearing: nothing in
                    // this app is ever deleted, so the row stays and drains its
                    // contrast (DESIGN-SYSTEM §6).
                    className={
                      row.status === "RETIRED" ? "text-muted-foreground" : ""
                    }
                  >
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
