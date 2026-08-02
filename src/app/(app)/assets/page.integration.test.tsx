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
  let siteId: string;
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

    const [category, otherCategory, site] = await Promise.all([
      db.category.create({ data: { name: `Register ${randomUUID()}` } }),
      db.category.create({ data: { name: `Other ${randomUUID()}` } }),
      db.site.create({ data: { name: `Register site ${randomUUID()}` } }),
    ]);
    categoryId = category.id;
    otherCategoryId = otherCategory.id;
    // Every fixture below sits on this site, so a test can ask for "my three
    // rows" with `{ siteId }` instead of rendering the whole table.
    //
    // Before pagination those were the same request: the register drew every
    // matching asset, so an unfiltered render was guaranteed to contain any
    // fixture. It now draws the first PAGE_SIZE by tag, and this database is
    // never truncated — it was at 4,771 assets when pagination landed, so a
    // `REG-<uuid>` fixture is essentially never on page 1. Fourteen tests in
    // this file failed that way.
    //
    // The nasty half is that CI could not have caught any of it: its Postgres
    // service container is fresh each run, so there the fixtures ARE the whole
    // register and every one of those assertions passes. Scoping to a fixture
    // site makes each test a statement about its own rows at any table size,
    // which is the only version that means the same thing in both places.
    siteId = site.id;

    inStockTag = `REG-${randomUUID().slice(0, 12)}`;
    const [inStock, onOrder] = await Promise.all([
      db.asset.create({
        data: {
          categoryId,
          siteId,
          make: "Register",
          model: "InStock",
          tag: inStockTag,
          status: AssetStatus.IN_STOCK,
        },
      }),
      db.asset.create({
        data: {
          categoryId: otherCategoryId,
          siteId,
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
        siteId,
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
      const html = await renderRegister({ siteId });
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
    const html = await renderRegister({ siteId });

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
    const html = await renderRegister({ siteId });

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

    const filtered = await renderRegister({
      status: AssetStatus.ON_ORDER,
      siteId,
    });
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
    //
    // `siteId` carries a real value so the assertion is about the fixtures
    // rather than about page 1 of the whole table; blank `status` and blank
    // `categoryId` are what this test is actually about. The blank-`siteId`
    // case is covered by the sibling test below, which leaves site empty and
    // category real — between them all three fields are proven.
    const html = await renderRegister({
      status: "",
      categoryId: "",
      siteId,
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
    // Both junk fields fall back to undefined; `siteId` is the one valid param
    // and scopes the render to the fixtures. If either fallback failed, Prisma
    // would be handed an invalid enum or an array and throw — so this still
    // proves the catch, and now proves it without depending on table size.
    const html = await renderRegister({
      status: "NOT_A_REAL_STATUS",
      categoryId: ["a", "b"],
      siteId,
    });

    expect(html).toContain(inStockTag);
    expect(html).toContain(`/assets/${onOrderId}`);
  });

  // AM-09 DESIGN §4.2 — the estate bar, and sort as URL state.
  describe("estate bar and sorting", () => {
    it("counts every status even while filtered to one of them", async () => {
      await signInAs(Role.FINANCE);

      const html = await renderRegister({
        status: AssetStatus.ON_ORDER,
        siteId,
      });

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

      const unfiltered = await renderRegister({ siteId });
      expect(unfiltered).not.toContain("aria-current");

      const filtered = await renderRegister({
        status: AssetStatus.ON_ORDER,
        siteId,
      });
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
        const html = await renderRegister({ sort: "tag", dir, siteId });
        const untaggedAt = html.indexOf(`/assets/${onOrderId}`);
        const taggedAt = html.indexOf(inStockTag);
        expect(taggedAt).toBeGreaterThanOrEqual(0);
        expect(untaggedAt).toBeGreaterThan(taggedAt);
      }
    });

    it("reverses that order on dir=desc", async () => {
      await signInAs(Role.FINANCE);

      const ascending = await renderRegister({
        sort: "tag",
        dir: "asc",
        siteId,
      });
      const descending = await renderRegister({
        sort: "tag",
        dir: "desc",
        siteId,
      });

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
        siteId,
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
      const html = await renderRegister({
        sort: "holder",
        dir: "desc",
        siteId,
      });

      expect(html).toContain(inStockTag);
      expect(html).toContain('aria-sort="descending"');
      // Descending on the default column, Tag — not on some other column.
      //
      // Read out of the cell that carries the attribute rather than by
      // character distance between "Tag" and `aria-sort`. The distance version
      // measured the length of the header's href, so scoping these tests with
      // a `siteId` param — which makes every href ~35 characters longer —
      // turned it red while the markup was entirely correct.
      const sorted = html.match(
        /<th[^>]*aria-sort="descending"[^>]*>([\s\S]*?)<\/th>/,
      );
      expect(sorted?.[1]).toContain("Tag");
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
        siteId,
      });

      // The junk is gone…
      expect(html).toContain('aria-sort="ascending"');
      // …and the status the reader actually chose survived it.
      expect(html).toContain(`/assets/${onOrderId}`);
      expect(html).not.toContain(inStockTag);
    });
  });

  // AM-07 / issue #8 — offset pagination.
  describe("pagination", () => {
    // Deliberately more than two pages hold: page 2 is then the only page with
    // BOTH a previous and a next, which is what makes the "sorting resets the
    // page" assertion below non-vacuous. On a two-page register page 2's next
    // link is absent, so "no href carries page=" would pass whether or not
    // sortHref resets anything.
    const PAGE_SIZE = 50;
    const TRACKED = 105;
    const ON_ORDER = 3;
    const TOTAL = TRACKED + ON_ORDER; // 108 → three pages of 50/50/8

    let pagingCategoryId: string;
    let tagPrefix: string;
    /** Tags 0001…0108, which is also the order `sort=tag&dir=asc` must produce. */
    let expectedTags: string[];

    beforeAll(async () => {
      const category = await db.category.create({
        data: { name: `Paging ${randomUUID()}` },
      });
      pagingCategoryId = category.id;

      // A prefix unique to this run. The test database is never truncated —
      // it held 4,771 assets when this was written — so every assertion here
      // is scoped to rows this block created rather than to the table.
      tagPrefix = `PAGE-${randomUUID().slice(0, 8)}`;
      expectedTags = Array.from(
        { length: TOTAL },
        (_, i) => `${tagPrefix}-${String(i + 1).padStart(4, "0")}`,
      );

      await db.asset.createMany({
        data: expectedTags.map((tag, i) => ({
          categoryId: pagingCategoryId,
          make: "Paging",
          model: `Row ${i + 1}`,
          tag,
          // The last three are ON_ORDER so the count-parity test below has a
          // status filter that genuinely narrows the set. Zero-padded tags mean
          // lexicographic order is numeric order, so the default `tag asc` sort
          // is fully determined.
          status: i < TRACKED ? AssetStatus.IN_STOCK : AssetStatus.ON_ORDER,
        })),
      });
    });

    /**
     * The fixture tags present in a render, in document order, deduped.
     *
     * Each asset is drawn twice — once in the table, once in the card list —
     * and the table comes first, so first-occurrence order is row order.
     */
    const tagsIn = (html: string) => [
      ...new Set(html.match(new RegExp(`${tagPrefix}-\\d{4}`, "g")) ?? []),
    ];

    it("continues page 2 where page 1 stopped, with no gap and no repeat", async () => {
      await signInAs(Role.FINANCE);

      const pages: string[][] = [];
      for (const page of ["1", "2", "3"]) {
        const html = await renderRegister({
          categoryId: pagingCategoryId,
          page,
        });
        pages.push(tagsIn(html));
      }

      // The AC, stated first so it is the assertion that reports: page 2
      // starts at the row after page 1's last.
      expect(pages[0].at(-1)).toBe(expectedTags[PAGE_SIZE - 1]);
      expect(pages[1][0]).toBe(expectedTags[PAGE_SIZE]);
      expect(pages[1].at(-1)).toBe(expectedTags[PAGE_SIZE * 2 - 1]);
      expect(pages[2][0]).toBe(expectedTags[PAGE_SIZE * 2]);

      // …and the three pages together are exactly the register, once each.
      // An off-by-one in `skip` shows up as a gap or a duplicate here even if
      // every boundary assertion above were somehow satisfied.
      const seen = pages.flat();
      expect(seen).toEqual(expectedTags);
      expect(new Set(seen).size).toBe(TOTAL);

      // Each page full until the last one. Last, because it is the weakest of
      // these and would otherwise short-circuit the ones that matter.
      expect(pages.map((p) => p.length)).toEqual([PAGE_SIZE, PAGE_SIZE, 8]);
    });

    it("counts the rows the table is actually showing, not the ones beside them", async () => {
      await signInAs(Role.FINANCE);

      // The count-query-parity trap. The estate bar counts against
      // `scopeFilters` (category only, ignoring status) ON PURPOSE, and that
      // is the number the header renders. The FOOTER's total must come from
      // the data query's own WHERE — category AND status.
      //
      // 105 of the 108 are IN_STOCK. A footer reading "of 108" here means the
      // count was computed against the estate clause instead, and every
      // paginated range on the page is then a lie that reviews cleanly because
      // both halves look right on their own.
      const html = await renderRegister({
        categoryId: pagingCategoryId,
        status: AssetStatus.IN_STOCK,
      });

      expect(html).toContain(`1–${PAGE_SIZE} of ${TRACKED} assets`);
      expect(html).not.toContain(`of ${TOTAL} assets`);
      // The header still says what that number is a subset OF, which is the
      // asymmetry the estate bar exists for.
      expect(html).toContain(`${TRACKED} of ${TOTAL}`);
    });

    it("states the range and the total, and pages the last page correctly", async () => {
      await signInAs(Role.FINANCE);

      const first = await renderRegister({ categoryId: pagingCategoryId });
      expect(first).toContain(`1–${PAGE_SIZE} of ${TOTAL} assets`);
      expect(first).toContain("Page 1 of 3");

      const last = await renderRegister({
        categoryId: pagingCategoryId,
        page: "3",
      });
      // 101–108, not 101–150: the range end is the rows actually drawn.
      expect(last).toContain(
        `${PAGE_SIZE * 2 + 1}–${TOTAL} of ${TOTAL} assets`,
      );
      expect(last).toContain("Page 3 of 3");
    });

    it("says '1 asset', never '1 assets'", async () => {
      await signInAs(Role.FINANCE);

      // A single-row register is reachable in production — a new site, or a
      // category narrowed all the way down — and it is the case a template
      // string gets wrong. `otherCategoryId` holds exactly the one ON_ORDER
      // fixture.
      const single = await renderRegister({ categoryId: otherCategoryId });
      expect(single).toContain("1 asset");
      expect(single).not.toContain("1 assets");
      // One page, so the pager states the total without a range or controls.
      expect(single).not.toContain("Page 1 of");
    });

    it("renders page 1 for an out-of-range page rather than an empty table", async () => {
      await signInAs(Role.FINANCE);

      // A stale bookmark, or a hand-edited link. Clamping happens after the
      // count because the last page is not knowable before it.
      const html = await renderRegister({
        categoryId: pagingCategoryId,
        page: "999",
      });

      expect(tagsIn(html)).toEqual(expectedTags.slice(0, PAGE_SIZE));
      expect(html).toContain(`1–${PAGE_SIZE} of ${TOTAL} assets`);
      expect(html).toContain("Page 1 of 3");
      expect(html).not.toContain("No assets match");
    });

    it("renders page 1 for a malformed page rather than a 500", async () => {
      await signInAs(Role.STAFF_RO);

      // Zero and negatives would make `skip` negative; a fraction would make it
      // non-integer; an array is what a repeated param arrives as. Each falls
      // back on its own, and the category beside it survives — the per-field
      // `.catch`, not one all-or-nothing safeParse over the object.
      const malformed: (string | string[])[] = [
        "0",
        "-3",
        "2.7",
        "abc",
        "",
        ["1", "2"],
      ];
      for (const page of malformed) {
        const html = await renderRegister({
          categoryId: pagingCategoryId,
          page,
        });
        expect(tagsIn(html)).toEqual(expectedTags.slice(0, PAGE_SIZE));
      }
    });

    it("resets to page 1 when the sort or the status changes", async () => {
      await signInAs(Role.FINANCE);

      // Page 2 of three: it has a previous AND a next, so `page=` genuinely
      // appears in this markup and the assertion below can fail.
      const html = await renderRegister({
        categoryId: pagingCategoryId,
        page: "2",
      });
      expect(html).toContain("Page 2 of 3");

      // Every link that changes WHAT you are looking at — the five estate-bar
      // chips, the five sortable column headers — must drop the page, because
      // page 2 of the old set is a different set of rows in the new one and is
      // often past its end. The pager is the only control that may carry it,
      // and on page 2 the only page it needs to name is 3 (previous is page 1,
      // which is the absence of the param).
      const paged = [...html.matchAll(/href="([^"]*page=[^"]*)"/g)].map(
        (m) => m[1],
      );
      expect(paged).toEqual([
        `/assets?categoryId=${pagingCategoryId}&amp;page=3`,
      ]);

      // The filter form submits its fields and nothing else, so the absence of
      // a hidden page input IS the reset. A hidden input here would carry page
      // 2 into a freshly chosen category.
      expect(html).not.toContain('name="page"');
    });

    it("keeps the filter and the sort when paging", async () => {
      await signInAs(Role.FINANCE);

      // The mirror of the test above: moving WITHIN a view must preserve it.
      // A pager that rebuilt the query string from scratch would drop the
      // reader out of their filter on the first click.
      const html = await renderRegister({
        categoryId: pagingCategoryId,
        status: AssetStatus.IN_STOCK,
        sort: "item",
        dir: "desc",
        page: "2",
      });

      expect(html).toContain(
        `href="/assets?status=IN_STOCK&amp;categoryId=${pagingCategoryId}&amp;sort=item&amp;dir=desc&amp;page=3"`,
      );
      // Previous goes to page 1, which is the bare view — page 1 is the
      // absence of the param, so a paginated link never says page=1.
      expect(html).toContain(
        `href="/assets?status=IN_STOCK&amp;categoryId=${pagingCategoryId}&amp;sort=item&amp;dir=desc"`,
      );
    });

    it("fetches holders for the rendered page only, and none at all for STAFF_RO", async () => {
      // The holder query is scoped by the ids of the rows it just fetched, so
      // pagination made it page-sized for free. This asserts it stayed that
      // way — and that the STAFF_RO branch, which fetches no person data at
      // all (CLAUDE.md), is untouched by any of it.
      await signInAs(Role.STAFF_RO);
      const staff = await renderRegister({ siteId });
      expect(staff).toContain(assignedTag);
      expect(staff).not.toContain("Held by");
      expect(staff).not.toContain(holderName);

      await signInAs(Role.ADMIN_IT);
      const admin = await renderRegister({ siteId });
      expect(admin).toContain("Held by");
      expect(admin).toContain(holderName);
    });
  });
});
