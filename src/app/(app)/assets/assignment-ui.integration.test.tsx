// @vitest-environment node
//
// PLAN.md task 5 / advisor conditions 9 and 11.
//
// THE assertion this file exists for: for a STAFF_RO viewer, the asset detail
// page and the register FETCH no assignment and no person data — not "fetch it
// and hide it". So the assertions are on the QUERIES AND THEIR RESULTS, never on
// the rendered HTML: rendered-HTML assertions pass just as well when the data is
// loaded and merely not printed, which is exactly the bug they would need to
// catch. Every Prisma model operation the page issues is recorded through a
// client extension and inspected.
//
// Real DB, not mocks: what is being asserted is which tables the page touches,
// and a mock returns the same canned rows whatever the query said.
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

// The page (and requireRole) read their client from here; handing them the
// recording client is what makes every query it issues observable.
vi.mock("@/lib/db", () => ({ getDb: () => recordingDb }));

import { auth } from "@/auth";
import { assignAsset } from "@/lib/asset-admin";
import AssetDetailPage from "./[id]/page";
import AssetsPage from "./page";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const mockAuth = auth as unknown as Mock;

type RecordedCall = {
  model: string | undefined;
  operation: string;
  args: unknown;
  result: unknown;
};

let calls: RecordedCall[] = [];
let recordingDb: PrismaClient;

