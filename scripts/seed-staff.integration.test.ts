// @vitest-environment node
//
// Design test matrix item 7: seed idempotency — a re-run creates no
// duplicates and never downgrades a role — plus CSV parsing rules.
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PrismaClient, Role, UserEventType } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseStaffCsv, seedStaff, type StaffRow } from "./seed-staff";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe("parseStaffCsv", () => {
  it("parses rows and nulls an empty employeeRef", () => {
    const rows = parseStaffCsv(
      "name,email,employeeRef\nAlice Example,Alice@Example.com,EMP-001\nBob Example,bob@example.com,\n",
    );
    expect(rows).toEqual([
      {
        name: "Alice Example",
        email: "alice@example.com",
        employeeRef: "EMP-001",
      },
      { name: "Bob Example", email: "bob@example.com", employeeRef: null },
    ]);
  });

  it("rejects a wrong header and malformed rows", () => {
    expect(() => parseStaffCsv("nome,email\n")).toThrow(/header/);
    expect(() =>
      parseStaffCsv("name,email,employeeRef\nonly-a-name\n"),
    ).toThrow(/row 2/);
  });
});

describe.skipIf(!testDatabaseUrl)("seedStaff (real DB)", () => {
  let db: PrismaClient;

  beforeAll(() => {
    execSync("pnpm exec prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: testDatabaseUrl },
      stdio: "inherit",
    });
    db = new PrismaClient({ datasourceUrl: testDatabaseUrl });
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  function makeRows(): StaffRow[] {
    return [
      {
        name: "Seed One",
        email: `seed-${randomUUID()}@example.com`,
        employeeRef: `SEED-${randomUUID().slice(0, 8)}`,
      },
      {
        name: "Seed Two",
        email: `seed-${randomUUID()}@example.com`,
        employeeRef: null,
      },
    ];
  }

  it("is idempotent: a re-run creates nothing new and duplicates nothing", async () => {
    const rows = makeRows();
    const adminEmail = `seed-admin-${randomUUID()}@example.com`;

    const first = await seedStaff(db, { adminEmail, rows });
    expect(first).toMatchObject({
      created: 2,
      existing: 0,
      adminCreated: true,
      adminPromoted: false,
    });

    const second = await seedStaff(db, { adminEmail, rows });
    expect(second).toMatchObject({
      created: 0,
      existing: 2,
      adminCreated: false,
      adminPromoted: false,
    });

    for (const row of rows) {
      await expect(
        db.user.count({ where: { email: row.email } }),
      ).resolves.toBe(1);
      await expect(
        db.person.count({ where: { email: row.email } }),
      ).resolves.toBe(1);
      // Exactly one CREATED audit event per user, actorId null = system.
      const user = await db.user.findUniqueOrThrow({
        where: { email: row.email },
      });
      const events = await db.userEvent.findMany({
        where: { userId: user.id },
      });
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: UserEventType.CREATED,
        actorId: null,
        toRole: Role.STAFF_RO,
      });
    }

    const admin = await db.user.findUniqueOrThrow({
      where: { email: adminEmail },
    });
    expect(admin.role).toBe(Role.ADMIN_IT);
  });

  it("promotes an existing user to admin with an audit event, and never downgrades", async () => {
    const rows = makeRows();
    // The future admin already exists as STAFF_RO (seeded as a plain row).
    const first = await seedStaff(db, {
      adminEmail: `unrelated-admin-${randomUUID()}@example.com`,
      rows,
    });
    expect(first.created).toBe(2);

    // Promote rows[0] on the next run — case-insensitively.
    const promoted = await seedStaff(db, {
      adminEmail: rows[0].email.toUpperCase(),
      rows,
    });
    expect(promoted).toMatchObject({
      adminCreated: false,
      adminPromoted: true,
    });

    const adminUser = await db.user.findUniqueOrThrow({
      where: { email: rows[0].email },
    });
    expect(adminUser.role).toBe(Role.ADMIN_IT);
    await expect(
      db.userEvent.count({
        where: {
          userId: adminUser.id,
          type: UserEventType.ROLE_CHANGED,
          actorId: null,
          toRole: Role.ADMIN_IT,
        },
      }),
    ).resolves.toBe(1);

    // A third run must not touch the promoted admin (never downgrades) and
    // must not duplicate the promotion event.
    const third = await seedStaff(db, {
      adminEmail: rows[0].email,
      rows,
    });
    expect(third).toMatchObject({
      created: 0,
      existing: 2,
      adminCreated: false,
      adminPromoted: false,
    });
    const stillAdmin = await db.user.findUniqueOrThrow({
      where: { email: rows[0].email },
    });
    expect(stillAdmin.role).toBe(Role.ADMIN_IT);
    await expect(
      db.userEvent.count({
        where: { userId: adminUser.id, type: UserEventType.ROLE_CHANGED },
      }),
    ).resolves.toBe(1);
  });

  it("refuses an empty admin email", async () => {
    await expect(
      seedStaff(db, { adminEmail: "   ", rows: [] }),
    ).rejects.toThrow(/SEED_ADMIN_EMAIL/);
  });
});
