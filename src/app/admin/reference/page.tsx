import Link from "next/link";
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

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 p-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">
          Reference data
        </h1>
        <div className="flex items-baseline gap-4 text-sm">
          <Link href="/admin/users" className="underline underline-offset-4">
            Users
          </Link>
          <Link href="/" className="underline underline-offset-4">
            Home
          </Link>
        </div>
      </div>
      <p className="text-muted-foreground text-sm">
        Categories and sites can be added and renamed, never removed — assets
        keep pointing at the row they were filed under, so a rename relabels
        their history rather than breaking it. Every asset needs a category.
      </p>
      <ReferenceSection
        kind="category"
        title="Categories"
        rows={toRows(categories)}
      />
      <ReferenceSection kind="site" title="Sites" rows={toRows(sites)} />
    </main>
  );
}
