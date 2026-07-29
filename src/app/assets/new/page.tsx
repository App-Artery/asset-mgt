import Link from "next/link";
import { requireRole } from "@/lib/authz";
import { getDb } from "@/lib/db";
import { AssetForm } from "../asset-form";

export default async function NewAssetPage() {
  await requireRole("ADMIN_IT", "PROCUREMENT");

  const db = getDb();
  const [categories, sites] = await Promise.all([
    db.category.findMany({ orderBy: { name: "asc" } }),
    db.site.findMany({ orderBy: { name: "asc" } }),
  ]);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 p-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Add asset</h1>
        <Link href="/assets" className="text-sm underline underline-offset-4">
          Register
        </Link>
      </div>

      {categories.length === 0 ? (
        // Category is mandatory on every asset, so an empty category list is a
        // dead end — say so rather than rendering a select with nothing in it.
        <p className="text-sm">
          No categories exist yet, and every asset needs one. An IT admin can
          add categories under{" "}
          <Link
            href="/admin/reference"
            className="underline underline-offset-4"
          >
            reference data
          </Link>
          .
        </p>
      ) : (
        <AssetForm categories={categories} sites={sites} />
      )}
    </main>
  );
}
