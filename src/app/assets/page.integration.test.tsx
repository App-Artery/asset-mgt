// @vitest-environment node
//
// PLAN.md task 5: all four roles read the register, and a malformed shared
// link renders the default register rather than a 500 (LEARNINGS §Zod). The
// filter WHERE clause is a real query against a real database — a mock would
// return the same canned rows whatever the clause said.
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { AssetStatus, PrismaClient, Role } from "@prisma/client";
import { renderToStaticMarkup } from "react-dom/server";
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
import { AuthorizationError } from "@/lib/authz";
import AssetsPage from "@/app/assets/page";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const mockAuth = auth as unknown as Mock;

type SearchParams = Record<string, string | string[] | undefined>;

describe.skipIf(!testDatabaseUrl)("asset register page (real DB)", () => {
  let db: PrismaClient;
  let categoryId: string;
  let otherCategoryId: string;
  let inStockTag: string;
  let onOrderId: string;

  beforeAll(async () => {
    execSync("pnpm exec prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: testDatabaseUrl },
      stdio: "inherit",
    });
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.AUTH_SECRET = "test-secret";
    process.env.AUTH_RESEND_KEY = "test-key";
    process.env.AUTH_EMAIL_FROM = "test@example.com";
    db = new PrismaClient({ datasourceUrl: testDatabaseUrl });

    const [category, otherCategory] = await Promise.all([
      db.category.create({ data: { name: `Register ${randomUUID()}` } }),
      db.category.create({ data: { name: `Other ${randomUUID()}` } }),
    ]);
    categoryId = category.id;
    otherCategoryId = otherCategory.id;

    inStockTag = `REG-${randomUUID().slice(0, 12)}`;
    const [inStock, onOrder] = await Promise.all([
      db.asset.create({
        data: {
          categoryId,
          make: "Register",
          model: "InStock",
          tag: inStockTag,
          status: AssetStatus.IN_STOCK,
        },
      }),
      db.asset.create({
        data: {
          categoryId: otherCategoryId,
          make: "Register",
          model: "OnOrder",
          status: AssetStatus.ON_ORDER,
        },
      }),
    ]);
    expect(inStock.id).toBeTruthy();
    onOrderId = onOrder.id;
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  async function signInAs(role: Role) {
    const user = await db.user.create({
      data: {
        email: `register-${randomUUID()}@example.com`,
        name: "Register Test",
        role,
      },
    });
    mockAuth.mockResolvedValue({ user: { id: user.id } });
    return user;
  }

  async function renderRegister(searchParams: SearchParams) {
    return renderToStaticMarkup(
      await AssetsPage({ searchParams: Promise.resolve(searchParams) }),
    );
  }

  for (const role of [
    Role.ADMIN_IT,
    Role.PROCUREMENT,
    Role.FINANCE,
    Role.STAFF_RO,
  ]) {
    it(`${role} can read the register`, async () => {
      await signInAs(role);
      const html = await renderRegister({});
      expect(html).toContain(inStockTag);
      // Write controls are rendered for write roles only. The server gate is
      // what enforces this (see actions.integration.test.ts); this asserts the
      // UX matches it.
      const canWrite = role === Role.ADMIN_IT || role === Role.PROCUREMENT;
      expect(html.includes('href="/assets/new"')).toBe(canWrite);
    });
  }

  it("denies a deactivated user holding a live session", async () => {
    const user = await signInAs(Role.ADMIN_IT);
    await db.user.update({
      where: { id: user.id },
      data: { deactivatedAt: new Date() },
    });
    await expect(renderRegister({})).rejects.toThrow(AuthorizationError);
  });

  it("filters by status without dropping the rest of the register", async () => {
    await signInAs(Role.FINANCE);

    const filtered = await renderRegister({ status: AssetStatus.ON_ORDER });
    expect(filtered).not.toContain(inStockTag);
    expect(filtered).toContain(`/assets/${onOrderId}`);
  });

  it("filters by category", async () => {
    await signInAs(Role.FINANCE);

    const filtered = await renderRegister({ categoryId });
    expect(filtered).toContain(inStockTag);
    expect(filtered).not.toContain(`/assets/${onOrderId}`);
  });

  it("treats an empty filter as no filter, not as a value that matches nothing", async () => {
    await signInAs(Role.STAFF_RO);

    // "" passes a `!= null` check and would match no rows if it reached the
    // WHERE clause (LEARNINGS §Prisma).
    const html = await renderRegister({
      status: "",
      categoryId: "",
      siteId: "",
    });
    expect(html).toContain(inStockTag);
    expect(html).toContain(`/assets/${onOrderId}`);
  });

  it("keeps a real filter when a sibling filter is left blank", async () => {
    await signInAs(Role.FINANCE);

    // The everyday case: pick a category, leave Status on "All". The blank
    // must be normalised away per-field BEFORE validation — validate first and
    // "" fails the enum, the whole safeParse fails, and the category the user
    // actually chose is silently dropped (LEARNINGS §Zod).
    const html = await renderRegister({ status: "", categoryId, siteId: "" });

    expect(html).toContain(inStockTag);
    expect(html).not.toContain(`/assets/${onOrderId}`);
  });

  it("renders the default register for a malformed link rather than a 500", async () => {
    await signInAs(Role.STAFF_RO);

    // A shared link someone hand-edited: a status outside the enum, and a
    // repeated param that arrives as an array.
    const html = await renderRegister({
      status: "NOT_A_REAL_STATUS",
      categoryId: ["a", "b"],
    });

    expect(html).toContain(inStockTag);
    expect(html).toContain(`/assets/${onOrderId}`);
  });
});
