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
import AssetsPage from "@/app/(app)/assets/page";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const mockAuth = auth as unknown as Mock;

type SearchParams = Record<string, string | string[] | undefined>;

describe.skipIf(!testDatabaseUrl)("asset register page (real DB)", () => {
  let db: PrismaClient;
  let categoryId: string;
  let otherCategoryId: string;
  let inStockTag: string;
  let onOrderId: string;
  let assignedTag: string;
  let holderName: string;
  let holderId: string;

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

    // An asset with an OPEN assignment, so the STAFF_RO holder assertions
    // below have something to fail against. Without it they pass vacuously —
    // a fixture that cannot reach the asserted state is not a guard
    // (LEARNINGS §Testing).
    holderName = `Holder ${randomUUID().slice(0, 8)}`;
    assignedTag = `REG-${randomUUID().slice(0, 12)}`;
    const holder = await db.person.create({
      data: {
        name: holderName,
        email: `holder-${randomUUID()}@example.com`,
      },
    });
    holderId = holder.id;
    const assigned = await db.asset.create({
      data: {
        categoryId,
        make: "Register",
        model: "Assigned",
        tag: assignedTag,
        status: AssetStatus.ASSIGNED,
      },
    });
    await db.assignment.create({
      data: { assetId: assigned.id, personId: holder.id },
    });
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

  it("renders both shapes from one fetch, so a phone gets cards and a desktop gets the table", async () => {
    await signInAs(Role.ADMIN_IT);
    const html = await renderRegister({});

    // Both exist in the markup; Tailwind breakpoints choose which is visible.
    // jsdom and renderToStaticMarkup have no layout, so asserting visibility
    // here would assert nothing (LEARNINGS §Testing) — a real-browser smoke
    // is where the breakpoint itself gets checked.
    expect(html).toContain('data-testid="asset-table"');
    expect(html).toContain('data-testid="asset-card-list"');
    // The same row appears in each shape, from a single query.
    expect(html.split(assignedTag).length - 1).toBe(2);
  });

  it("shows no holder in EITHER shape for STAFF_RO", async () => {
    await signInAs(Role.STAFF_RO);
    const html = await renderRegister({});

    // The register still lists the assigned asset...
    expect(html).toContain(assignedTag);
    // ...but carries no person data anywhere in it. The card list is a SECOND
    // render path for the holder, so a role-conditional that is correct in the
    // table can still be missing from the cards — this asserts both.
    expect(html).not.toContain("Held by");
    expect(html).not.toContain(holderName);
    expect(html).not.toContain(`/people/${holderId}`);
  });

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

  // AM-09 DESIGN §4.2 — the estate bar, and sort as URL state.
  describe("estate bar and sorting", () => {
    it("counts every status even while filtered to one of them", async () => {
      await signInAs(Role.FINANCE);

      const html = await renderRegister({ status: AssetStatus.ON_ORDER });

      // The bar is how a reader gets BACK out of a filter, so it has to keep
      // offering the statuses they are not currently looking at. Counting
      // against the filtered set instead would leave "On order N" alone on a
      // page with no way back — and the two WHERE clauses that make this work
      // differ by exactly one field, which is the kind of asymmetry a later
      // reader "fixes" (LEARNINGS §Prisma, count-query parity).
      //
      // Asserted on the SEGMENT labels, not on the words "Assigned"/"In stock":
      // the chip row renders all five statuses whatever their counts, so a
      // text assertion passes with the counts completely wrong. A segment is
      // rendered only when its count is above zero, so its aria-label is the
      // thing that actually disappears when this breaks. (Verified: pointing
      // the groupBy at the filtered clause turns both of these red.)
      expect(html).toMatch(/aria-label="Assigned, [1-9]\d* of \d+"/);
      expect(html).toMatch(/aria-label="In stock, [1-9]\d* of \d+"/);
      // …while the table itself really is filtered.
      expect(html).not.toContain(inStockTag);
    });

    it("announces which status filter is active", async () => {
      await signInAs(Role.FINANCE);

      const unfiltered = await renderRegister({});
      expect(unfiltered).not.toContain("aria-current");

      const filtered = await renderRegister({ status: AssetStatus.ON_ORDER });
      // `aria-current`, not `aria-pressed`: the chips are links, and
      // aria-pressed carries meaning only on role="button" — so the first
      // version of this announced the active filter as nothing at all.
      expect(filtered).toContain('aria-current="true"');
      expect(filtered).not.toContain("aria-pressed");
    });

    it("keeps untagged assets last in BOTH directions", async () => {
      await signInAs(Role.FINANCE);

      // Descending is the direction that matters, and it is the only one that
      // can catch this: Postgres already sorts NULLS LAST for ASC, so an
      // ascending-only assertion passes whether or not `nulls: "last"` is
      // there at all — which is exactly what the first version of this test
      // did. On DESC the default flips to NULLS FIRST, so an untagged asset
      // jumps to the top of a register someone is scanning for a tag number.
      for (const dir of ["asc", "desc"] as const) {
        const html = await renderRegister({ sort: "tag", dir });
        const untaggedAt = html.indexOf(`/assets/${onOrderId}`);
        const taggedAt = html.indexOf(inStockTag);
        expect(taggedAt).toBeGreaterThanOrEqual(0);
        expect(untaggedAt).toBeGreaterThan(taggedAt);
      }
    });

    it("reverses that order on dir=desc", async () => {
      await signInAs(Role.FINANCE);

      const ascending = await renderRegister({ sort: "tag", dir: "asc" });
      const descending = await renderRegister({ sort: "tag", dir: "desc" });

      const orderIn = (html: string) =>
        [inStockTag, assignedTag]
          .map((tag) => [tag, html.indexOf(tag)] as const)
          .sort((a, b) => a[1] - b[1])
          .map(([tag]) => tag);

      expect(orderIn(descending)).toEqual([...orderIn(ascending)].reverse());
    });

    it("keeps the sort when a filter is applied, and the filter when sorted", async () => {
      await signInAs(Role.FINANCE);

      // Both params on one request is the case that breaks when a control
      // rebuilds the query string from scratch instead of merging.
      const html = await renderRegister({
        status: AssetStatus.ON_ORDER,
        sort: "site",
        dir: "desc",
      });

      expect(html).toContain(`/assets/${onOrderId}`);
      expect(html).not.toContain(inStockTag);
      // The chosen column reports itself to assistive tech, and the form
      // carries both params forward so submitting a category does not silently
      // reset either one.
      expect(html).toContain('aria-sort="descending"');
      expect(html).toContain('name="sort" value="site"');
      expect(html).toContain('name="status" value="ON_ORDER"');
    });

    it("ignores a sort column that is not offered rather than failing", async () => {
      await signInAs(Role.STAFF_RO);

      // `holder` is deliberately not sortable — the holder comes from a second
      // query. A hand-edited link asking for it must fall back to the default
      // column, not 500 and not silently order by something else.
      //
      // The direction beside it is valid and is KEPT, which is the per-field
      // catch working: only the junk field falls back.
      const html = await renderRegister({ sort: "holder", dir: "desc" });

      expect(html).toContain(inStockTag);
      expect(html).toContain('aria-sort="descending"');
      // Descending on the default column, Tag — not on some other column.
      expect(html).toMatch(
        /Tag[\s\S]{0,120}aria-sort="descending"|aria-sort="descending"[\s\S]{0,200}Tag/,
      );
    });

    it("drops only the junk param, keeping the valid filters beside it", async () => {
      await signInAs(Role.FINANCE);

      // One safeParse over the whole object is all-or-nothing, so a single bad
      // param would discard every good one with it — with five params in the
      // URL that turns a typo into "your filters silently vanished". Each
      // field catches for itself.
      const html = await renderRegister({
        status: AssetStatus.ON_ORDER,
        sort: "not-a-column",
        dir: "sideways",
      });

      // The junk is gone…
      expect(html).toContain('aria-sort="ascending"');
      // …and the status the reader actually chose survived it.
      expect(html).toContain(`/assets/${onOrderId}`);
      expect(html).not.toContain(inStockTag);
    });
  });
});
