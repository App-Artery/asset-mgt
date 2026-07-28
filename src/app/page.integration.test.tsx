// @vitest-environment node
//
// Advisor condition (security review): a deactivated user holding a
// still-valid JWT must not see the home page — the DB status read decides,
// mirroring requireRole's kill-switch. Session identity mocked, DB real.
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
import HomePage from "@/app/page";

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

    it("redirects a deactivated user with a live session to /signin", async () => {
      const user = await db.user.create({
        data: {
          email: `home-${randomUUID()}@example.com`,
          name: "Deactivated Leaver",
          role: Role.STAFF_RO,
          deactivatedAt: new Date(),
        },
      });
      mockAuth.mockResolvedValue({ user: { id: user.id } });

      // next/navigation redirect() throws a NEXT_REDIRECT control error whose
      // digest carries the target.
      await expect(HomePage()).rejects.toMatchObject({
        digest: expect.stringContaining("NEXT_REDIRECT"),
      });
      await expect(HomePage()).rejects.toMatchObject({
        digest: expect.stringContaining("/signin"),
      });
    });

    it("renders for an active user", async () => {
      const user = await db.user.create({
        data: {
          email: `home-${randomUUID()}@example.com`,
          name: "Active Staffer",
          role: Role.STAFF_RO,
        },
      });
      mockAuth.mockResolvedValue({ user: { id: user.id } });

      await expect(HomePage()).resolves.toBeTruthy();
    });
  },
);
