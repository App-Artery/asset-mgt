// @vitest-environment node
//
// AM-02 task 6a: the reference seed is idempotent, trims what it stores, and
// fails loudly rather than leaving the register unusable.
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertSeedPostCondition,
  parseReferenceCsv,
  seedReference,
  type ReferenceRow,
} from "./seed-reference";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

// This file migrates its own Postgres schema inside the test database and owns
// every row in it. Two reasons:
//
// 1. The asset-core workstream is writing to public.Category/Site/Asset in the
//    same database concurrently. Nothing here may disturb those rows, so
//    nothing here touches that schema — verified by counting public.Category,
//    Site and Asset either side of a full run of this file: 62/18/132 before
//    and after, including the deleteMany below.
// 2. Proving the post-condition end-to-end needs a Category table that can
//    actually reach zero, and public cannot: assets pin their category, and
//    AssetEvent may never be deleted to clear them (CLAUDE.md, append-only).
//
// Every row in this schema was created by this file, so the deleteMany in the
// last test is scoped to rows we created — by construction, not by filter.
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

// The guard itself, testable without arranging an empty table anywhere.
describe("assertSeedPostCondition", () => {
  it("throws when the run would leave the database with no categories", () => {
    expect(() => assertSeedPostCondition(0)).toThrow(/zero categories/);
  });

  it("passes as soon as one category exists, however few this run added", () => {
    // A re-run against an already-seeded database inserts nothing and must
    // still succeed — the invariant is the table's state, not this run's yield.
    expect(() => assertSeedPostCondition(1)).not.toThrow();
    expect(() => assertSeedPostCondition(17)).not.toThrow();
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

    // Self-verify the isolation rather than trusting the ?schema= in schemaUrl.
    // The last test in this file calls category.deleteMany(), which is the most
    // destructive line in the branch: pointed at `public` it would delete the
    // asset workstream's fixtures, and against a real database it would delete
    // the client's categories. The safety rests entirely on this connection
    // resolving to the private schema, so assert it instead of assuming it — a
    // future edit to schemaUrl that silently drops the parameter fails here,
    // loudly, instead of succeeding destructively.
    const [{ current_schema: resolved }] = await db.$queryRawUnsafe<
      { current_schema: string }[]
    >("SELECT current_schema()");
    expect(resolved).toBe(SCHEMA);
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

  it("wires the real category count into the post-condition", async () => {
    // The unit test above proves the guard rejects zero; this proves
    // seedReference actually calls it with the live table count. Without
    // this, deleting the assertSeedPostCondition call from seedReference
    // would leave the unit test green — a guard nothing invokes.
    //
    // Last in the file: it empties the Category table THIS SCHEMA owns (every
    // row in it was created above). public.Category is untouched.
    await db.category.deleteMany();

    await expect(
      seedReference(db, [
        { type: "site", name: `Warehouse ${randomUUID().slice(0, 8)}` },
      ]),
    ).rejects.toThrow(/zero categories/);
  });
});
