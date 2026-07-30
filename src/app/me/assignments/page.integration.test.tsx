// @vitest-environment node
//
// AM-03 PLAN.md task 6: the self-scoped route (DESIGN §5.1, advisor condition
// 10). All four roles reach it; each of them sees their OWN assignments and
// nothing else; a user with no linked Person gets an empty state rather than a
// 500.
//
// The "only their own" assertion is falsifiable by construction: four holders
// exist in the database at once, so a query that lost its `personId` filter
// would put the other three tags on the page and fail here.
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
import MyAssignmentsPage from "@/app/me/assignments/page";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const mockAuth = auth as unknown as Mock;

type Holder = { role: Role; userId: string; tag: string };

describe.skipIf(!testDatabaseUrl)("my assignments (real DB)", () => {
  let db: PrismaClient;
  let categoryId: string;
  let holders: Holder[];
  let returnedTag: string;
  let unlinkedUserId: string;

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

    const category = await db.category.create({
      data: { name: `My assignments ${randomUUID()}` },
    });
    categoryId = category.id;

    // One holder per role, each holding a distinctly tagged asset. Assignment
    // rows are created directly — this file tests the READ view; the write path
    // has its own real-DB suite (src/lib/assignment.integration.test.ts).
    holders = [];
    for (const role of [
      Role.ADMIN_IT,
      Role.PROCUREMENT,
      Role.FINANCE,
      Role.STAFF_RO,
    ]) {
      const person = await db.person.create({
        data: {
          name: `Holder ${role}`,
          email: `mine-person-${randomUUID()}@example.com`,
        },
      });
      const user = await db.user.create({
        data: {
          email: `mine-user-${randomUUID()}@example.com`,
          name: `Holder ${role}`,
          role,
          personId: person.id,
        },
      });
      const tag = `MINE-${role}-${randomUUID().slice(0, 8)}`;
      const asset = await db.asset.create({
        data: {
          categoryId,
          make: "Dell",
          model: "Latitude 5450",
          tag,
          status: AssetStatus.ASSIGNED,
        },
      });
      await db.assignment.create({
        data: {
          assetId: asset.id,
          personId: person.id,
          checkedOutAt: new Date("2026-06-02T08:00:00.000Z"),
        },
      });
      holders.push({ role, userId: user.id, tag });
    }

    // A returned asset for the first holder, so the past list is non-empty.
    returnedTag = `MINE-BACK-${randomUUID().slice(0, 8)}`;
    const returnedAsset = await db.asset.create({
      data: {
        categoryId,
        make: "Lenovo",
        model: "ThinkPad T14",
        tag: returnedTag,
        status: AssetStatus.IN_STOCK,
      },
    });
    const firstHolder = await db.user.findUniqueOrThrow({
      where: { id: holders[0].userId },
      select: { personId: true },
    });
    await db.assignment.create({
      data: {
        assetId: returnedAsset.id,
        personId: firstHolder.personId!,
        checkedOutAt: new Date("2026-04-01T08:00:00.000Z"),
        returnedAt: new Date("2026-05-01T16:00:00.000Z"),
      },
    });

    // A provisioned user with no linked Person — legitimate, not an error.
    const unlinked = await db.user.create({
      data: {
        email: `mine-unlinked-${randomUUID()}@example.com`,
        name: "Unlinked",
        role: Role.STAFF_RO,
      },
    });
    unlinkedUserId = unlinked.id;
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  async function renderAs(userId: string) {
    mockAuth.mockResolvedValue({ user: { id: userId } });
    return renderToStaticMarkup(await MyAssignmentsPage());
  }

  it("takes no request input at all", async () => {
    // Advisor condition 10, encoded so it cannot rot quietly: the page's scope
    // is derived from the session, and a `params`/`searchParams` prop appearing
    // on the signature is the shape of the IDOR this route exists to make
    // impossible. Adding one takes the arity to 1 and fails here.
    expect(MyAssignmentsPage.length).toBe(0);
  });

  for (const role of [
    Role.ADMIN_IT,
    Role.PROCUREMENT,
    Role.FINANCE,
    Role.STAFF_RO,
  ]) {
    it(`shows a ${role} holder their own assignments and only their own`, async () => {
      const holder = holders.find((candidate) => candidate.role === role)!;
      const html = await renderAs(holder.userId);

      expect(html).toContain(holder.tag);
      for (const other of holders.filter(
        (candidate) => candidate.role !== role,
      )) {
        expect(html).not.toContain(other.tag);
      }
    });
  }

  it("lists returned assignments alongside the ones still held", async () => {
    const html = await renderAs(holders[0].userId);

    expect(html).toContain(holders[0].tag);
    expect(html).toContain(returnedTag);
    expect(html).toContain("2026-05-01 16:00 UTC");
  });

  it("treats a user with no linked person as an empty state, not a 500", async () => {
    const html = await renderAs(unlinkedUserId);

    expect(html).toContain("not linked to a staff record");
    for (const holder of holders) {
      expect(html).not.toContain(holder.tag);
    }
  });
});
