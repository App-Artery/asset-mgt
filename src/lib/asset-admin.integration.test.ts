// @vitest-environment node
//
// PLAN.md §Verification, real-DB items: AssetEvent atomicity, the lifecycle
// guard end-to-end, the tag-on-delivery rule, the CHECK constraint proven at
// the DB layer (not just through the app guard), and the transition lock under
// two genuinely concurrent transactions. Mocks cannot guard any of these seams.
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  AssetCondition,
  AssetEventType,
  AssetStatus,
  PrismaClient,
  Role,
} from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  TagRequiredError,
  createAssetWithEvent,
  transitionAssetStatus,
  updateAssetWithEvent,
} from "@/lib/asset-admin";
import { IllegalTransitionError } from "@/lib/asset-lifecycle";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)("asset-admin transactions (real DB)", () => {
  let db: PrismaClient;
  let categoryId: string;
  let actorId: string;

  beforeAll(async () => {
    execSync("pnpm exec prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: testDatabaseUrl },
      stdio: "inherit",
    });
    db = new PrismaClient({ datasourceUrl: testDatabaseUrl });
    const category = await db.category.create({
      data: { name: `Laptops ${randomUUID()}` },
    });
    categoryId = category.id;
    const actor = await db.user.create({
      data: {
        email: `assetadmin-${randomUUID()}@example.com`,
        name: "AssetAdmin Test",
        role: Role.PROCUREMENT,
      },
    });
    actorId = actor.id;
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  // The suite shares one database (fileParallelism: false); unique suffixes
  // keep tags and names from colliding across files and reruns.
  const uniqueTag = () => `TAG-${randomUUID().slice(0, 12)}`;

  function assetInput(
    overrides: Partial<Parameters<typeof createAssetWithEvent>[1]> = {},
  ) {
    return {
      tag: null,
      categoryId,
      make: "Dell",
      model: "Latitude 5450",
      description: null,
      serial: null,
      purchasedAt: null,
      purchasePrice: null,
      supplier: null,
      warrantyUntil: null,
      condition: null,
      siteId: null,
      poNumber: null,
      costCentre: null,
      department: null,
      location: null,
      status: AssetStatus.ON_ORDER,
      actorId,
      ...overrides,
    } satisfies Parameters<typeof createAssetWithEvent>[1];
  }

  function eventsFor(assetId: string) {
    // TIMESTAMP(3) can tie for events written milliseconds apart; cuid is
    // monotonic within a process, so it is the stable tie-breaker.
    return db.assetEvent.findMany({
      where: { assetId },
      orderBy: [{ at: "asc" }, { id: "asc" }],
    });
  }

  it("creates the asset and its CREATED event in one transaction", async () => {
    const asset = await createAssetWithEvent(db, assetInput());

    expect(asset.status).toBe(AssetStatus.ON_ORDER);
    const events = await eventsFor(asset.id);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: AssetEventType.CREATED,
      actorId,
      fromStatus: null,
      toStatus: AssetStatus.ON_ORDER,
    });
  });

  it("rolls back the asset when the audit insert fails (atomicity)", async () => {
    const tag = uniqueTag();

    // A nonexistent actor violates the AssetEvent.actorId FK — and only at the
    // audit INSERT, which runs after the asset INSERT inside the same
    // transaction. If the event insert ever moves outside the transaction, the
    // asset survives and this test goes red.
    await expect(
      createAssetWithEvent(
        db,
        assetInput({
          tag,
          status: AssetStatus.IN_STOCK,
          actorId: `nonexistent-${randomUUID()}`,
        }),
      ),
    ).rejects.toThrow();

    await expect(db.asset.findUnique({ where: { tag } })).resolves.toBeNull();
    await expect(
      db.assetEvent.count({ where: { asset: { tag } } }),
    ).resolves.toBe(0);
  });

  it("rejects creating an asset in a status the lifecycle does not start from", async () => {
    await expect(
      createAssetWithEvent(
        db,
        // @ts-expect-error — the input type forbids this; the runtime guard is
        // the defence for callers that skip typechecking.
        assetInput({ tag: uniqueTag(), status: AssetStatus.IN_REPAIR }),
      ),
    ).rejects.toThrow(/may only be created in/);
  });

  it("rejects creating an IN_STOCK asset with no tag", async () => {
    await expect(
      createAssetWithEvent(db, assetInput({ status: AssetStatus.IN_STOCK })),
    ).rejects.toThrow(TagRequiredError);
  });

  it("rejects a duplicate tag (P2002) but lets untagged ON_ORDER assets coexist", async () => {
    const tag = uniqueTag();
    await createAssetWithEvent(
      db,
      assetInput({ tag, status: AssetStatus.IN_STOCK }),
    );

    await expect(
      createAssetWithEvent(
        db,
        assetInput({ tag, status: AssetStatus.IN_STOCK }),
      ),
    ).rejects.toMatchObject({ code: "P2002" });

    // Two tagless ON_ORDER assets: NULL is not equal to NULL in a unique
    // index, so ordering two of the same thing is not a conflict.
    const first = await createAssetWithEvent(db, assetInput());
    const second = await createAssetWithEvent(db, assetInput());
    expect(first.tag).toBeNull();
    expect(second.tag).toBeNull();
    expect(first.id).not.toBe(second.id);
  });

  /**
   * The "row is not there" branches.
   *
   * WHY THIS BLOCK EXISTS: mutation testing (issue #12) found that
   * `if (!row)`, `if (!current)` and `if (!person)` could each be replaced with
   * `if (false)` — and their messages emptied — with the suite staying green.
   * Nothing called any of these with an id that does not exist, so the failure
   * mode being defended (a caller proceeding against a row it never read, then
   * failing later with a Prisma error naming a different table) was undefended
   * by demonstration.
   */
  describe("rejects an id that does not resolve", () => {
    const missingId = () => `missing-${randomUUID()}`;

    it("names the asset when the transition target does not exist", async () => {
      await expect(
        transitionAssetStatus(db, {
          assetId: missingId(),
          toStatus: AssetStatus.IN_STOCK,
          tag: uniqueTag(),
          actorId,
        }),
      ).rejects.toThrow(/Asset .* not found/);
    });

    it("names the asset when the edit target does not exist", async () => {
      await expect(
        updateAssetWithEvent(db, {
          assetId: missingId(),
          tag: uniqueTag(),
          categoryId,
          make: "Dell",
          model: "Latitude 5450",
          description: null,
          serial: null,
          purchasedAt: null,
          purchasePrice: null,
          supplier: null,
          warrantyUntil: null,
          condition: null,
          siteId: null,
          poNumber: null,
          costCentre: null,
          department: null,
          location: null,
          actorId,
        }),
      ).rejects.toThrow(/Asset .* not found/);
    });
  });

  describe("transitionAssetStatus", () => {
    it("rejects ON_ORDER -> ASSIGNED", async () => {
      const asset = await createAssetWithEvent(db, assetInput());
      await expect(
        transitionAssetStatus(db, {
          assetId: asset.id,
          toStatus: AssetStatus.ASSIGNED,
          actorId,
        }),
      ).rejects.toThrow(IllegalTransitionError);
      await expect(
        db.assetEvent.count({
          where: { assetId: asset.id, type: AssetEventType.STATUS_CHANGED },
        }),
      ).resolves.toBe(0);
    });

    it("rejects RETIRED -> IN_STOCK (terminal)", async () => {
      const asset = await createAssetWithEvent(db, assetInput());
      await transitionAssetStatus(db, {
        assetId: asset.id,
        toStatus: AssetStatus.RETIRED,
        actorId,
      });

      await expect(
        transitionAssetStatus(db, {
          assetId: asset.id,
          toStatus: AssetStatus.IN_STOCK,
          tag: uniqueTag(),
          actorId,
        }),
      ).rejects.toThrow(IllegalTransitionError);
      const after = await db.asset.findUniqueOrThrow({
        where: { id: asset.id },
      });
      expect(after.status).toBe(AssetStatus.RETIRED);
    });

    it("rejects a self-transition rather than treating it as a no-op", async () => {
      const asset = await createAssetWithEvent(
        db,
        assetInput({ tag: uniqueTag(), status: AssetStatus.IN_STOCK }),
      );
      await expect(
        transitionAssetStatus(db, {
          assetId: asset.id,
          toStatus: AssetStatus.IN_STOCK,
          actorId,
        }),
      ).rejects.toThrow(IllegalTransitionError);
      await expect(
        db.assetEvent.count({
          where: { assetId: asset.id, type: AssetEventType.STATUS_CHANGED },
        }),
      ).resolves.toBe(0);
    });

    it("refuses ON_ORDER -> IN_STOCK without a tag, accepts it with one", async () => {
      const asset = await createAssetWithEvent(db, assetInput());

      await expect(
        transitionAssetStatus(db, {
          assetId: asset.id,
          toStatus: AssetStatus.IN_STOCK,
          actorId,
        }),
      ).rejects.toThrow(TagRequiredError);
      // A blank tag is not a tag.
      await expect(
        transitionAssetStatus(db, {
          assetId: asset.id,
          toStatus: AssetStatus.IN_STOCK,
          tag: "   ",
          actorId,
        }),
      ).rejects.toThrow(TagRequiredError);
      await expect(
        db.asset.findUniqueOrThrow({ where: { id: asset.id } }),
      ).resolves.toMatchObject({ status: AssetStatus.ON_ORDER, tag: null });

      const tag = uniqueTag();
      const received = await transitionAssetStatus(db, {
        assetId: asset.id,
        toStatus: AssetStatus.IN_STOCK,
        tag: ` ${tag} `,
        notes: "Delivered by supplier",
        actorId,
      });

      expect(received).toMatchObject({
        status: AssetStatus.IN_STOCK,
        tag,
      });
      const events = await eventsFor(asset.id);
      expect(events).toHaveLength(2);
      expect(events[1]).toMatchObject({
        type: AssetEventType.STATUS_CHANGED,
        fromStatus: AssetStatus.ON_ORDER,
        toStatus: AssetStatus.IN_STOCK,
        notes: "Delivered by supplier",
        actorId,
      });
    });

    it("holds the guard under two concurrent transitions on the same asset", async () => {
      const asset = await createAssetWithEvent(db, assetInput());

      // Two REAL concurrent transactions, each receiving the same ON_ORDER
      // asset with a DIFFERENT tag (the same tag would collide on the unique
      // index and mask a missing lock behind a P2002).
      //
      // The afterGuard barrier parks T1 AFTER lockAsset + assertTransition and
      // BEFORE its write, so T2 provably runs inside the race window. With the
      // FOR UPDATE lock, T2 blocks on lockAsset until T1 commits, re-reads
      // IN_STOCK, and its IN_STOCK -> IN_STOCK self-transition is rejected.
      // Drop the lock and both read ON_ORDER, both pass the guard, and the
      // history records two deliveries of one asset — these assertions go red.
      let t1PassedGuard!: () => void;
      const t1GuardRead = new Promise<void>((resolve) => {
        t1PassedGuard = resolve;
      });
      let releaseT1!: () => void;
      const t1Hold = new Promise<void>((resolve) => {
        releaseT1 = resolve;
      });

      const receiveA = transitionAssetStatus(
        db,
        {
          assetId: asset.id,
          toStatus: AssetStatus.IN_STOCK,
          tag: uniqueTag(),
          actorId,
        },
        {
          afterGuard: async () => {
            t1PassedGuard();
            await t1Hold;
          },
        },
      );
      await t1GuardRead;

      const receiveB = transitionAssetStatus(db, {
        assetId: asset.id,
        toStatus: AssetStatus.IN_STOCK,
        tag: uniqueTag(),
        actorId,
      });
      // Give T2 real time to reach (and block on) the row lock — or, without
      // the lock, to sail through and commit inside the window.
      await new Promise((resolve) => setTimeout(resolve, 300));
      releaseT1();

      const results = await Promise.allSettled([receiveA, receiveB]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.filter((r) => r.status === "rejected");
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
        IllegalTransitionError,
      );

      await expect(
        db.assetEvent.count({
          where: { assetId: asset.id, type: AssetEventType.STATUS_CHANGED },
        }),
      ).resolves.toBe(1);
    });

    it("walks the full lifecycle and leaves a readable trail", async () => {
      const asset = await createAssetWithEvent(db, assetInput());
      const tag = uniqueTag();

      await transitionAssetStatus(db, {
        assetId: asset.id,
        toStatus: AssetStatus.IN_STOCK,
        tag,
        condition: AssetCondition.NEW,
        actorId,
      });
      await transitionAssetStatus(db, {
        assetId: asset.id,
        toStatus: AssetStatus.IN_REPAIR,
        condition: AssetCondition.DEFECTIVE,
        notes: "Screen flickering",
        actorId,
      });
      await transitionAssetStatus(db, {
        assetId: asset.id,
        toStatus: AssetStatus.IN_STOCK,
        condition: AssetCondition.GOOD,
        notes: "Panel replaced",
        actorId,
      });
      const retired = await transitionAssetStatus(db, {
        assetId: asset.id,
        toStatus: AssetStatus.RETIRED,
        notes: "End of life",
        actorId,
      });

      expect(retired).toMatchObject({
        status: AssetStatus.RETIRED,
        tag,
        condition: AssetCondition.GOOD,
      });
      const events = await eventsFor(asset.id);
      expect(
        events.map((event) => [event.type, event.fromStatus, event.toStatus]),
      ).toEqual([
        [AssetEventType.CREATED, null, AssetStatus.ON_ORDER],
        [
          AssetEventType.STATUS_CHANGED,
          AssetStatus.ON_ORDER,
          AssetStatus.IN_STOCK,
        ],
        [
          AssetEventType.STATUS_CHANGED,
          AssetStatus.IN_STOCK,
          AssetStatus.IN_REPAIR,
        ],
        [
          AssetEventType.STATUS_CHANGED,
          AssetStatus.IN_REPAIR,
          AssetStatus.IN_STOCK,
        ],
        [
          AssetEventType.STATUS_CHANGED,
          AssetStatus.IN_STOCK,
          AssetStatus.RETIRED,
        ],
      ]);
    });
  });

  // Raw SQL: no lifecycle module, no Prisma model layer, no application guard
  // in the path. If any of these succeeds, Asset_tag_required_when_tracked is
  // not doing the work and normaliseTag — application code — is the only thing
  // standing between the register and an untracked, untagged asset.
  //
  // All three blank forms, not just NULL. `'' IS NOT NULL` is true, so the
  // original `tag IS NOT NULL` form accepted '' and '   ' at the DB layer while
  // a NULL-only test read as proof of the whole invariant. That gap is also the
  // AM-04 trap: '' occupies the unique index, so the second blank-tagged import
  // row fails P2002 and reports "an asset with that tag already exists" for two
  // rows that both have no tag.
  describe.each([
    ["NULL", null],
    ["an empty string", ""],
    ["a whitespace-only string", "   "],
  ])("the CHECK constraint, bypassing the app entirely", (label, tagValue) => {
    it(`rejects a tracked status with ${label} as the tag`, async () => {
      const asset = await createAssetWithEvent(db, assetInput());

      await expect(
        db.$executeRawUnsafe(
          `UPDATE "Asset" SET "status" = 'IN_STOCK', "tag" = $2 WHERE "id" = $1`,
          asset.id,
          tagValue,
        ),
      ).rejects.toThrow(/Asset_tag_required_when_tracked/);

      await expect(
        db.asset.findUniqueOrThrow({ where: { id: asset.id } }),
      ).resolves.toMatchObject({ status: AssetStatus.ON_ORDER, tag: null });
    });
  });

  describe("updateAssetWithEvent", () => {
    it("writes UPDATED naming the changed fields", async () => {
      const asset = await createAssetWithEvent(db, assetInput());

      const updated = await updateAssetWithEvent(db, {
        ...assetInput(),
        assetId: asset.id,
        make: "Lenovo",
        model: "ThinkPad T14",
        supplier: "Acme Ltd",
        purchasePrice: 0,
        actorId,
      });

      expect(updated).toMatchObject({ make: "Lenovo", supplier: "Acme Ltd" });
      // 0 is a legitimate price (donated/written-down kit), not "unset".
      expect(updated.purchasePrice?.toString()).toBe("0");
      const events = await eventsFor(asset.id);
      expect(events).toHaveLength(2);
      expect(events[1]?.type).toBe(AssetEventType.UPDATED);
      expect(events[1]?.notes).toBe(
        "Changed: make, model, purchasePrice, supplier",
      );
      // Status is not editable through the edit path.
      expect(updated.status).toBe(AssetStatus.ON_ORDER);
    });

    it("writes no event for a no-op edit", async () => {
      const asset = await createAssetWithEvent(db, assetInput());

      await updateAssetWithEvent(db, {
        ...assetInput(),
        assetId: asset.id,
        actorId,
      });

      await expect(
        db.assetEvent.count({
          where: { assetId: asset.id, type: AssetEventType.UPDATED },
        }),
      ).resolves.toBe(0);
    });

    it("allows an ordinary edit of a tagged asset whose status requires a tag", async () => {
      // The other half of "refuses to strip the tag" below. Mutation testing
      // (issue #12) showed the `tag === null` half of that guard could be
      // replaced with `true` — rejecting EVERY edit of an in-stock asset — and
      // nothing went red, because no test edited a tag-requiring asset while
      // supplying its tag. A guard proven only in the direction it rejects is
      // half a guard.
      const tag = uniqueTag();
      const asset = await createAssetWithEvent(
        db,
        assetInput({ tag, status: AssetStatus.IN_STOCK }),
      );

      const updated = await updateAssetWithEvent(db, {
        ...assetInput({ tag }),
        assetId: asset.id,
        model: "ThinkPad X1",
        actorId,
      });

      expect(updated.model).toBe("ThinkPad X1");
      expect(updated.tag).toBe(tag);
      expect(updated.status).toBe(AssetStatus.IN_STOCK);
    });

    it("diffs Date, Decimal and null fields by value, not by identity", async () => {
      // WHY THIS TEST EXISTS: mutation testing (issue #12) found fifteen live
      // mutants inside the field-diff helper. The existing no-op test leaves
      // every non-scalar field null, so `null === null` short-circuits on the
      // first line and the Date and Decimal branches below it were never
      // reached by anything.
      //
      // What is actually at stake is audit integrity in both directions: a
      // helper that under-reports leaves a real edit with no UPDATED event, and
      // one that over-reports fills the history with events for edits that
      // never happened. Prisma hands back a `Date` object and a `Decimal` where
      // the caller passed a `Date` and a `number`, so identity comparison is
      // wrong for both.
      const purchasedAt = new Date("2024-01-15T09:30:00.000Z");
      const asset = await createAssetWithEvent(
        db,
        assetInput({
          serial: "SN-ORIGINAL",
          purchasedAt,
          purchasePrice: 100,
        }),
      );

      const unchanged = {
        ...assetInput({
          serial: "SN-ORIGINAL",
          // Fresh instances carrying the same value. `===` is false for both,
          // so this is the case that reaches the Date and Decimal branches.
          purchasedAt: new Date("2024-01-15T09:30:00.000Z"),
          purchasePrice: 100,
        }),
        assetId: asset.id,
        actorId,
      };
      await updateAssetWithEvent(db, unchanged);
      await expect(
        db.assetEvent.count({
          where: { assetId: asset.id, type: AssetEventType.UPDATED },
        }),
      ).resolves.toBe(0);

      // Half a second later — the same date to the second. `String(Date)` has
      // no sub-second resolution, so if the Date branch is skipped and the
      // string fallback answers instead, this edit vanishes from the history.
      await updateAssetWithEvent(db, {
        ...unchanged,
        purchasedAt: new Date("2024-01-15T09:30:00.500Z"),
      });
      let events = await eventsFor(asset.id);
      expect(events.at(-1)?.notes).toBe("Changed: purchasedAt");

      // Decimal vs number: exact through their string forms, not through `===`.
      await updateAssetWithEvent(db, {
        ...unchanged,
        purchasedAt: new Date("2024-01-15T09:30:00.500Z"),
        purchasePrice: 150,
      });
      events = await eventsFor(asset.id);
      expect(events.at(-1)?.notes).toBe("Changed: purchasePrice");

      // Value -> null and null -> value, the two directions the null guard
      // exists for.
      await updateAssetWithEvent(db, {
        ...unchanged,
        purchasedAt: new Date("2024-01-15T09:30:00.500Z"),
        purchasePrice: 150,
        serial: null,
      });
      events = await eventsFor(asset.id);
      expect(events.at(-1)?.notes).toBe("Changed: serial");

      await updateAssetWithEvent(db, {
        ...unchanged,
        purchasedAt: new Date("2024-01-15T09:30:00.500Z"),
        purchasePrice: 150,
        serial: "SN-REPLACED",
      });
      events = await eventsFor(asset.id);
      expect(events.at(-1)?.notes).toBe("Changed: serial");
    });

    it("refuses to strip the tag off an asset whose status requires one", async () => {
      const tag = uniqueTag();
      const asset = await createAssetWithEvent(
        db,
        assetInput({ tag, status: AssetStatus.IN_STOCK }),
      );

      await expect(
        updateAssetWithEvent(db, {
          ...assetInput(),
          tag: "",
          assetId: asset.id,
          actorId,
        }),
      ).rejects.toThrow(TagRequiredError);
      await expect(
        db.asset.findUniqueOrThrow({ where: { id: asset.id } }),
      ).resolves.toMatchObject({ tag });
    });
  });
});
