// Reference-data seed CLI — provisions the Category and Site rows the asset
// register cannot function without. Run as `pnpm db:seed:reference` (dotenv-cli
// loads .env because tsx does not autoload env files; explicit env vars
// override .env, so local runs use `DATABASE_URL=… pnpm db:seed:reference`).
//
// Config is read from process.env HERE, deliberately not via src/lib/env.ts:
// REFERENCE_CSV is a script-only input, not app runtime config, and the seed
// must not demand the app's Resend/auth secrets.
//
//   DATABASE_URL   target database (required)
//   REFERENCE_CSV  optional CSV path (or pass as the first argument);
//                  defaults to scripts/reference.example.csv
//
// scripts/reference.example.csv is deliberately generic. Real client site
// names are operational detail that stays out of the repo — put a real list
// under seed-data/ (gitignored) and point REFERENCE_CSV at it.
//
// Idempotent by construction: rows are inserted by unique name with duplicates
// skipped, so a re-run neither duplicates nor renames anything. The run FAILS
// (non-zero) if it finishes with zero categories: Asset.categoryId is
// required, so a "successful" run that leaves none has quietly left the
// register unusable — silent idempotency is not a virtue when the invariant
// fails (AM-01 retro, "What we'd do differently").

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";

export type ReferenceType = "category" | "site";

export type ReferenceRow = {
  type: ReferenceType;
  name: string;
};

export type SeedReferenceResult = {
  category: { created: number; unchanged: number };
  site: { created: number; unchanged: number };
};

// Structural, so an interactive transaction client satisfies it too.
type ReferenceDb = Pick<PrismaClient, "category" | "site">;

const CSV_HEADER = "type,name";
const REFERENCE_TYPES = ["category", "site"] as const;
const DEFAULT_CSV_PATH = fileURLToPath(
  new URL("reference.example.csv", import.meta.url),
);

function isReferenceType(value: string): value is ReferenceType {
  return (REFERENCE_TYPES as readonly string[]).includes(value);
}

// Deliberately simple: comma-split, no quoting — category and site names have
// no commas, and the example CSV documents the format. Row numbers in errors
// are real file line numbers so the offending row is findable.
export function parseReferenceCsv(text: string): ReferenceRow[] {
  const lines = text.split(/\r?\n/);
  const headerIndex = lines.findIndex((line) => line.trim().length > 0);
  if (headerIndex === -1 || lines[headerIndex].trim() !== CSV_HEADER) {
    throw new Error(
      `Reference CSV must start with the header "${CSV_HEADER}" ` +
        `(got "${lines[headerIndex]?.trim() ?? ""}")`,
    );
  }

  const rows: ReferenceRow[] = [];
  const seen = new Set<string>();
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (line.length === 0) {
      continue;
    }
    const lineNumber = index + 1;
    const [rawType, rawName, ...rest] = line.split(",");
    const type = rawType.trim().toLowerCase();
    const name = rawName?.trim() ?? "";
    // An unknown type is a mistake in the file, not a row to skip: skipping
    // would seed a partial register and report success.
    if (!isReferenceType(type)) {
      throw new Error(
        `Reference CSV row ${lineNumber}: unknown type "${rawType.trim()}" — ` +
          `expected ${REFERENCE_TYPES.join(" or ")}`,
      );
    }
    if (!name || rest.length > 0) {
      throw new Error(`Malformed reference CSV row ${lineNumber}: "${line}"`);
    }
    // A name repeated within one file is one row — counting it twice would
    // make the summary lie about what the database gained.
    const key = `${type}:${name}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    rows.push({ type, name });
  }
  return rows;
}

/**
 * The seed's post-condition. Pure and exported so the guard is testable
 * directly, without having to arrange an empty Category table.
 *
 * Deliberately a function of the WHOLE table, not of this run's insert count:
 * re-running against a database that already holds categories legitimately
 * gains nothing, and must stay a success. Zero categories is the failure —
 * Asset.categoryId is required, so the register cannot record anything.
 */
export function assertSeedPostCondition(categoryCount: number): void {
  if (categoryCount === 0) {
    throw new Error(
      "Reference seed finished with zero categories — an asset cannot be " +
        "created without one. Check the CSV has at least one `category` row.",
    );
  }
}

export async function seedReference(
  db: ReferenceDb,
  rows: ReferenceRow[],
): Promise<SeedReferenceResult> {
  const names = (type: ReferenceType) =>
    rows.filter((row) => row.type === type).map((row) => ({ name: row.name }));

  const categoryNames = names("category");
  const siteNames = names("site");

  // createMany + skipDuplicates is the idempotency: the unique index on name
  // decides, so a concurrent or repeated run cannot duplicate, and `count` is
  // exactly the number of rows the database actually gained.
  const categoryInsert = await db.category.createMany({
    data: categoryNames,
    skipDuplicates: true,
  });
  const siteInsert = await db.site.createMany({
    data: siteNames,
    skipDuplicates: true,
  });

  assertSeedPostCondition(await db.category.count());

  return {
    category: {
      created: categoryInsert.count,
      unchanged: categoryNames.length - categoryInsert.count,
    },
    site: {
      created: siteInsert.count,
      unchanged: siteNames.length - siteInsert.count,
    },
  };
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set — refusing to run.");
    process.exit(1);
  }

  const csvPath =
    process.env.REFERENCE_CSV ?? process.argv[2] ?? DEFAULT_CSV_PATH;
  const rows = parseReferenceCsv(readFileSync(csvPath, "utf8"));

  const db = new PrismaClient();
  try {
    const result = await seedReference(db, rows);
    console.log(
      `Reference seed complete from ${csvPath}: ` +
        `categories ${result.category.created} created / ` +
        `${result.category.unchanged} unchanged, ` +
        `sites ${result.site.created} created / ` +
        `${result.site.unchanged} unchanged.`,
    );
  } finally {
    await db.$disconnect();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
