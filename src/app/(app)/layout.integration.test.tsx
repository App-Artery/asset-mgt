// @vitest-environment node
//
// Advisor condition (AM-01 security review): a deactivated user holding a
// still-valid JWT must not see the application — the DB status read decides.
// Session identity mocked, DB real.
//
// This guard used to live on the home page, which hand-rolled its own
// deactivatedAt check. AM-08 replaced that page with a redirect and moved the
// check to the (app) shell's requireRole, so the test moved with it rather
// than being deleted — extraction is exactly where cross-cutting guards get
// silently dropped (LEARNINGS §Frontend).
//
// The failure MODE changed with the move and that is deliberate: the old page
// redirected a deactivated user to /signin, while requireRole throws
// AuthorizationError. Every other authenticated page already behaved that way,
// so the home page was the outlier; the security property (a deactivated user
// sees nothing) is unchanged.
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
import AppLayout from "@/app/(app)/layout";
import { AuthorizationError } from "@/lib/authz";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const mockAuth = auth as unknown as Mock;

describe.skipIf(!testDatabaseUrl)(
  "home page deactivation gate (real DB)",
  () => {
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

    it("denies the shell to a deactivated user with a live session", async () => {
      const user = await db.user.create({
        data: {
          email: `shell-${randomUUID()}@example.com`,
          name: "Deactivated Leaver",
          role: Role.STAFF_RO,
          deactivatedAt: new Date(),
        },
      });
      mockAuth.mockResolvedValue({ user: { id: user.id } });

      await expect(AppLayout({ children: null })).rejects.toBeInstanceOf(
        AuthorizationError,
      );
    });

    it("redirects an unauthenticated caller to /signin", async () => {
      mockAuth.mockResolvedValue(null);

      // next/navigation redirect() throws a NEXT_REDIRECT control error whose
      // digest carries the target.
      await expect(AppLayout({ children: null })).rejects.toMatchObject({
        digest: expect.stringContaining("/signin"),
      });
    });

    it("renders the shell for an active user", async () => {
      const user = await db.user.create({
        data: {
          email: `shell-${randomUUID()}@example.com`,
          name: "Active Staffer",
          role: Role.STAFF_RO,
        },
      });
      mockAuth.mockResolvedValue({ user: { id: user.id } });

      await expect(AppLayout({ children: null })).resolves.toBeTruthy();
    });
  },
);
