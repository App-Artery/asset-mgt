import { requireRole } from "@/lib/authz";
import { getDb } from "@/lib/db";
import { ReferenceSection, type ReferenceRow } from "./reference-section";

type NamedRecord = { id: string; name: string; _count: { assets: number } };

function toRows(records: NamedRecord[]): ReferenceRow[] {
  return records.map((record) => ({
    id: record.id,
    name: record.name,
    assetCount: record._count.assets,
  }));
}

export default async function AdminReferencePage() {
  await requireRole("ADMIN_IT");

  const db = getDb();
  const select = {
    id: true,
    name: true,
    _count: { select: { assets: true } },
  } as const;
  const [categories, sites] = await Promise.all([
    db.category.findMany({ orderBy: { name: "asc" }, select }),
    db.site.findMany({ orderBy: { name: "asc" }, select }),
  ]);

  const filed = categories.reduce(
    (total, category) => total + category._count.assets,
    0,
  );

  return (
    <>
      <div className="flex items-baseline gap-2.5">
        <h1 className="font-semibold tracking-tight">Categories &amp; sites</h1>
        <p className="text-muted-foreground font-mono text-sm tabular-nums">
          {filed} {filed === 1 ? "asset" : "assets"} filed
        </p>
      </div>
      {/* One line under the heading rather than a paragraph across the top: it
          is a rule you need at the moment you go looking for a delete button,
          which is the moment you reach for a row. */}
      <p className="text-muted-foreground -mt-2 text-sm">
        Renamed, never removed — assets keep pointing at the row they were filed
        under, so a rename relabels their history rather than breaking it.
      </p>
      {/* Two stacked tables wasted most of a desktop; side by side, both fit
          above the fold and the counts can be compared. */}
      <div className="grid gap-x-10 gap-y-8 md:grid-cols-2">
        <ReferenceSection
          kind="category"
          title="Categories"
          rows={toRows(categories)}
        />
        <ReferenceSection kind="site" title="Sites" rows={toRows(sites)} />
      </div>
    </>
  );
}
