// @vitest-environment node
//
// /signin is the one page outside the middleware matcher, so nothing upstream
// bounces an already-authenticated visitor off it — the page must do it itself,
// or a verified magic link lands on the sign-in form (the AM-01 redirect bug).
//
// The guard cannot be a bare session check: src/app/page.tsx redirects a
// DEACTIVATED user holding a still-valid JWT to /signin, so "has session →
// redirect to /" would ping-pong those users forever. Status is DB-read here
// for the same reason requireRole reads it. Session identity mocked, DB real.
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
import SignInPage from "@/app/signin/page";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const mockAuth = auth as unknown as Mock;

function render() {
  return SignInPage({ searchParams: Promise.resolve({}) });
}

describe.skipIf(!testDatabaseUrl)("signin page session guard (real DB)", () => {
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

  it("redirects an active signed-in visitor to the app", async () => {
    const user = await db.user.create({
      data: {
        email: `signin-${randomUUID()}@example.com`,
        name: "Active Staffer",
        role: Role.STAFF_RO,
      },
    });
    mockAuth.mockResolvedValue({ user: { id: user.id } });

    // next/navigation redirect() throws a NEXT_REDIRECT control error whose
    // digest carries the target.
    await expect(render()).rejects.toMatchObject({
      digest: expect.stringContaining("NEXT_REDIRECT"),
    });
  });

  it("renders the form for a deactivated user rather than looping back to /", async () => {
    const user = await db.user.create({
      data: {
        email: `signin-${randomUUID()}@example.com`,
        name: "Deactivated Leaver",
        role: Role.STAFF_RO,
        deactivatedAt: new Date(),
      },
    });
    mockAuth.mockResolvedValue({ user: { id: user.id } });

    await expect(render()).resolves.toBeTruthy();
  });

  it("renders the form for an anonymous visitor", async () => {
    mockAuth.mockResolvedValue(null);

    await expect(render()).resolves.toBeTruthy();
  });
});
