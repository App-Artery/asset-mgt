// @vitest-environment node
//
// Design test matrix items 1 and 5 (docs/features/AM-01/DESIGN.md): the
// sign-in admission policy against a real database — unknown/deactivated
// rejection, lowercasing, and both throttle windows.
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  GLOBAL_DAILY_LIMIT,
  GLOBAL_DAILY_WINDOW_MS,
  GLOBAL_LIMIT,
  GLOBAL_WINDOW_MS,
  PER_EMAIL_LIMIT,
  PER_EMAIL_WINDOW_MS,
  isSignInAllowed,
} from "@/lib/sign-in-policy";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)("sign-in policy (real DB)", () => {
  let db: PrismaClient;

  beforeAll(async () => {
    execSync("pnpm exec prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: testDatabaseUrl },
      stdio: "inherit",
    });
    db = new PrismaClient({ datasourceUrl: testDatabaseUrl });
    // Clear leftover tokens from previous local runs so the global-window
    // count starts from a known state (only this file writes tokens).
    await db.verificationToken.deleteMany({});
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  function uniqueEmail(): string {
    return `policy-${randomUUID()}@example.com`;
  }

  async function provisionUser(email: string, deactivated = false) {
    return db.user.create({
      data: {
        email,
        name: "Policy Test",
        deactivatedAt: deactivated ? new Date() : null,
      },
    });
  }

  async function insertTokens(
    identifier: string,
    count: number,
    createdAt: Date,
  ) {
    for (let i = 0; i < count; i += 1) {
      await db.verificationToken.create({
        data: {
          identifier,
          token: randomUUID(),
          expires: new Date(Date.now() + 15 * 60 * 1000),
          createdAt,
        },
      });
    }
  }

  it("rejects an unknown email on both request and verification", async () => {
    const email = uniqueEmail();
    await expect(
      isSignInAllowed(db, email, { verificationRequest: true }),
    ).resolves.toBe(false);
    await expect(
      isSignInAllowed(db, email, { verificationRequest: false }),
    ).resolves.toBe(false);
  });

  it("rejects a missing email", async () => {
    await expect(
      isSignInAllowed(db, null, { verificationRequest: true }),
    ).resolves.toBe(false);
    await expect(
      isSignInAllowed(db, undefined, { verificationRequest: false }),
    ).resolves.toBe(false);
  });

  it("allows a provisioned active user", async () => {
    const email = uniqueEmail();
    await provisionUser(email);
    await expect(
      isSignInAllowed(db, email, { verificationRequest: true }),
    ).resolves.toBe(true);
  });

  it("matches case-insensitively (emails are lowercased at every lookup)", async () => {
    const email = uniqueEmail();
    await provisionUser(email);
    await expect(
      isSignInAllowed(db, ` ${email.toUpperCase()} `, {
        verificationRequest: true,
      }),
    ).resolves.toBe(true);
  });

  it("rejects a deactivated user even on link-click verification", async () => {
    const email = uniqueEmail();
    await provisionUser(email, true);
    await expect(
      isSignInAllowed(db, email, { verificationRequest: true }),
    ).resolves.toBe(false);
    await expect(
      isSignInAllowed(db, email, { verificationRequest: false }),
    ).resolves.toBe(false);
  });

  it("trips the per-email throttle at the limit", async () => {
    const email = uniqueEmail();
    await provisionUser(email);
    await insertTokens(email, PER_EMAIL_LIMIT - 1, new Date());
    await expect(
      isSignInAllowed(db, email, { verificationRequest: true }),
    ).resolves.toBe(true);
    await insertTokens(email, 1, new Date());
    await expect(
      isSignInAllowed(db, email, { verificationRequest: true }),
    ).resolves.toBe(false);
  });

  it("ignores tokens older than the per-email window", async () => {
    const email = uniqueEmail();
    await provisionUser(email);
    const stale = new Date(Date.now() - PER_EMAIL_WINDOW_MS - 60 * 1000);
    await insertTokens(email, PER_EMAIL_LIMIT, stale);
    await expect(
      isSignInAllowed(db, email, { verificationRequest: true }),
    ).resolves.toBe(true);
  });

  it("does not throttle link-click verification", async () => {
    const email = uniqueEmail();
    await provisionUser(email);
    await insertTokens(email, PER_EMAIL_LIMIT, new Date());
    await expect(
      isSignInAllowed(db, email, { verificationRequest: false }),
    ).resolves.toBe(true);
  });

  // The global tests run LAST in this file: they flood the global windows,
  // which would trip the per-email "allowed" assertions above if run first.
  it("trips the global hourly throttle at the limit", async () => {
    await db.verificationToken.deleteMany({});
    const email = uniqueEmail();
    await provisionUser(email);
    for (let i = 0; i < GLOBAL_LIMIT; i += 1) {
      await insertTokens(uniqueEmail(), 1, new Date());
    }
    await expect(
      isSignInAllowed(db, email, { verificationRequest: true }),
    ).resolves.toBe(false);
  });

  it("trips the rolling-24h global throttle even when the hourly window is quiet", async () => {
    // Tokens 2h old: outside the hourly window, inside the daily one — so
    // only the 24h cap can reject here. If the daily count is ever removed,
    // this goes red while the hourly test stays green (advisor condition:
    // 30/h sustained is 720/day vs the 100/day Resend quota).
    await db.verificationToken.deleteMany({});
    const email = uniqueEmail();
    await provisionUser(email);
    const twoHoursAgo = new Date(Date.now() - 2 * GLOBAL_WINDOW_MS);
    for (let i = 0; i < GLOBAL_DAILY_LIMIT - 1; i += 1) {
      await insertTokens(uniqueEmail(), 1, twoHoursAgo);
    }
    await expect(
      isSignInAllowed(db, email, { verificationRequest: true }),
    ).resolves.toBe(true);

    await insertTokens(uniqueEmail(), 1, twoHoursAgo);
    await expect(
      isSignInAllowed(db, email, { verificationRequest: true }),
    ).resolves.toBe(false);

    // Tokens older than 24h drop out of the window again.
    await db.verificationToken.deleteMany({});
    const stale = new Date(Date.now() - GLOBAL_DAILY_WINDOW_MS - 60 * 1000);
    for (let i = 0; i < GLOBAL_DAILY_LIMIT; i += 1) {
      await insertTokens(uniqueEmail(), 1, stale);
    }
    await expect(
      isSignInAllowed(db, email, { verificationRequest: true }),
    ).resolves.toBe(true);
  });
});
