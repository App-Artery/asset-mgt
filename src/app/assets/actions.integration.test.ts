// @vitest-environment node
//
// PLAN.md §Verification: the write-role matrix on every asset action —
// ADMIN_IT/PROCUREMENT allowed, FINANCE/STAFF_RO denied — plus the boundary
// behaviour the friendly error messages promise. Session identity is mocked;
// the role read and every write are REAL DB. If any action loses its leading
// `await requireRole(...)`, the denial tests go red.
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  AssetEventType,
  AssetStatus,
  PrismaClient,
  Role,
} from "@prisma/client";
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
// Cache revalidation is Next.js request plumbing, not the seam under test.
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { auth } from "@/auth";
import { AuthorizationError } from "@/lib/authz";
import {
  createAsset,
  receiveAndTagAsset,
  retireAsset,
  returnFromRepair,
  sendToRepair,
  updateAsset,
} from "@/app/assets/actions";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const mockAuth = auth as unknown as Mock;

describe.skipIf(!testDatabaseUrl)("asset actions (real DB)", () => {
  let db: PrismaClient;
  let categoryId: string;

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
      data: { name: `Actions ${randomUUID()}` },
    });
    categoryId = category.id;
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  async function signInAs(role: Role) {
    const user = await db.user.create({
      data: {
        email: `assetactions-${randomUUID()}@example.com`,
        name: "Asset Actions Test",
        role,
      },
    });
    mockAuth.mockResolvedValue({ user: { id: user.id } });
    return user;
  }

  function formData(entries: Record<string, string>): FormData {
    const fd = new FormData();
    for (const [key, value] of Object.entries(entries)) {
      fd.set(key, value);
    }
    return fd;
  }

  const uniqueTag = () => `ACT-${randomUUID().slice(0, 12)}`;

  function createFields(overrides: Record<string, string> = {}) {
    return {
      tag: "",
      categoryId,
      make: "HP",
      model: "EliteBook 840",
      serial: "",
      purchasedAt: "",
      purchasePrice: "",
      supplier: "",
      warrantyUntil: "",
      condition: "",
      siteId: "",
      status: AssetStatus.ON_ORDER,
      ...overrides,
    };
  }

  /** An ON_ORDER asset owned by the currently signed-in actor's session. */
  async function anOrderedAsset() {
    const result = await createAsset(null, formData(createFields()));
    expect(result?.ok).toBe(true);
    const asset = await db.asset.findFirstOrThrow({
      orderBy: { createdAt: "desc" },
      where: { categoryId, status: AssetStatus.ON_ORDER, tag: null },
    });
    return asset;
  }

  const mutatingActions = [
    ["createAsset", createAsset],
    ["updateAsset", updateAsset],
    ["receiveAndTagAsset", receiveAndTagAsset],
    ["sendToRepair", sendToRepair],
    ["returnFromRepair", returnFromRepair],
    ["retireAsset", retireAsset],
  ] as const;

  for (const [name, action] of mutatingActions) {
    it(`${name} denies FINANCE and STAFF_RO server-side`, async () => {
      for (const role of [Role.FINANCE, Role.STAFF_RO]) {
        await signInAs(role);
        await expect(action(null, formData({}))).rejects.toThrow(
          AuthorizationError,
        );
      }
    });
  }

  it("lets both write roles create an asset with its CREATED event", async () => {
    for (const role of [Role.ADMIN_IT, Role.PROCUREMENT]) {
      const actor = await signInAs(role);
      const tag = uniqueTag();

      const result = await createAsset(
        null,
        formData(createFields({ tag, status: AssetStatus.IN_STOCK })),
      );

      expect(result).toMatchObject({ ok: true });
      const asset = await db.asset.findUniqueOrThrow({
        where: { tag },
        include: { events: true },
      });
      expect(asset.status).toBe(AssetStatus.IN_STOCK);
      expect(asset.events).toHaveLength(1);
      expect(asset.events[0]).toMatchObject({
        type: AssetEventType.CREATED,
        actorId: actor.id,
        toStatus: AssetStatus.IN_STOCK,
      });
    }
  });

  it("accepts a zero purchase price and pins dates to UTC midnight", async () => {
    await signInAs(Role.PROCUREMENT);
    const tag = uniqueTag();

    const result = await createAsset(
      null,
      formData(
        createFields({
          tag,
          status: AssetStatus.IN_STOCK,
          // 0 is a real price for donated kit — .positive() would reject it.
          purchasePrice: "0",
          purchasedAt: "2026-03-15",
        }),
      ),
    );

    expect(result).toMatchObject({ ok: true });
    const asset = await db.asset.findUniqueOrThrow({ where: { tag } });
    expect(asset.purchasePrice?.toString()).toBe("0");
    expect(asset.purchasedAt?.toISOString()).toBe("2026-03-15T00:00:00.000Z");
  });

  it("reports a duplicate tag as a form error, not a crash", async () => {
    await signInAs(Role.ADMIN_IT);
    const tag = uniqueTag();
    const fields = createFields({ tag, status: AssetStatus.IN_STOCK });

    await expect(createAsset(null, formData(fields))).resolves.toMatchObject({
      ok: true,
    });
    await expect(createAsset(null, formData(fields))).resolves.toMatchObject({
      ok: false,
      message: "An asset with that tag already exists.",
    });
    await expect(db.asset.count({ where: { tag } })).resolves.toBe(1);
  });

  it("refuses to receive an asset with no tag, then accepts one with a tag", async () => {
    await signInAs(Role.PROCUREMENT);
    const asset = await anOrderedAsset();

    await expect(
      receiveAndTagAsset(null, formData({ assetId: asset.id, tag: "" })),
    ).resolves.toMatchObject({
      ok: false,
      message: "A tag is required before this asset can move into stock.",
    });
    await expect(
      db.asset.findUniqueOrThrow({ where: { id: asset.id } }),
    ).resolves.toMatchObject({ status: AssetStatus.ON_ORDER, tag: null });

    const tag = uniqueTag();
    await expect(
      receiveAndTagAsset(
        null,
        formData({ assetId: asset.id, tag, notes: "Delivered" }),
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      db.asset.findUniqueOrThrow({ where: { id: asset.id } }),
    ).resolves.toMatchObject({ status: AssetStatus.IN_STOCK, tag });
  });

  it("reports an illegal transition as a form error, not a crash", async () => {
    await signInAs(Role.ADMIN_IT);
    const asset = await anOrderedAsset();

    // ON_ORDER has no repair edge — the asset has not been delivered yet.
    await expect(
      sendToRepair(null, formData({ assetId: asset.id })),
    ).resolves.toMatchObject({
      ok: false,
      message:
        "That status change isn't allowed from this asset's current status.",
    });
    await expect(
      db.assetEvent.count({
        where: { assetId: asset.id, type: AssetEventType.STATUS_CHANGED },
      }),
    ).resolves.toBe(0);
  });

  it("walks receive -> repair -> return -> retire through the actions", async () => {
    const actor = await signInAs(Role.ADMIN_IT);
    const asset = await anOrderedAsset();
    const tag = uniqueTag();

    await expect(
      receiveAndTagAsset(null, formData({ assetId: asset.id, tag })),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      sendToRepair(
        null,
        formData({
          assetId: asset.id,
          condition: "DEFECTIVE",
          notes: "Battery swelling",
        }),
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      returnFromRepair(
        null,
        formData({ assetId: asset.id, condition: "GOOD" }),
      ),
    ).resolves.toMatchObject({ ok: true });
    await expect(
      retireAsset(null, formData({ assetId: asset.id, notes: "End of life" })),
    ).resolves.toMatchObject({ ok: true });

    // RETIRED is the delete: the row and its whole history survive.
    const after = await db.asset.findUniqueOrThrow({
      where: { id: asset.id },
      include: { events: { orderBy: [{ at: "asc" }, { id: "asc" }] } },
    });
    expect(after.status).toBe(AssetStatus.RETIRED);
    expect(after.events.map((event) => event.toStatus)).toEqual([
      AssetStatus.ON_ORDER,
      AssetStatus.IN_STOCK,
      AssetStatus.IN_REPAIR,
      AssetStatus.IN_STOCK,
      AssetStatus.RETIRED,
    ]);
    expect(after.events.every((event) => event.actorId === actor.id)).toBe(
      true,
    );
  });

  it("edits fields without touching status and audits the change", async () => {
    await signInAs(Role.PROCUREMENT);
    const asset = await anOrderedAsset();

    const result = await updateAsset(
      null,
      formData({
        ...createFields({ make: "Lenovo", supplier: "Acme Ltd" }),
        assetId: asset.id,
      }),
    );

    expect(result).toMatchObject({ ok: true });
    const after = await db.asset.findUniqueOrThrow({
      where: { id: asset.id },
      include: { events: { where: { type: AssetEventType.UPDATED } } },
    });
    expect(after).toMatchObject({
      make: "Lenovo",
      supplier: "Acme Ltd",
      status: AssetStatus.ON_ORDER,
    });
    expect(after.events).toHaveLength(1);
    expect(after.events[0]?.notes).toContain("make");
  });

  it("rejects an incomplete create with a form error and writes nothing", async () => {
    await signInAs(Role.ADMIN_IT);
    const before = await db.asset.count();

    await expect(
      createAsset(null, formData(createFields({ make: "  " }))),
    ).resolves.toMatchObject({ ok: false });
    // A negative price is rejected too; 0 is not (see the zero-price test).
    await expect(
      createAsset(null, formData(createFields({ purchasePrice: "-1" }))),
    ).resolves.toMatchObject({ ok: false });

    await expect(db.asset.count()).resolves.toBe(before);
  });
});
