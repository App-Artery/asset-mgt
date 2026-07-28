// @vitest-environment node
//
// Real-DB integration test (LEARNINGS §Testing: mock-based tests cannot guard
// read/write seams). Runs ONLY when TEST_DATABASE_URL is set — locally against
// `docker compose up` Postgres, in CI against the postgres:17 service
// container. Never point it at a database whose data you care about.
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PrismaClient, AssetEventType, AssetStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)("AssetEvent audit trail (real DB)", () => {
  let db: PrismaClient;

  beforeAll(() => {
    // Apply the committed migrations to the test database (idempotent).
    execSync("pnpm exec prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: testDatabaseUrl },
      stdio: "inherit",
    });
    db = new PrismaClient({ datasourceUrl: testDatabaseUrl });
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  it("inserts an append-only event and reads it back", async () => {
    const suffix = randomUUID();

    const category = await db.category.create({
      data: { name: `Laptops ${suffix}` },
    });
    const asset = await db.asset.create({
      data: {
        make: "Dell",
        model: "Latitude 5440",
        categoryId: category.id,
      },
    });

    const created = await db.assetEvent.create({
      data: {
        assetId: asset.id,
        type: AssetEventType.CREATED,
        toStatus: AssetStatus.ON_ORDER,
        notes: "scaffold harness proof",
      },
    });

    const found = await db.assetEvent.findUniqueOrThrow({
      where: { id: created.id },
    });

    expect(found.assetId).toBe(asset.id);
    expect(found.type).toBe(AssetEventType.CREATED);
    expect(found.fromStatus).toBeNull();
    expect(found.toStatus).toBe(AssetStatus.ON_ORDER);
    expect(found.at).toBeInstanceOf(Date);
  });

  it("enforces the nullable-unique asset tag at the database level", async () => {
    const suffix = randomUUID();
    const category = await db.category.create({
      data: { name: `Phones ${suffix}` },
    });

    // Two untagged assets may coexist (tag is nullable until delivery)…
    await db.asset.createMany({
      data: [
        { make: "Apple", model: "iPhone 15", categoryId: category.id },
        { make: "Samsung", model: "Galaxy S24", categoryId: category.id },
      ],
    });

    // …but a duplicate tag must be rejected by the unique constraint.
    const tag = `T-${suffix.slice(0, 8)}`;
    await db.asset.create({
      data: { make: "HP", model: "EliteBook", categoryId: category.id, tag },
    });
    await expect(
      db.asset.create({
        data: { make: "HP", model: "ProBook", categoryId: category.id, tag },
      }),
    ).rejects.toThrow();
  });
});
