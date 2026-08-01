// @vitest-environment node
//
// AM-02 task 6b: reference data is ADMIN_IT-only, and the only correction
// path is a rename. These tests drive the REAL server actions with a mocked
// session identity and a real database — if any action loses its leading
// `await requireRole("ADMIN_IT")`, the denial tests go red.
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
// Cache revalidation is Next.js request plumbing, not the seam under test —
// the DB reads/writes stay real.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { auth } from "@/auth";
import { AuthorizationError } from "@/lib/authz";
import {
  createCategory,
  createSite,
  renameCategory,
  renameSite,
} from "@/app/(app)/admin/reference/actions";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const mockAuth = auth as unknown as Mock;

describe.skipIf(!testDatabaseUrl)("admin reference actions (real DB)", () => {
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

  async function createDbUser(role: Role) {
    return db.user.create({
      data: {
        email: `reference-${randomUUID()}@example.com`,
        name: "Reference Test",
        role,
      },
    });
  }

  async function signInAs(role: Role) {
    const actor = await createDbUser(role);
    mockAuth.mockResolvedValue({ user: { id: actor.id } });
    return actor;
  }

  function formData(entries: Record<string, string>): FormData {
    const fd = new FormData();
    for (const [key, value] of Object.entries(entries)) {
      fd.set(key, value);
    }
    return fd;
  }

  const mutatingActions = [
    ["createCategory", createCategory],
    ["renameCategory", renameCategory],
    ["createSite", createSite],
    ["renameSite", renameSite],
  ] as const;

  for (const [name, action] of mutatingActions) {
    it(`${name} denies every non-admin role server-side`, async () => {
      // Empty form data on purpose: without the role gate these calls would
      // fall through to schema validation and RESOLVE with { ok: false }, so
      // this assertion is what the gate is holding up.
      for (const role of [Role.PROCUREMENT, Role.FINANCE, Role.STAFF_RO]) {
        await signInAs(role);
        await expect(action(null, formData({}))).rejects.toThrow(
          AuthorizationError,
        );
      }
    });
  }

  it("lets ADMIN_IT add and rename both a category and a site", async () => {
    await signInAs(Role.ADMIN_IT);
    const suffix = randomUUID().slice(0, 8);

    await expect(
      createCategory(null, formData({ name: `Laptop ${suffix}` })),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      createSite(null, formData({ name: `Depot ${suffix}` })),
    ).resolves.toMatchObject({ ok: true });

    const category = await db.category.findUniqueOrThrow({
      where: { name: `Laptop ${suffix}` },
    });
    const site = await db.site.findUniqueOrThrow({
      where: { name: `Depot ${suffix}` },
    });

    await expect(
      renameCategory(
        null,
        formData({ id: category.id, name: `Laptops ${suffix}` }),
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      renameSite(
        null,
        formData({ id: site.id, name: `Depot North ${suffix}` }),
      ),
    ).resolves.toMatchObject({ ok: true });

    await expect(
      db.category.findUniqueOrThrow({ where: { id: category.id } }),
    ).resolves.toMatchObject({ name: `Laptops ${suffix}` });
    await expect(
      db.site.findUniqueOrThrow({ where: { id: site.id } }),
    ).resolves.toMatchObject({ name: `Depot North ${suffix}` });
  });

  it("reports a duplicate name as a form error rather than throwing", async () => {
    await signInAs(Role.ADMIN_IT);
    const suffix = randomUUID().slice(0, 8);
    const taken = `Monitor ${suffix}`;

    await expect(
      createCategory(null, formData({ name: taken })),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      createCategory(null, formData({ name: taken })),
    ).resolves.toMatchObject({
      ok: false,
      message: "A category with that name already exists.",
    });
    await expect(db.category.count({ where: { name: taken } })).resolves.toBe(
      1,
    );

    // A rename onto a taken name is the same friendly rejection, and leaves
    // the row it was renaming untouched.
    const other = await db.category.create({
      data: { name: `Projector ${suffix}` },
    });
    await expect(
      renameCategory(null, formData({ id: other.id, name: taken })),
    ).resolves.toMatchObject({
      ok: false,
      message: "A category with that name already exists.",
    });
    await expect(
      db.category.findUniqueOrThrow({ where: { id: other.id } }),
    ).resolves.toMatchObject({ name: `Projector ${suffix}` });

    // Sites get their own wording, not the category one.
    const siteName = `Annex ${suffix}`;
    await expect(
      createSite(null, formData({ name: siteName })),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      createSite(null, formData({ name: siteName })),
    ).resolves.toMatchObject({
      ok: false,
      message: "A site with that name already exists.",
    });
  });

  it("trims the submitted name and rejects a blank one", async () => {
    await signInAs(Role.ADMIN_IT);
    const name = `Tablet ${randomUUID().slice(0, 8)}`;

    await expect(
      createCategory(null, formData({ name: `   ${name}   ` })),
    ).resolves.toMatchObject({ ok: true });
    await expect(db.category.count({ where: { name } })).resolves.toBe(1);

    await expect(
      createCategory(null, formData({ name: "   " })),
    ).resolves.toMatchObject({ ok: false });
  });

  it("renames the row assets already reference — never orphans or removes it", async () => {
    await signInAs(Role.ADMIN_IT);
    const suffix = randomUUID().slice(0, 8);
    const category = await db.category.create({
      data: { name: `Printer ${suffix}` },
    });
    const site = await db.site.create({ data: { name: `Works ${suffix}` } });
    // ON_ORDER is the one status the tag CHECK constraint exempts, so this
    // asset needs no tag to exist.
    const asset = await db.asset.create({
      data: {
        categoryId: category.id,
        siteId: site.id,
        make: "Acme",
        model: "LX-1",
      },
    });

    await expect(
      renameCategory(
        null,
        formData({ id: category.id, name: `Printers ${suffix}` }),
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      renameSite(
        null,
        formData({ id: site.id, name: `Works North ${suffix}` }),
      ),
    ).resolves.toMatchObject({ ok: true });

    const after = await db.asset.findUniqueOrThrow({
      where: { id: asset.id },
      include: { category: true, site: true },
    });
    // Same rows, new labels: the asset's foreign keys never moved.
    expect(after.categoryId).toBe(category.id);
    expect(after.category.name).toBe(`Printers ${suffix}`);
    expect(after.siteId).toBe(site.id);
    expect(after.site?.name).toBe(`Works North ${suffix}`);
    await expect(
      db.category.count({ where: { id: category.id } }),
    ).resolves.toBe(1);
    await expect(db.site.count({ where: { id: site.id } })).resolves.toBe(1);
  });
});