describe.skipIf(!testDatabaseUrl)("asset assignment UI (real DB)", () => {
  let db: PrismaClient;
  let assignedAssetId: string;
  let stockAssetId: string;
  let assignedTag: string;
  let categoryId: string;
  const personName = `Holder ${randomUUID()}`;
  const personEmail = `holder-${randomUUID()}@example.com`;
  const personRef = `EMP-${randomUUID().slice(0, 8)}`;
  const actorEmail = `nameless-actor-${randomUUID()}@example.com`;

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
    recordingDb = db.$extends({
      query: {
        $allModels: {
          async $allOperations({ model, operation, args, query }) {
            const result = await query(args);
            calls.push({ model, operation, args, result });
            return result;
          },
        },
      },
    }) as unknown as PrismaClient;

    const category = await db.category.create({
      data: { name: `Assignment UI ${randomUUID()}` },
    });
    categoryId = category.id;
    const person = await db.person.create({
      data: { name: personName, email: personEmail, employeeRef: personRef },
    });
    // An actor with NO name: on main this is the account whose email leaked to
    // every staff user through `event.actor?.name ?? event.actor?.email`.
    const actor = await db.user.create({
      data: { email: actorEmail, role: Role.ADMIN_IT },
    });

    assignedTag = `ASG-${randomUUID().slice(0, 12)}`;
    const [assigned, stock] = await Promise.all([
      db.asset.create({
        data: {
          categoryId: category.id,
          make: "Assignment",
          model: "Held",
          tag: assignedTag,
          status: AssetStatus.IN_STOCK,
        },
      }),
      db.asset.create({
        data: {
          categoryId: category.id,
          make: "Assignment",
          model: "Stock",
          tag: `STK-${randomUUID().slice(0, 12)}`,
          status: AssetStatus.IN_STOCK,
        },
      }),
    ]);
    assignedAssetId = assigned.id;
    stockAssetId = stock.id;

    // Through the real write path, so the ASSIGNED event carries the nameless
    // actor exactly as production would write it.
    await assignAsset(db, {
      assetId: assignedAssetId,
      personId: person.id,
      actorId: actor.id,
    });
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  async function signInAs(role: Role) {
    const user = await db.user.create({
      data: {
        email: `viewer-${randomUUID()}@example.com`,
        name: "Viewer",
        role,
      },
    });
    mockAuth.mockResolvedValue({ user: { id: user.id } });
    return user;
  }

  /** Renders a page and returns everything it asked the database for. */
  async function record(element: Promise<React.ReactElement>) {
    calls = [];
    const html = renderToStaticMarkup(await element);
    const recorded = calls;
    return {
      html,
      models: recorded.map((call) => call.model),
      // Args only: proves the page never REQUESTED person-shaped data, which is
      // what catches a nested `include` that JSX happens not to render.
      requested: JSON.stringify(
        recorded.map(({ model, operation, args }) => ({
          model,
          operation,
          args,
        })),
      ),
      // Args and rows together: proves no person data came BACK either.
      payload: JSON.stringify(recorded),
    };
  }

  const renderDetail = (id: string) =>
    record(AssetDetailPage({ params: Promise.resolve({ id }) }));
  // Scoped to this file's own category. The register paginates at 50 rows
  // (AM-07), and this database is never truncated — so an unfiltered render
  // returns page 1 of thousands and the fixtures are not on it. That turned
  // the ADMIN_IT twin below red, which is the useful direction: had it been
  // the STAFF_RO assertions that stopped reaching their fixtures, they would
  // have gone on passing while proving nothing at all.
  const renderRegister = () =>
    record(AssetsPage({ searchParams: Promise.resolve({ categoryId }) }));

  describe("STAFF_RO", () => {
    it("fetches no assignment and no person data on the asset detail page", async () => {
      await signInAs(Role.STAFF_RO);

      const { html, models, requested, payload } =
        await renderDetail(assignedAssetId);

      // The tables are never touched…
      expect(models).not.toContain("Assignment");
      expect(models).not.toContain("Person");
      // …nor reached by a nested include, on any query the page made.
      expect(requested).not.toMatch(/assignment|person|actor/i);
      // …and nothing person-shaped came back.
      expect(payload).not.toContain(personName);
      expect(payload).not.toContain(personRef);
      expect(payload).not.toContain(personEmail);
      expect(payload).not.toContain(actorEmail);

      // The page still works: the asset and its status history render, with a
      // neutral label where a person would otherwise appear.
      expect(html).toContain(assignedTag);
      // The history's own Change cell, not the bare status label: "Assigned"
      // alone also appears in the Status field above, so asserting on it would
      // still pass if the history table vanished entirely. The arrow string is
      // rendered nowhere else. (AM-09 relabelled the event type from the raw
      // `ASSIGNED` this used to assert on.)
      expect(html).toContain("In stock → Assigned");
      expect(html).toContain(">IT<");
      expect(html).not.toContain(personName);
    });

    it("fetches no assignment and no person data on the register", async () => {
      await signInAs(Role.STAFF_RO);

      const { html, models, requested, payload } = await renderRegister();

      expect(models).not.toContain("Assignment");
      expect(models).not.toContain("Person");
      expect(requested).not.toMatch(/assignment|person/i);
      expect(payload).not.toContain(personName);
      expect(html).not.toContain("Held by");
      expect(html).not.toContain(personName);
    });
  });

  // The falsifiability twin. Without it, the assertions above would pass just as
  // well against a page that fetches nothing for anybody — including a page
  // whose holder feature is simply broken.
  describe("ADMIN_IT (proves the STAFF_RO assertions can fail)", () => {
    it("does fetch the holder and the holder history on the detail page", async () => {
      await signInAs(Role.ADMIN_IT);

      const { html, models, payload } = await renderDetail(assignedAssetId);

      expect(models).toContain("Assignment");
      expect(payload).toContain(personName);
      expect(payload).toContain(personRef);
      expect(html).toContain(personName);
      expect(html).toContain(personRef);
    });

    it("does fetch the holder on the register", async () => {
      await signInAs(Role.ADMIN_IT);

      const { html, models, payload } = await renderRegister();

      expect(models).toContain("Assignment");
      expect(payload).toContain(personName);
      expect(html).toContain("Held by");
      expect(html).toContain(personName);
    });
  });

  // Advisor condition 11: the actor's email is a tiered field like any other.
  describe("actor identity", () => {
    it("selects the actor's email for ADMIN_IT only", async () => {
      await signInAs(Role.ADMIN_IT);
      const admin = await renderDetail(assignedAssetId);
      expect(admin.payload).toContain(actorEmail);

      for (const role of [Role.PROCUREMENT, Role.FINANCE]) {
        await signInAs(role);
        const view = await renderDetail(assignedAssetId);
        // The history is still there — it just names no one. Asserted via the
        // Change cell for the same reason as the STAFF_RO case above: the bare
        // label is not unique to the history table.
        expect(view.html).toContain("In stock → Assigned");
        expect(view.payload).not.toContain(actorEmail);
        expect(view.html).not.toContain(actorEmail);
      }
    });

    it("shows a nameless actor as IT rather than as their email address", async () => {
      await signInAs(Role.FINANCE);

      const { html } = await renderDetail(assignedAssetId);

      expect(html).toContain(">IT<");
      expect(html).not.toContain(actorEmail);
    });
  });

  // AC 1: an ASSIGNED asset offers return (to stock OR to repair) and retire,
  // and NO separate "send to repair" — that move is the repair-bound return.
  describe("lifecycle moves offered", () => {
    it("offers assign, send to repair and retire on an IN_STOCK asset", async () => {
      await signInAs(Role.ADMIN_IT);

      const { html } = await renderDetail(stockAssetId);

      expect(html).toContain(">Assign<");
      expect(html).toContain(">Send to repair<");
      // AM-09: retire moved behind a confirm dialog, so the affordance is
      // its trigger rather than an inline form heading. The assertion still
      // says the same thing — this status offers retirement.
      expect(html).toContain(">Retire asset…<");
      expect(html).not.toContain(">Take it back<");
      // The picker disambiguates by employeeRef, and carries no email.
      expect(html).toContain(personRef);
      expect(html).not.toContain(personEmail);
    });

    it("offers return-to-stock, return-to-repair and retire on an ASSIGNED asset", async () => {
      await signInAs(Role.ADMIN_IT);

      const { html } = await renderDetail(assignedAssetId);

      expect(html).toContain(">Take it back<");
      expect(html).toContain(">Back to stock<");
      expect(html).toContain(">Straight to repair<");
      // AM-09: retire moved behind a confirm dialog, so the affordance is
      // its trigger rather than an inline form heading. The assertion still
      // says the same thing — this status offers retirement.
      expect(html).toContain(">Retire asset…<");
      // Not a second, parallel path out of ASSIGNED.
      expect(html).not.toContain(">Send to repair<");
      expect(html).not.toContain(">Assign<");
    });
  });
});
