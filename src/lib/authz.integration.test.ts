// @vitest-environment node
//
// Design test matrix items 2 and 3: requireRole across all four roles ×
// allowed/denied, the deactivation kill-switch, and runtime role change with
// no redeploy. Session identity is mocked (vi.mock("@/auth")); the role and
// status reads are REAL DB — that seam is exactly what these tests guard.
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PrismaClient, Role } from "@prisma/client";
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

import { auth } from "@/auth";
import { AuthorizationError, requireRole } from "@/lib/authz";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const mockAuth = auth as unknown as Mock;

const ROLES = [
  Role.ADMIN_IT,
  Role.PROCUREMENT,
  Role.FINANCE,
  Role.STAFF_RO,
] as const;

describe.skipIf(!testDatabaseUrl)("requireRole (real DB)", () => {
  let db: PrismaClient;

  beforeAll(() => {
    execSync("pnpm exec prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: testDatabaseUrl },
      stdio: "inherit",
    });
    // requireRole reads through getDb()/env(): point the app's own client at
    // the test database and satisfy the env chokepoint (auth is mocked, so
    // the auth values are never used).
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.AUTH_SECRET = "test-secret";
    process.env.AUTH_RESEND_KEY = "test-key";
    process.env.AUTH_EMAIL_FROM = "test@example.com";
    db = new PrismaClient({ datasourceUrl: testDatabaseUrl });
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  async function createUser(role: Role, deactivated = false) {
    return db.user.create({
      data: {
        email: `authz-${randomUUID()}@example.com`,
        name: "Authz Test",
        role,
        deactivatedAt: deactivated ? new Date() : null,
      },
    });
  }

  // Full 4×4 matrix: allowed exactly when the user's role is the required one.
  for (const userRole of ROLES) {
    for (const required of ROLES) {
      const allowed = userRole === required;
      it(`${userRole} is ${allowed ? "allowed" : "denied"} by requireRole(${required})`, async () => {
        const user = await createUser(userRole);
        mockAuth.mockResolvedValue({ user: { id: user.id } });
        if (allowed) {
          await expect(requireRole(required)).resolves.toEqual({
            userId: user.id,
            role: userRole,
          });
        } else {
          await expect(requireRole(required)).rejects.toThrow(
            AuthorizationError,
          );
        }
      });
    }
  }

  it("allows a role that appears anywhere in the allowed list", async () => {
    const user = await createUser(Role.FINANCE);
    mockAuth.mockResolvedValue({ user: { id: user.id } });
    await expect(
      requireRole(Role.ADMIN_IT, Role.PROCUREMENT, Role.FINANCE),
    ).resolves.toEqual({ userId: user.id, role: Role.FINANCE });
  });

  it("denies a deactivated user regardless of role (kill-switch)", async () => {
    const user = await createUser(Role.ADMIN_IT, true);
    mockAuth.mockResolvedValue({ user: { id: user.id } });
    await expect(requireRole(Role.ADMIN_IT)).rejects.toThrow(
      AuthorizationError,
    );
  });

  it("makes a runtime role change effective on the next request — same session, no redeploy", async () => {
    const user = await createUser(Role.STAFF_RO);
    // The mocked JWT session never changes across this test — only the DB
    // row does. That is the design property: roles are DB-read per request.
    mockAuth.mockResolvedValue({ user: { id: user.id } });

    await expect(requireRole(Role.ADMIN_IT)).rejects.toThrow(
      AuthorizationError,
    );

    await db.user.update({
      where: { id: user.id },
      data: { role: Role.ADMIN_IT },
    });

    await expect(requireRole(Role.ADMIN_IT)).resolves.toEqual({
      userId: user.id,
      role: Role.ADMIN_IT,
    });
  });

  it("denies deactivation on the next request for a live session (leaver kill-switch)", async () => {
    const user = await createUser(Role.PROCUREMENT);
    mockAuth.mockResolvedValue({ user: { id: user.id } });
    await expect(requireRole(Role.PROCUREMENT)).resolves.toMatchObject({
      userId: user.id,
    });

    await db.user.update({
      where: { id: user.id },
      data: { deactivatedAt: new Date() },
    });

    await expect(requireRole(Role.PROCUREMENT)).rejects.toThrow(
      AuthorizationError,
    );
  });
});
