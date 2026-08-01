import Link from "next/link";
import { AssetStatus, type Prisma } from "@prisma/client";
import { z } from "zod";
import { STATUS_LABELS } from "@/lib/asset-lifecycle";
import { requireRole } from "@/lib/authz";
import { getDb } from "@/lib/db";
import {
  PERSON_NAME_SELECT,
  canViewAssignments,
} from "@/lib/person-visibility";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
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

  return (
    <>
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">
          Asset register
        </h1>
        {/* "Add asset" is a page action, not navigation — it stays here after
            the shell took over the nav links. */}
        {canWrite ? (
          <Link
            href="/assets/new"
            className="text-sm underline underline-offset-4"
          >
            Add asset
          </Link>
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
            {assets.map((asset) => (
              <TableRow key={asset.id}>
                <TableCell>
                  <Link
                    href={`/assets/${asset.id}`}
                    className="underline underline-offset-4"
                  >
                    {asset.tag ?? "Untagged"}
                  </Link>
                </TableCell>
                <TableCell>
                  {asset.make} {asset.model}
                </TableCell>
                <TableCell>{asset.category.name}</TableCell>
                <TableCell>{STATUS_LABELS[asset.status]}</TableCell>
                {canSeeHolders ? (
                  <TableCell>
                    {/* Rendered only inside canSeeHolders, so the link can
                        never appear for a viewer /people/[id] would reject. */}
                    {(() => {
                      const holder = holderByAsset.get(asset.id);
                      return holder ? (
                        <Link
                          href={`/people/${holder.id}`}
                          className="underline underline-offset-4"
                        >
                          {holder.name}
                        </Link>
                      ) : (
                        "—"
                      );
                    })()}
                  </TableCell>
                ) : null}
                <TableCell>{asset.site?.name ?? "—"}</TableCell>
                <TableCell>{asset.condition ?? "—"}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </>
  );
}
