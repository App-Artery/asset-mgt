// @vitest-environment node
//
// AM-02 task 6a: the reference seed is idempotent, trims what it stores, and
// fails loudly rather than leaving the register unusable.
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  parseReferenceCsv,
  seedReference,
  type ReferenceRow,
} from "./seed-reference";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

// Proving the zero-category post-condition needs a Category table that can
// actually reach zero, and in the shared test schema it cannot: assets pin
// their category, and AssetEvent may never be deleted to clear them
// (CLAUDE.md, append-only). So this file migrates its own Postgres schema
// inside the test database and owns every row in it.
const SCHEMA = "seed_reference_test";
const schemaUrl = testDatabaseUrl
  ? `${testDatabaseUrl}${testDatabaseUrl.includes("?") ? "&" : "?"}schema=${SCHEMA}`
  : undefined;

describe("parseReferenceCsv", () => {
  it("trims names, lowercases the type and skips blank rows", () => {
    expect(
      parseReferenceCsv(
        "type,name\n Category , Laptop \n\nSITE,Head Office\n\n",
      ),
    ).toEqual([
      { type: "category", name: "Laptop" },
      { type: "site", name: "Head Office" },
    ]);
  });

  it("treats a name repeated within one file as one row", () => {
    expect(
      parseReferenceCsv("type,name\ncategory,Laptop\ncategory,Laptop\n"),
    ).toEqual([{ type: "category", name: "Laptop" }]);
    // Same name under a different type is a different row.
    expect(
      parseReferenceCsv("type,name\ncategory,Nairobi\nsite,Nairobi\n"),
    ).toEqual([
      { type: "category", name: "Nairobi" },
      { type: "site", name: "Nairobi" },
    ]);
  });

  it("fails loudly on an unknown type, naming the row — never skips it", () => {
    expect(() =>
      parseReferenceCsv("type,name\ncategory,Laptop\nbuilding,Head Office\n"),
    ).toThrow(/row 3: unknown type "building"/);
  });

  it("rejects a wrong header and a row missing its name", () => {
    expect(() => parseReferenceCsv("kind,name\ncategory,Laptop\n")).toThrow(
      /header/,
    );
    expect(() => parseReferenceCsv("type,name\ncategory,\n")).toThrow(/row 2/);
  });
});

describe.skipIf(!testDatabaseUrl)("seedReference (real DB)", () => {
  let db: PrismaClient;

  beforeAll(async () => {
    const bootstrap = new PrismaClient({ datasourceUrl: testDatabaseUrl });
    try {
      await bootstrap.$executeRawUnsafe(
        `CREATE SCHEMA IF NOT EXISTS "${SCHEMA}"`,
      );
    } finally {
      await bootstrap.$disconnect();
    }
    execSync("pnpm exec prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: schemaUrl },
      stdio: "inherit",
    });
    db = new PrismaClient({ datasourceUrl: schemaUrl });
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  function makeRows(): ReferenceRow[] {
    const suffix = randomUUID().slice(0, 8);
    return [
      { type: "category", name: `Laptop ${suffix}` },
      { type: "category", name: `Monitor ${suffix}` },
      { type: "site", name: `Head Office ${suffix}` },
    ];
  }

  it("is idempotent: a re-run creates nothing new and duplicates nothing", async () => {
    const rows = makeRows();

    await expect(seedReference(db, rows)).resolves.toEqual({
      category: { created: 2, unchanged: 0 },
      site: { created: 1, unchanged: 0 },
    });
    await expect(seedReference(db, rows)).resolves.toEqual({
      category: { created: 0, unchanged: 2 },
      site: { created: 0, unchanged: 1 },
    });

    for (const row of rows) {
      const count =
        row.type === "category"
          ? await db.category.count({ where: { name: row.name } })
          : await db.site.count({ where: { name: row.name } });
      expect(count).toBe(1);
    }
  });

  it("stores trimmed names, so padded CSV cells cannot create near-duplicates", async () => {
    const name = `Docking Station ${randomUUID().slice(0, 8)}`;
    const parsed = parseReferenceCsv(`type,name\ncategory,   ${name}   \n`);

    await expect(seedReference(db, parsed)).resolves.toMatchObject({
      category: { created: 1 },
    });

    await expect(db.category.count({ where: { name } })).resolves.toBe(1);
    // The padded form was never written — a second run over the padded cell
    // matches the stored row rather than inserting beside it.
    await expect(seedReference(db, parsed)).resolves.toMatchObject({
      category: { created: 0, unchanged: 1 },
    });
  });

  it("exits non-zero when a run leaves zero categories", async () => {
    // Last in the file: it empties the Category table this schema owns. An
    // asset cannot be created without a category, so a site-only seed that
    // reported success would hand over an unusable register.
    await db.category.deleteMany();

    await expect(
      seedReference(db, [
        { type: "site", name: `Warehouse ${randomUUID().slice(0, 8)}` },
      ]),
    ).rejects.toThrow(/zero categories/);
  });
});
