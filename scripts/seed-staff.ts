// Staff seed CLI — provisions Person+User rows from a CSV and ensures the
// first admin. Run as `pnpm db:seed` (dotenv-cli loads .env because tsx does
// not autoload env files; explicit env vars override .env, so local runs use
// `DATABASE_URL=… SEED_ADMIN_EMAIL=… pnpm db:seed`).
//
// Config is read from process.env HERE, deliberately not via src/lib/env.ts:
// SEED_ADMIN_EMAIL and STAFF_CSV are script-only inputs, not app runtime
// config, and the seed must not demand the app's Resend/auth secrets.
//
//   DATABASE_URL      target database (required)
//   SEED_ADMIN_EMAIL  required — user to create-or-promote to ADMIN_IT;
//                     the script REFUSES to run without it (no hardcoded
//                     admin identity)
//   STAFF_CSV         optional CSV path (or pass as the first argument);
//                     omitted → admin-only seed
//
// The REAL staff CSV is Kenya-DPA personal data: keep it under seed-data/
// (gitignored) — it must never enter the repo. scripts/staff.example.csv is
// synthetic and documents the format.
//
// Idempotent by construction: upserts by lowercased email, never downgrades
// an existing role, and only new rows get a UserEvent CREATED (actorId null
// = system). Audit events are written in the same transaction as the rows
// they record.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { PrismaClient, Role, UserEventType } from "@prisma/client";

export type StaffRow = {
  name: string;
  email: string;
  employeeRef: string | null;
};

export type SeedResult = {
  created: number;
  existing: number;
  adminCreated: boolean;
  adminPromoted: boolean;
};

const CSV_HEADER = "name,email,employeeRef";

// Deliberately simple: comma-split, no quoting — the staff list has no
// commas in names or refs, and the example CSV documents the format.
export function parseStaffCsv(text: string): StaffRow[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines[0] !== CSV_HEADER) {
    throw new Error(
      `Staff CSV must start with the header "${CSV_HEADER}" (got "${lines[0] ?? ""}")`,
    );
  }
  return lines.slice(1).map((line, index) => {
    const [name, email, employeeRef, ...rest] = line.split(",");
    if (!name?.trim() || !email?.trim() || rest.length > 0) {
      throw new Error(`Malformed staff CSV row ${index + 2}: "${line}"`);
    }
    return {
      name: name.trim(),
      email: email.trim().toLowerCase(),
      employeeRef: employeeRef?.trim() ? employeeRef.trim() : null,
    };
  });
}

export async function seedStaff(
  db: PrismaClient,
  input: { adminEmail: string; rows: StaffRow[] },
): Promise<SeedResult> {
  const adminEmail = input.adminEmail.trim().toLowerCase();
  if (!adminEmail) {
    throw new Error("SEED_ADMIN_EMAIL is empty");
  }
  const result: SeedResult = {
    created: 0,
    existing: 0,
    adminCreated: false,
    adminPromoted: false,
  };

  for (const row of input.rows) {
    const email = row.email.trim().toLowerCase();
    await db.$transaction(async (tx) => {
      const person = await tx.person.upsert({
        where: { email },
        update: { name: row.name, employeeRef: row.employeeRef },
        create: { name: row.name, email, employeeRef: row.employeeRef },
      });
      const existingUser = await tx.user.findUnique({ where: { email } });
      if (existingUser) {
        // Existing users keep their role — the seed never downgrades.
        result.existing += 1;
        return;
      }
      const user = await tx.user.create({
        data: {
          name: row.name,
          email,
          role: Role.STAFF_RO,
          personId: person.id,
        },
      });
      await tx.userEvent.create({
        data: {
          userId: user.id,
          actorId: null,
          type: UserEventType.CREATED,
          toRole: Role.STAFF_RO,
        },
      });
      result.created += 1;
    });
  }

  await db.$transaction(async (tx) => {
    const existingAdmin = await tx.user.findUnique({
      where: { email: adminEmail },
    });
    if (!existingAdmin) {
      const person = await tx.person.upsert({
        where: { email: adminEmail },
        update: {},
        create: {
          // Placeholder name when the admin is not in the CSV; editable later.
          name: adminEmail.split("@")[0],
          email: adminEmail,
          employeeRef: null,
        },
      });
      const user = await tx.user.create({
        data: {
          name: person.name,
          email: adminEmail,
          role: Role.ADMIN_IT,
          personId: person.id,
        },
      });
      await tx.userEvent.create({
        data: {
          userId: user.id,
          actorId: null,
          type: UserEventType.CREATED,
          toRole: Role.ADMIN_IT,
        },
      });
      result.adminCreated = true;
    } else if (existingAdmin.role !== Role.ADMIN_IT) {
      // Promote (never the reverse). A deactivated user is NOT silently
      // reactivated — an admin must do that deliberately in /admin/users.
      await tx.user.update({
        where: { id: existingAdmin.id },
        data: { role: Role.ADMIN_IT },
      });
      await tx.userEvent.create({
        data: {
          userId: existingAdmin.id,
          actorId: null,
          type: UserEventType.ROLE_CHANGED,
          fromRole: existingAdmin.role,
          toRole: Role.ADMIN_IT,
        },
      });
      result.adminPromoted = true;
    }
  });

  return result;
}

async function main(): Promise<void> {
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  if (!adminEmail?.trim()) {
    console.error("SEED_ADMIN_EMAIL is required — refusing to run.");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set — refusing to run.");
    process.exit(1);
  }

  const csvPath = process.env.STAFF_CSV ?? process.argv[2];
  const rows = csvPath ? parseStaffCsv(readFileSync(csvPath, "utf8")) : [];
  if (!csvPath) {
    console.warn("No STAFF_CSV provided — seeding the admin user only.");
  }

  const db = new PrismaClient();
  try {
    const result = await seedStaff(db, { adminEmail, rows });
    console.log(
      `Seed complete: ${result.created} user(s) created, ` +
        `${result.existing} already present. Admin: ` +
        (result.adminCreated
          ? "created"
          : result.adminPromoted
            ? "promoted"
            : "already ADMIN_IT"),
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
