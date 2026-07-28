// @vitest-environment node
//
// AM-01 AC: "Staff are read-only, enforced server-side on every mutating
// route (real DB)". These tests drive the REAL server actions with a mocked
// session identity and a real database — if any action loses its leading
// `await requireRole("ADMIN_IT")`, the denial tests go red.
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PrismaClient, Role, UserEventType } from "@prisma/client";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  handlers: {},
}));
// Cache revalidation is Next.js request plumbing, not the seam under test —
// the DB reads/writes stay real.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { auth } from "@/auth";
import { AuthorizationError } from "@/lib/authz";
import {
  changeRole,
  createUser,
  deactivateUser,
  reactivateUser,
} from "@/app/admin/users/actions";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const mockAuth = auth as unknown as Mock;

describe.skipIf(!testDatabaseUrl)("admin user actions (real DB)", () => {
  let db: PrismaClient;

  beforeAll(() => {
    execSync("pnpm exec prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: testDatabaseUrl },
      stdio: "inherit",
    });
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.AUTH_SECRET = "test-secret";
    process.env.AUTH_RESEND_KEY = "test-key";
    process.env.AUTH_EMAIL_FROM = "test@example.com";
    db = new PrismaClient({ datasourceUrl: testDatabaseUrl });
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  async function createDbUser(role: Role, deactivated = false) {
    return db.user.create({
      data: {
        email: `actions-${randomUUID()}@example.com`,
        name: "Actions Test",
        role,
        deactivatedAt: deactivated ? new Date() : null,
      },
    });
  }

  function formData(entries: Record<string, string>): FormData {
    const fd = new FormData();
    for (const [key, value] of Object.entries(entries)) {
      fd.set(key, value);
    }
    return fd;
  }

  const mutatingActions = [
    ["createUser", createUser],
    ["changeRole", changeRole],
    ["deactivateUser", deactivateUser],
    ["reactivateUser", reactivateUser],
  ] as const;

  for (const [name, action] of mutatingActions) {
    it(`${name} denies every non-admin role server-side`, async () => {
      for (const role of [Role.PROCUREMENT, Role.FINANCE, Role.STAFF_RO]) {
        const actor = await createDbUser(role);
        mockAuth.mockResolvedValue({ user: { id: actor.id } });
        await expect(action(null, formData({}))).rejects.toThrow(
          AuthorizationError,
        );
      }
    });
  }

  it("createUser provisions Person + User + CREATED event, email lowercased", async () => {
    const admin = await createDbUser(Role.ADMIN_IT);
    mockAuth.mockResolvedValue({ user: { id: admin.id } });
    const email = `Actions-New-${randomUUID()}@Example.com`;

    const result = await createUser(
      null,
      formData({
        name: "New Colleague",
        email,
        employeeRef: `REF-${randomUUID().slice(0, 8)}`,
        role: "PROCUREMENT",
      }),
    );

    expect(result?.ok).toBe(true);
    const user = await db.user.findUnique({
      where: { email: email.toLowerCase() },
      include: { person: true, events: true },
    });
    expect(user).not.toBeNull();
    expect(user?.role).toBe(Role.PROCUREMENT);
    expect(user?.person).not.toBeNull();
    expect(user?.events).toHaveLength(1);
    expect(user?.events[0]).toMatchObject({
      type: UserEventType.CREATED,
      actorId: admin.id,
      toRole: Role.PROCUREMENT,
    });
  });

  it("createUser reports duplicates without partial writes", async () => {
    const admin = await createDbUser(Role.ADMIN_IT);
    mockAuth.mockResolvedValue({ user: { id: admin.id } });
    const email = `actions-dup-${randomUUID()}@example.com`;
    const fields = { name: "Dup", email, employeeRef: "", role: "STAFF_RO" };

    await expect(createUser(null, formData(fields))).resolves.toMatchObject({
      ok: true,
    });
    await expect(createUser(null, formData(fields))).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("already exists"),
    });
    await expect(db.user.count({ where: { email } })).resolves.toBe(1);
  });

  it("changeRole updates the role and audits it", async () => {
    const admin = await createDbUser(Role.ADMIN_IT);
    const subject = await createDbUser(Role.STAFF_RO);
    mockAuth.mockResolvedValue({ user: { id: admin.id } });

    const result = await changeRole(
      null,
      formData({ userId: subject.id, role: "FINANCE" }),
    );

    expect(result?.ok).toBe(true);
    const after = await db.user.findUniqueOrThrow({
      where: { id: subject.id },
    });
    expect(after.role).toBe(Role.FINANCE);
    await expect(
      db.userEvent.count({
        where: {
          userId: subject.id,
          type: UserEventType.ROLE_CHANGED,
          actorId: admin.id,
        },
      }),
    ).resolves.toBe(1);
  });

  it("changeRole surfaces the last-admin rejection as a form error, not a crash", async () => {
    const admin = await createDbUser(Role.ADMIN_IT);
    mockAuth.mockResolvedValue({ user: { id: admin.id } });
    // Make this admin the only active one (shared test DB keeps rows from
    // other files/runs; files run sequentially — vitest.config.ts).
    await db.user.updateMany({
      where: {
        role: Role.ADMIN_IT,
        deactivatedAt: null,
        id: { not: admin.id },
      },
      data: { deactivatedAt: new Date() },
    });

    const result = await changeRole(
      null,
      formData({ userId: admin.id, role: "STAFF_RO" }),
    );

    expect(result?.ok).toBe(false);
    expect(result?.message).toContain("no active IT admin");
    const after = await db.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(after.role).toBe(Role.ADMIN_IT);
  });

  it("deactivateUser / reactivateUser flip the flag with audit events — never a delete", async () => {
    const admin = await createDbUser(Role.ADMIN_IT);
    const subject = await createDbUser(Role.STAFF_RO);
    mockAuth.mockResolvedValue({ user: { id: admin.id } });

    await expect(
      deactivateUser(null, formData({ userId: subject.id })),
    ).resolves.toMatchObject({ ok: true });
    const deactivated = await db.user.findUniqueOrThrow({
      where: { id: subject.id },
    });
    expect(deactivated.deactivatedAt).not.toBeNull();

    await expect(
      reactivateUser(null, formData({ userId: subject.id })),
    ).resolves.toMatchObject({ ok: true });
    const reactivated = await db.user.findUniqueOrThrow({
      where: { id: subject.id },
    });
    expect(reactivated.deactivatedAt).toBeNull();

    await expect(
      db.userEvent.findMany({
        where: {
          userId: subject.id,
          type: {
            in: [UserEventType.DEACTIVATED, UserEventType.REACTIVATED],
          },
        },
        orderBy: { at: "asc" },
      }),
    ).resolves.toMatchObject([
      { type: UserEventType.DEACTIVATED, actorId: admin.id },
      { type: UserEventType.REACTIVATED, actorId: admin.id },
    ]);
  });
});
