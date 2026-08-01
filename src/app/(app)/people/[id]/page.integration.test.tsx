// @vitest-environment node
//
// AM-03 PLAN.md task 6: the per-person view's role gate and its PII field
// tiers (DESIGN §5.2, advisor conditions 8 and 12).
//
// THE FIELD-TIER ASSERTIONS ARE ON THE FETCHED DATA, not on rendered HTML: a
// rendered-HTML assertion passes just as well when the email was fetched and
// merely hidden, which is the exact failure mode DESIGN §5.2 exists to prevent
// ("enforced in the select, NEVER by rendering less in JSX"). The HTML checks
// that follow each one are the second half of the seam — they prove the page
// hands `requireRole`'s role to the fetch rather than a widened one.
//
// The ADMIN_IT case is the positive control. Without it, `not.toHaveProperty`
// would pass just as happily against a select that fetched nothing at all.
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
import PersonPage from "@/app/(app)/people/[id]/page";
import { fetchPersonView } from "@/app/(app)/people/[id]/person-view";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const mockAuth = auth as unknown as Mock;

describe.skipIf(!testDatabaseUrl)("person view (real DB)", () => {
  let db: PrismaClient;
  let categoryId: string;
  let personId: string;
  let personName: string;
  let personEmail: string;
  let personRef: string;
  let heldTag: string;
  let returnedTag: string;
  let leaverPersonId: string;
  let leaverDeactivatedAt: Date;
  let leaverHeldTag: string;

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
      data: { name: `Person view ${randomUUID()}` },
    });
    categoryId = category.id;

    personName = `Person View ${randomUUID().slice(0, 8)}`;
    personEmail = `personview-${randomUUID()}@example.com`;
    personRef = `PVREF-${randomUUID().slice(0, 8)}`;
    const person = await db.person.create({
      data: { name: personName, email: personEmail, employeeRef: personRef },
    });
    personId = person.id;

    // Assignment rows are created directly: this file tests the READ views.
    // The write path that maintains the status/assignment invariant has its own
    // real-DB suite (src/lib/assignment.integration.test.ts), so the fixture
    // sets the statuses the write path would have left behind.
    heldTag = `PV-HELD-${randomUUID().slice(0, 8)}`;
    returnedTag = `PV-BACK-${randomUUID().slice(0, 8)}`;
    const [held, returned] = await Promise.all([
      db.asset.create({
        data: {
          categoryId,
          make: "Dell",
          model: "Latitude 5450",
          tag: heldTag,
          status: AssetStatus.ASSIGNED,
        },
      }),
      db.asset.create({
        data: {
          categoryId,
          make: "Lenovo",
          model: "ThinkPad T14",
          tag: returnedTag,
          status: AssetStatus.IN_STOCK,
        },
      }),
    ]);
    await db.assignment.create({
      data: {
        assetId: held.id,
        personId,
        checkedOutAt: new Date("2026-06-01"),
      },
    });
    await db.assignment.create({
      data: {
        assetId: returned.id,
        personId,
        checkedOutAt: new Date("2026-04-01"),
        returnedAt: new Date("2026-05-01"),
        conditionNotes: "Scuffed lid",
      },
    });

    // A leaver: a person whose linked User has been deactivated. Their open
    // assignment is deliberately left open (AM-03-CF-2).
    const leaver = await db.person.create({
      data: {
        name: `Leaver ${randomUUID().slice(0, 8)}`,
        email: `pvleaver-${randomUUID()}@example.com`,
      },
    });
    leaverPersonId = leaver.id;
    leaverDeactivatedAt = new Date("2026-07-01T09:30:00.000Z");
    await db.user.create({
      data: {
        email: `pvleaver-user-${randomUUID()}@example.com`,
        name: "Leaver",
        role: Role.STAFF_RO,
        personId: leaver.id,
        deactivatedAt: leaverDeactivatedAt,
      },
    });

    // The scenario condition 12 actually exists for: a leaver STILL HOLDING
    // KIT. Review caught that the comment above claimed this and the fixture
    // did not create it, so the marker was tested but the situation it exists
    // to make visible — a deactivated person listed under "currently held" —
    // never rendered. Deliberately left open: AM-03-CF-2 rules that neither
    // blocking deactivation nor auto-returning is acceptable, so the register
    // showing it is the whole mitigation.
    const leaverAsset = await db.asset.create({
      data: {
        categoryId,
        make: "Lenovo",
        model: "ThinkPad X1",
        tag: `PV-LEAVER-${randomUUID().slice(0, 8)}`,
        status: AssetStatus.ASSIGNED,
      },
    });
    leaverHeldTag = leaverAsset.tag!;
    await db.assignment.create({
      data: {
        assetId: leaverAsset.id,
        personId: leaver.id,
        checkedOutAt: new Date("2026-05-15"),
      },
    });
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  async function signInAs(role: Role) {
    const user = await db.user.create({
      data: {
        email: `personview-viewer-${randomUUID()}@example.com`,
        name: "Person View Viewer",
        role,
      },
    });
    mockAuth.mockResolvedValue({ user: { id: user.id } });
    return user;
  }

  async function renderPerson(id: string) {
    return renderToStaticMarkup(
      await PersonPage({ params: Promise.resolve({ id }) }),
    );
  }

  it("rejects STAFF_RO", async () => {
    await signInAs(Role.STAFF_RO);
    // A read-only staff user sees no person's assignment data anywhere except
    // their own /me/assignments (DESIGN §2.1). They cannot reach this route at
    // all, so there is no fetched payload to tier.
    await expect(renderPerson(personId)).rejects.toThrow(AuthorizationError);
  });

  for (const role of [Role.ADMIN_IT, Role.PROCUREMENT, Role.FINANCE]) {
    it(`lets ${role} see what the person holds and has held`, async () => {
      await signInAs(role);
      const html = await renderPerson(personId);

      expect(html).toContain(personName);
      expect(html).toContain(heldTag);
      expect(html).toContain(returnedTag);
      expect(html).toContain("Scuffed lid");
    });
  }

  it("fetches the email for ADMIN_IT and no one else", async () => {
    // Positive control first: the tier assertions below are only meaningful if
    // the email is genuinely reachable for the role that is entitled to it.
    const adminView = await fetchPersonView(Role.ADMIN_IT, personId);
    expect(adminView?.person).toHaveProperty("email", personEmail);

    for (const role of [Role.PROCUREMENT, Role.FINANCE]) {
      const view = await fetchPersonView(role, personId);
      // Not "email is empty" — the key is absent because the column was never
      // selected and never left the database.
      expect(view?.person).not.toHaveProperty("email");
      // employeeRef IS theirs to see; asserting it here keeps the test from
      // passing by way of a select that fetched nothing.
      expect(view?.person).toHaveProperty("employeeRef", personRef);
    }
  });

  it("keeps the email out of the page a PROCUREMENT or FINANCE viewer renders", async () => {
    // The other half of the seam: the fetch is tiered by the role argument, and
    // this is what proves the page passes requireRole's role to it.
    await signInAs(Role.ADMIN_IT);
    expect(await renderPerson(personId)).toContain(personEmail);

    for (const role of [Role.PROCUREMENT, Role.FINANCE]) {
      await signInAs(role);
      const html = await renderPerson(personId);
      expect(html).not.toContain(personEmail);
      expect(html).toContain(personRef);
    }
  });

  it("splits open assignments from returned ones", async () => {
    const view = await fetchPersonView(Role.ADMIN_IT, personId);

    expect(view?.open.map((row) => row.asset.tag)).toEqual([heldTag]);
    expect(view?.past.map((row) => row.asset.tag)).toEqual([returnedTag]);
    expect(view?.open[0]?.returnedAt).toBeNull();
  });

  it("marks a person whose linked user was deactivated", async () => {
    const view = await fetchPersonView(Role.ADMIN_IT, leaverPersonId);
    expect(view?.deactivatedAt).toEqual(leaverDeactivatedAt);

    await signInAs(Role.ADMIN_IT);
    const html = await renderPerson(leaverPersonId);
    expect(html).toContain("deactivated on 2026-07-01 09:30 UTC");

    // …and an active person carries no marker, or the marker means nothing.
    const active = await fetchPersonView(Role.ADMIN_IT, personId);
    expect(active?.deactivatedAt).toBeNull();
    expect(await renderPerson(personId)).not.toContain("deactivated on");
  });

  it("still lists kit a leaver is holding, alongside the marker", async () => {
    // The situation the marker exists FOR. AM-03-CF-2 rules that deactivation
    // is never blocked on outstanding assets (that would break the AM-01
    // kill-switch) and that nothing auto-returns them (that would fabricate a
    // return). So this screen is the entire mitigation: if the open assignment
    // stopped being listed here, a leaver's laptop would become invisible with
    // no other detector.
    const view = await fetchPersonView(Role.ADMIN_IT, leaverPersonId);
    expect(view?.deactivatedAt).toEqual(leaverDeactivatedAt);
    expect(view?.open).toHaveLength(1);
    expect(view?.open[0]?.asset.tag).toBe(leaverHeldTag);

    await signInAs(Role.ADMIN_IT);
    const html = await renderPerson(leaverPersonId);
    expect(html).toContain("deactivated on");
    expect(html).toContain(leaverHeldTag);
  });

  it("404s an unknown person rather than throwing a 500", async () => {
    await signInAs(Role.ADMIN_IT);
    await expect(fetchPersonView(Role.ADMIN_IT, "not-a-real-id")).resolves.toBe(
      null,
    );

    const error = await renderPerson("not-a-real-id").catch(
      (thrown: unknown) => thrown,
    );
    expect((error as { digest?: string }).digest).toBe(
      "NEXT_HTTP_ERROR_FALLBACK;404",
    );
  });
});
