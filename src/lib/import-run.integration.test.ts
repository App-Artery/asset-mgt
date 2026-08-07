// @vitest-environment node
//
// AM-04 DESIGN §10. The properties here cannot be mocked: that a dry run leaves
// the database untouched, that a re-run adds nothing, and that the reconciliation
// totals actually add up against real inserts.
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { AssetStatus, PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { IMPORT_PROBLEMS } from "@/lib/import-map";
import {
  ImportFileError,
  hashRows,
  runImport,
  type ParsedSheet,
} from "@/lib/import-run";
import { EXPECTED_HEADERS } from "@/lib/import-map";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)("import run (real DB)", () => {
  let db: PrismaClient;

  beforeAll(async () => {
    execSync("pnpm exec prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: testDatabaseUrl },
      stdio: "inherit",
    });
    db = new PrismaClient({ datasourceUrl: testDatabaseUrl });
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  const stem = () => randomUUID().slice(0, 8).toUpperCase();

  /** One export row in the client's real shape — sparse, serial date, text cost. */
  function cells(overrides: Record<string, string | number> = {}) {
    return {
      "Asset Tag ID": `RUN-${randomUUID().slice(0, 10)}`,
      Description: "HP USB-C G5 Essential Docking Station",
      "Purchased from": "Read technologies",
      "Purchase Date": 45177,
      Cost: "229.81",
      "Serial No": `SER-${randomUUID().slice(0, 8)}`,
      "Asset Type": "CE",
      "City/Station": "KE02",
      CC: "CC3200",
      "P.O Number": "PO220202300331",
      Location: `Site ${stem()}`,
      Category: `Cat ${stem()}`,
      Department: "Mitigate",
      "Date Created": "07/29/2024 07:08 AM",
      "Created by": "Sam Operator",
      Status: "Available",
      ...overrides,
    };
  }

  const sheetOf = (rows: Record<string, string | number>[]): ParsedSheet => ({
    headers: [...EXPECTED_HEADERS],
    rows: rows.map((cellSet, index) => ({
      rowNumber: index + 2,
      cells: cellSet,
    })),
  });

  const bytes = () => new Uint8Array([1, 2, 3]);

  const dry = (sheet: ParsedSheet) =>
    runImport(db, sheet, bytes(), { commit: false });
  const commit = (sheet: ParsedSheet) =>
    runImport(db, sheet, bytes(), { commit: true });

  describe("dry run", () => {
    it("writes NOTHING, while reporting what it would write", async () => {
      const sheet = sheetOf([cells(), cells()]);
      const before = await db.asset.count();

      const result = await dry(sheet);

      expect(result.report.imported).toBe(2);
      expect(await db.asset.count()).toBe(before);
      // The reference rows it said it would create must not exist either.
      for (const name of result.report.newCategories) {
        expect(await db.category.findUnique({ where: { name } })).toBeNull();
      }
    });

    // The bug this file caught before it shipped: each row's transaction rolls
    // back, so caching a created id hands the NEXT row a foreign key that no
    // longer exists. A single-row dry run passes either way; two rows sharing a
    // new category is what exposes it.
    it("handles many rows sharing one new category and one new holder", async () => {
      const category = `Shared Cat ${stem()}`;
      const holder = `Shared Holder ${stem()}`;
      const sheet = sheetOf([
        cells({
          Category: category,
          Status: "Checked Out",
          "Assigned to": holder,
        }),
        cells({
          Category: category,
          Status: "Checked Out",
          "Assigned to": holder,
        }),
        cells({
          Category: category,
          Status: "Checked Out",
          "Assigned to": holder,
        }),
      ]);

      const result = await dry(sheet);

      expect(result.report.quarantined).toBe(0);
      expect(result.report.imported).toBe(3);
      // Counted per HUMAN and per NAME, not per row — three assets held by one
      // person is one person to create.
      expect(result.report.holders.created).toBe(1);
      expect(result.report.newCategories).toEqual([category]);
      expect(await db.person.count({ where: { name: holder } })).toBe(0);
    });

    it("reports the reference census the operator has to sign", async () => {
      const category = `Census Cat ${stem()}`;
      const site = `Census Site ${stem()}`;
      const result = await dry(
        sheetOf([cells({ Category: category, Location: site })]),
      );

      expect(result.report.newCategories).toEqual([category]);
      expect(result.report.newSites).toEqual([site]);
    });
  });

  describe("commit", () => {
    it("imports, and a re-run of the same file adds nothing", async () => {
      const sheet = sheetOf([cells(), cells()]);

      const first = await commit(sheet);
      expect(first.report.imported).toBe(2);

      const again = await commit(sheet);
      expect(again.report.imported).toBe(0);
      expect(again.report.skipped).toBe(2);

      // Insert-only: no second asset, and no UPDATED event claiming a change
      // nobody made.
      for (const outcome of again.report.outcomes) {
        if (outcome.kind !== "skipped") continue;
        const asset = await db.asset.findUniqueOrThrow({
          where: { tag: outcome.tag },
          include: { events: true },
        });
        expect(asset.events).toHaveLength(1);
        expect(asset.events[0].type).toBe("IMPORTED");
      }
    });

    it("reports a changed row as a CONFLICT and does not overwrite it", async () => {
      const row = cells();
      await commit(sheetOf([row]));

      const edited = { ...row, Description: "Edited by hand in the app" };
      const result = await commit(sheetOf([edited]));

      expect(result.report.conflicted).toBe(1);
      const conflict = result.report.outcomes.find(
        (outcome) => outcome.kind === "conflict",
      );
      expect(conflict).toMatchObject({ fields: ["description"] });
      // The admin's edit survives — the import does not revert it.
      const asset = await db.asset.findUniqueOrThrow({
        where: { tag: String(row["Asset Tag ID"]) },
      });
      expect(asset.description).toBe("HP USB-C G5 Essential Docking Station");
    });

    it("imports a legacy ASSIGNED row with its holder", async () => {
      const holder = `Legacy Holder ${stem()}`;
      const result = await commit(
        sheetOf([cells({ Status: "Checked Out", "Assigned to": holder })]),
      );

      expect(result.report.imported).toBe(1);
      expect(result.report.holders.created).toBe(1);

      const person = await db.person.findFirstOrThrow({
        where: { name: holder },
        include: { assignments: { include: { asset: true } } },
      });
      expect(person.email).toBeNull();
      expect(person.assignments).toHaveLength(1);
      expect(person.assignments[0].returnedAt).toBeNull();
      expect(person.assignments[0].asset.status).toBe(AssetStatus.ASSIGNED);
      // Back-dated from the source, not stamped with the cutover date.
      expect(person.assignments[0].checkedOutAt.toISOString()).toBe(
        "2023-09-08T00:00:00.000Z",
      );
    });

    it("quarantines an ambiguous holder without importing the asset", async () => {
      const name = `Twin ${stem()}`;
      await db.person.create({ data: { name, email: null } });
      await db.person.create({ data: { name, email: null } });

      const row = cells({ Status: "Checked Out", "Assigned to": name });
      const result = await commit(sheetOf([row]));

      expect(result.report.quarantined).toBe(1);
      expect(result.report.problems[IMPORT_PROBLEMS.AMBIGUOUS_HOLDER]).toBe(1);
      // The whole row rolled back — no orphan asset with no holder.
      expect(
        await db.asset.findUnique({
          where: { tag: String(row["Asset Tag ID"]) },
        }),
      ).toBeNull();
      expect(await db.person.count({ where: { name } })).toBe(2);
    });

    it("keeps importing after a quarantined row", async () => {
      // The reason quarantine beats fail-fast: one bad row must not block 399.
      const good = cells();
      const result = await commit(
        sheetOf([cells({ Status: "Leased" }), good, cells({ Status: "" })]),
      );

      expect(result.report.imported).toBe(1);
      expect(result.report.quarantined).toBe(2);
      expect(result.report.problems[IMPORT_PROBLEMS.UNKNOWN_STATUS]).toBe(2);
      expect(
        await db.asset.findUnique({
          where: { tag: String(good["Asset Tag ID"]) },
        }),
      ).not.toBeNull();
    });

    it("quarantines a tag repeated inside the file", async () => {
      const tag = `DUP-${randomUUID().slice(0, 10)}`;
      const result = await commit(
        sheetOf([
          cells({ "Asset Tag ID": tag }),
          cells({ "Asset Tag ID": tag }),
        ]),
      );

      expect(result.report.imported).toBe(1);
      // Reported as a source-data problem, NOT as "already imported" — which is
      // what the unique index alone would have made it look like.
      expect(
        result.report.problems[IMPORT_PROBLEMS.DUPLICATE_TAG_IN_FILE],
      ).toBe(1);
    });
  });

  describe("reconciliation and file-level failures", () => {
    // AM-04-C23, with its premise guarded: a fixture where everything succeeds
    // would make 0 failures pass vacuously, so this one deliberately contains
    // both.
    it("accounts for every source row exactly once", async () => {
      const sheet = sheetOf([
        cells(),
        cells({ Status: "Leased" }),
        cells({ "Asset Tag ID": "" }),
        cells(),
      ]);

      const { report } = await commit(sheet);

      expect(report.sourceRowCount).toBeGreaterThan(0);
      expect(report.quarantined).toBeGreaterThan(0);
      expect(
        report.imported +
          report.skipped +
          report.conflicted +
          report.quarantined,
      ).toBe(report.sourceRowCount);
      expect(report.outcomes).toHaveLength(report.sourceRowCount);
    });

    it("fails the whole file when a header is missing", async () => {
      const sheet = sheetOf([cells()]);
      sheet.headers = sheet.headers.filter((header) => header !== "Status");

      await expect(dry(sheet)).rejects.toThrow(ImportFileError);
    });

    it("persists no personal data in the report", async () => {
      // AM-04-C6, head-on. The name is in the source and in the in-flight
      // sign-off list; it must not be in the object that reaches ImportBatch.
      const name = `Jane Reportable ${stem()}`;
      const result = await commit(
        sheetOf([cells({ Status: "Checked Out", "Assigned to": name })]),
      );

      expect(JSON.stringify(result.report)).not.toContain("Jane Reportable");
      expect(JSON.stringify(result.report)).not.toContain("Sam Operator");
      // …while the operator's own sign-off list DOES carry it, because that is
      // printed and never stored.
      expect(result.holderSignOff.map((entry) => entry.name)).toContain(name);
    });
  });

  describe("hashRows", () => {
    it("is stable across cell ORDER but not across values", async () => {
      const base = cells();
      const reordered = Object.fromEntries(
        Object.entries(base).reverse(),
      ) as Record<string, string | number>;

      expect(hashRows(sheetOf([reordered]))).toBe(hashRows(sheetOf([base])));
      expect(hashRows(sheetOf([{ ...base, Cost: "1.00" }]))).not.toBe(
        hashRows(sheetOf([base])),
      );
    });
  });
});
