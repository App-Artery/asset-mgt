// @vitest-environment node
//
// AM-03 PLAN.md §Verification, real-DB items: the partial unique index proven
// at the DB layer AND proven not to be a total unique index, the asset row lock
// proven under genuinely concurrent transactions, the one-event-per-action
// rule, the leaver guard, and the status<->assignment reconciliation invariant.
// Mocks cannot guard any of these seams.
//
// TWO OF THESE TESTS ARE TRAPS, and both are noted where they sit:
//   - "rejects the loser of a double-assign with IllegalTransitionError" would
//     STAY GREEN with the row lock deleted if it merely asserted that one side
//     failed, because the unique index catches the loser instead. That is
//     AM-01's race-passing-on-scheduling-luck failure in new clothing, with the
//     index as the thing doing the masking.
//   - "allows a second assignment after a return" is the falsifiability twin of
//     the index test. Without it, a mistakenly TOTAL unique index passes the
//     "cannot assign twice" test while making every asset permanently
//     unassignable after its first return.
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
  PersonNotAssignableError,
  assignAsset,
  createAssetWithEvent,
  returnAsset,
  transitionAssetStatus,
} from "@/lib/asset-admin";
import { IllegalTransitionError } from "@/lib/asset-lifecycle";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)("assignment and returns (real DB)", () => {
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
      data: { name: `Assignment laptops ${randomUUID()}` },
    });
    categoryId = category.id;
    const actor = await db.user.create({
      data: {
        email: `assignment-actor-${randomUUID()}@example.com`,
        name: "Assignment Test Actor",
        role: Role.ADMIN_IT,
      },
    });
    actorId = actor.id;
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  const uniqueTag = () => `ASG-${randomUUID().slice(0, 12)}`;

  /** An IN_STOCK, tagged asset — the only status an assignment may start from. */
  async function stockedAsset() {
    return createAssetWithEvent(db, {
      tag: uniqueTag(),
      categoryId,
      make: "Dell",
      model: "Latitude 5450",
      serial: null,
      purchasedAt: null,
      purchasePrice: null,
      supplier: null,
      warrantyUntil: null,
      condition: AssetCondition.NEW,
      siteId: null,
      status: AssetStatus.IN_STOCK,
      actorId,
    });
  }

  /** A person with no linked User — contractors and unbadged staff are real. */
  async function person(name = "Jane Holder") {
    return db.person.create({
      data: {
        name,
        email: `person-${randomUUID()}@example.com`,
        employeeRef: `EMP-${randomUUID().slice(0, 8)}`,
      },
    });
  }

  function eventsFor(assetId: string) {
    return db.assetEvent.findMany({
      where: { assetId },
      orderBy: [{ at: "asc" }, { id: "asc" }],
    });
  }

  function openAssignments(assetId: string) {
    return db.assignment.findMany({ where: { assetId, returnedAt: null } });
  }

  /** Shorthand for the arrange step of tests whose subject is the return path. */
  function assignAssetToPerson_(assetId: string, personId: string) {
    return assignAsset(db, { assetId, personId, actorId });
  }

  /**
   * Parks T1 inside the race window (after the guard reads, before any write)
   * and hands back a release. Without this the two transactions serialise on
   * timing luck and the test proves nothing — AM-01's headline lesson.
   */
  function barrier() {
    let passedGuard!: () => void;
    const reachedWindow = new Promise<void>((resolve) => {
      passedGuard = resolve;
    });
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    return {
      reachedWindow,
      release,
      hooks: {
        afterGuard: async () => {
          passedGuard();
          await held;
        },
      },
    };
  }

  /** Real time for T2 to reach and block on the row lock — or, without the
   *  lock, to sail through and commit inside the window. */
  const letT2Race = () => new Promise((resolve) => setTimeout(resolve, 300));

  it("assigns an asset and writes exactly one ASSIGNED event", async () => {
    const asset = await stockedAsset();
    const holder = await person();

    const assigned = await assignAsset(db, {
      assetId: asset.id,
      personId: holder.id,
      notes: "Onboarding kit",
      actorId,
    });

    expect(assigned.status).toBe(AssetStatus.ASSIGNED);
    const open = await openAssignments(asset.id);
    expect(open).toHaveLength(1);
    expect(open[0]?.personId).toBe(holder.id);

    const events = await eventsFor(asset.id);
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      type: AssetEventType.ASSIGNED,
      fromStatus: AssetStatus.IN_STOCK,
      toStatus: AssetStatus.ASSIGNED,
      assignmentId: open[0]?.id,
      notes: "Onboarding kit",
      actorId,
    });
    // The person link is a foreign key, never a name: no personal data is ever
    // written into this append-only table (CLAUDE.md).
    expect(events[1]?.notes).not.toContain(holder.name);
  });

  it("returns an asset to stock, closing the assignment with one RETURNED event", async () => {
    const asset = await stockedAsset();
    const holder = await person();
    await assignAsset(db, {
      assetId: asset.id,
      personId: holder.id,
      actorId,
    });

    const returned = await returnAsset(db, {
      assetId: asset.id,
      toStatus: AssetStatus.IN_STOCK,
      condition: AssetCondition.GOOD,
      conditionNotes: "Screen scuffed, works fine",
      actorId,
    });

    expect(returned).toMatchObject({
      status: AssetStatus.IN_STOCK,
      condition: AssetCondition.GOOD,
    });
    await expect(openAssignments(asset.id)).resolves.toHaveLength(0);

    const closed = await db.assignment.findFirstOrThrow({
      where: { assetId: asset.id },
    });
    expect(closed.returnedAt).not.toBeNull();
    expect(closed.conditionNotes).toBe("Screen scuffed, works fine");

    const events = await eventsFor(asset.id);
    expect(events).toHaveLength(3);
    expect(events[2]).toMatchObject({
      type: AssetEventType.RETURNED,
      fromStatus: AssetStatus.ASSIGNED,
      toStatus: AssetStatus.IN_STOCK,
      assignmentId: closed.id,
    });
  });

  it("sends an ASSIGNED asset to repair as a single RETURNED event", async () => {
    // AC-2's repair-bound return. On an assigned asset, sendToRepair IS the
    // return — not a second parallel path — so the history must show ONE event
    // carrying ASSIGNED -> IN_REPAIR, not a RETURNED plus a STATUS_CHANGED.
    const asset = await stockedAsset();
    const holder = await person();
    await assignAsset(db, { assetId: asset.id, personId: holder.id, actorId });

    await transitionAssetStatus(db, {
      assetId: asset.id,
      toStatus: AssetStatus.IN_REPAIR,
      condition: AssetCondition.DEFECTIVE,
      conditionNotes: "Won't charge",
      actorId,
    });

    await expect(openAssignments(asset.id)).resolves.toHaveLength(0);
    const events = await eventsFor(asset.id);
    expect(events).toHaveLength(3);
    expect(events[2]).toMatchObject({
      type: AssetEventType.RETURNED,
      fromStatus: AssetStatus.ASSIGNED,
      toStatus: AssetStatus.IN_REPAIR,
    });
    const closed = await db.assignment.findFirstOrThrow({
      where: { assetId: asset.id },
    });
    expect(closed.conditionNotes).toBe("Won't charge");
    expect(events[2]?.assignmentId).toBe(closed.id);
  });

  it("retires an ASSIGNED asset as a single RETURNED event, never two", async () => {
    const asset = await stockedAsset();
    const holder = await person();
    await assignAsset(db, { assetId: asset.id, personId: holder.id, actorId });

    await transitionAssetStatus(db, {
      assetId: asset.id,
      toStatus: AssetStatus.RETIRED,
      notes: "Stolen — police report filed",
      actorId,
    });

    await expect(openAssignments(asset.id)).resolves.toHaveLength(0);
    const events = await eventsFor(asset.id);
    // CREATED, ASSIGNED, RETURNED — and nothing else. A second STATUS_CHANGED
    // row here would force every reader to de-duplicate.
    expect(events.map((event) => event.type)).toEqual([
      AssetEventType.CREATED,
      AssetEventType.ASSIGNED,
      AssetEventType.RETURNED,
    ]);
    expect(events[2]).toMatchObject({
      fromStatus: AssetStatus.ASSIGNED,
      toStatus: AssetStatus.RETIRED,
    });
  });

  describe("the partial unique index", () => {
    it("rejects a second open assignment at the DB layer, app bypassed", async () => {
      const asset = await stockedAsset();
      const holder = await person();
      const other = await person("Other Holder");
      await assignAsset(db, {
        assetId: asset.id,
        personId: holder.id,
        actorId,
      });

      // Raw SQL, bypassing every application guard. If this only fails through
      // the app layer, the index is not doing the work the AC requires.
      //
      // Matched on `Code: \`23505\`` (unique_violation) rather than a bare
      // "23505" substring: Prisma echoes row values into its error messages, so
      // an unanchored numeric match can be satisfied by data rather than by the
      // failure mode — the same trap documented in src/lib/asset-errors.ts.
      // Postgres names the KEY here, not the index, so the index name is not
      // available to assert on.
      await expect(
        db.$executeRaw`
          INSERT INTO "Assignment" ("id", "assetId", "personId", "checkedOutAt", "createdAt", "updatedAt")
          VALUES (${randomUUID()}, ${asset.id}, ${other.id}, NOW(), NOW(), NOW())
        `,
      ).rejects.toThrow(/Code: `23505`/);

      // …and the rejection left the register untouched.
      await expect(openAssignments(asset.id)).resolves.toHaveLength(1);
    });

    it("allows a second assignment after a return", async () => {
      // THE FALSIFIABILITY TWIN. A total UNIQUE("assetId") — the obvious
      // "simplification" of the partial index — passes the test above while
      // making every asset permanently unassignable after its first return.
      // This is the test that goes red for that mistake.
      const asset = await stockedAsset();
      const first = await person("First Holder");
      const second = await person("Second Holder");

      await assignAsset(db, { assetId: asset.id, personId: first.id, actorId });
      await returnAsset(db, {
        assetId: asset.id,
        toStatus: AssetStatus.IN_STOCK,
        condition: AssetCondition.GOOD,
        actorId,
      });
      const reassigned = await assignAsset(db, {
        assetId: asset.id,
        personId: second.id,
        actorId,
      });

      expect(reassigned.status).toBe(AssetStatus.ASSIGNED);
      const open = await openAssignments(asset.id);
      expect(open).toHaveLength(1);
      expect(open[0]?.personId).toBe(second.id);
      await expect(
        db.assignment.count({ where: { assetId: asset.id } }),
      ).resolves.toBe(2);
    });

    it("rejects a return dated before its checkout", async () => {
      const asset = await stockedAsset();
      const holder = await person();
      await assignAsset(db, {
        assetId: asset.id,
        personId: holder.id,
        actorId,
      });
      const open = await db.assignment.findFirstOrThrow({
        where: { assetId: asset.id, returnedAt: null },
      });

      await expect(
        db.$executeRaw`
          UPDATE "Assignment" SET "returnedAt" = "checkedOutAt" - INTERVAL '1 day'
          WHERE "id" = ${open.id}
        `,
      ).rejects.toThrow(/Assignment_returned_after_checkout|violates/i);
    });
  });

  describe("the asset row lock", () => {
    it("serialises assign against a concurrent sendToRepair", async () => {
      // THE DESIGNATED LOCK PROOF. No unique index is involved on either side,
      // so nothing can mask a missing FOR UPDATE.
      //
      // WITH the lock: T2 blocks on lockAsset until T1 commits, re-reads
      // ASSIGNED, and its ASSIGNED -> IN_REPAIR transition closes the
      // assignment T1 just opened. Final state IN_REPAIR, zero open
      // assignments, events CREATED/ASSIGNED/RETURNED.
      //
      // WITHOUT the lock: both read IN_STOCK. T2 commits IN_STOCK ->
      // IN_REPAIR, then T1 commits IN_STOCK -> ASSIGNED over the top, leaving
      // the asset ASSIGNED with an open assignment even though it was sent for
      // repair — and an event whose fromStatus records a status the asset had
      // already left. Both assertions below go red.
      const asset = await stockedAsset();
      const holder = await person();
      const gate = barrier();

      const assigning = assignAsset(
        db,
        { assetId: asset.id, personId: holder.id, actorId },
        gate.hooks,
      );
      await gate.reachedWindow;

      const repairing = transitionAssetStatus(db, {
        assetId: asset.id,
        toStatus: AssetStatus.IN_REPAIR,
        condition: AssetCondition.DEFECTIVE,
        // Required once this lands on an ASSIGNED asset, which is the entire
        // point of the race: T2 starts believing the asset is IN_STOCK (where
        // no note is needed) and commits against ASSIGNED.
        conditionNotes: "Sent to repair mid-race",
        actorId,
      });
      await letT2Race();
      gate.release();

      const results = await Promise.allSettled([assigning, repairing]);
      expect(results.every((r) => r.status === "fulfilled")).toBe(true);

      const finalAsset = await db.asset.findUniqueOrThrow({
        where: { id: asset.id },
      });
      expect(finalAsset.status).toBe(AssetStatus.IN_REPAIR);
      await expect(openAssignments(asset.id)).resolves.toHaveLength(0);
      const events = await eventsFor(asset.id);
      expect(events.map((event) => event.type)).toEqual([
        AssetEventType.CREATED,
        AssetEventType.ASSIGNED,
        AssetEventType.RETURNED,
      ]);
    });

    it("rejects the loser of a double-assign with IllegalTransitionError", async () => {
      // THE TRAP. Asserting merely "one of them failed" stays GREEN with the
      // lock deleted, because the partial unique index rejects the loser with
      // P2002 instead. The error CLASS is what distinguishes a working lock
      // from an index quietly covering for a missing one:
      //   locked   -> T2 re-reads ASSIGNED, guard rejects ASSIGNED -> ASSIGNED
      //               => IllegalTransitionError
      //   unlocked -> both pass the guard, second INSERT hits the index
      //               => P2002
      const asset = await stockedAsset();
      const first = await person("Race First");
      const second = await person("Race Second");
      const gate = barrier();

      const assignA = assignAsset(
        db,
        { assetId: asset.id, personId: first.id, actorId },
        gate.hooks,
      );
      await gate.reachedWindow;

      const assignB = assignAsset(db, {
        assetId: asset.id,
        personId: second.id,
        actorId,
      });
      await letT2Race();
      gate.release();

      const results = await Promise.allSettled([assignA, assignB]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.filter((r) => r.status === "rejected");
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
        IllegalTransitionError,
      );

      await expect(openAssignments(asset.id)).resolves.toHaveLength(1);
      await expect(
        db.assetEvent.count({
          where: { assetId: asset.id, type: AssetEventType.ASSIGNED },
        }),
      ).resolves.toBe(1);
    });

    it("refuses to close an assignment a lock-bypassing writer already closed", async () => {
      // THE RED-PROOF FOR THE `count === 1` PREDICATE, which the lock tests do
      // NOT cover: review found that deleting the throw left the whole suite
      // green, because every other test exercises the LOCK's window, not this
      // one. A guard whose red-proof exercises a neighbouring window is not
      // proven at all.
      //
      // The window is reachable precisely because the lock is on the ASSET row
      // and this row is an ASSIGNMENT. A raw UPDATE takes no asset lock, so it
      // is not excluded by it — that is what raw SQL, a psql session, or any
      // future path writing Assignment directly looks like from in here.
      //
      // Delete the `count !== 1` throw and this goes red: the close silently
      // becomes a no-op, the transition commits, and the register records a
      // RETURNED event for a return this transaction never performed.
      const asset = await stockedAsset();
      const holder = await person("Bypass Victim");
      await assignAssetToPerson_(asset.id, holder.id);
      const open = await db.assignment.findFirstOrThrow({
        where: { assetId: asset.id, returnedAt: null },
        select: { id: true },
      });

      const returning = returnAsset(
        db,
        {
          assetId: asset.id,
          toStatus: AssetStatus.IN_STOCK,
          condition: AssetCondition.GOOD,
          conditionNotes: "the losing transaction's note",
          actorId,
        },
        {
          beforeCloseWrite: async () => {
            // Not blocked by the asset row lock: different table.
            await db.$executeRaw`
              UPDATE "Assignment"
              SET "returnedAt" = NOW(), "conditionNotes" = 'closed by a lock-bypassing writer'
              WHERE "id" = ${open.id}
            `;
          },
        },
      );

      await expect(returning).rejects.toThrow(/closed concurrently/i);

      // The bypassing writer's record stands; the transaction that lost rolled
      // back whole, so no RETURNED event was written for it.
      const assignment = await db.assignment.findUniqueOrThrow({
        where: { id: open.id },
      });
      expect(assignment.conditionNotes).toBe(
        "closed by a lock-bypassing writer",
      );
      await expect(
        db.assetEvent.count({
          where: { assetId: asset.id, type: AssetEventType.RETURNED },
        }),
      ).resolves.toBe(0);

      // This test has deliberately manufactured the desync the runbook exists
      // for: the raw close committed, the transaction rolled back, so the asset
      // still says ASSIGNED with no open assignment. Left alone it would fail
      // this file's reconciliation assertion — correctly, since that assertion
      // is exactly the detector for this state.
      //
      // Repaired the way the README prescribes: bring the STATUS back into line
      // with the assignment, never by reopening a closure that genuinely
      // happened. Doing it here rather than suppressing the detector keeps the
      // reconciliation assertion honest for every other test in this file.
      await db.asset.update({
        where: { id: asset.id },
        data: { status: AssetStatus.IN_STOCK },
      });
    });

    it("lets only one of two concurrent returns record the return", async () => {
      // A second return silently overwriting the first is audit corruption,
      // not a duplicate click: the first return's condition notes are the
      // record of what state the asset came back in.
      const asset = await stockedAsset();
      const holder = await person();
      await assignAsset(db, {
        assetId: asset.id,
        personId: holder.id,
        actorId,
      });
      const gate = barrier();

      const returnA = returnAsset(
        db,
        {
          assetId: asset.id,
          toStatus: AssetStatus.IN_STOCK,
          condition: AssetCondition.GOOD,
          conditionNotes: "FIRST return — this must survive",
          actorId,
        },
        gate.hooks,
      );
      await gate.reachedWindow;

      const returnB = returnAsset(db, {
        assetId: asset.id,
        toStatus: AssetStatus.IN_STOCK,
        condition: AssetCondition.POOR,
        conditionNotes: "SECOND return — must never overwrite",
        actorId,
      });
      await letT2Race();
      gate.release();

      const results = await Promise.allSettled([returnA, returnB]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);

      const assignment = await db.assignment.findFirstOrThrow({
        where: { assetId: asset.id },
      });
      expect(assignment.conditionNotes).toBe(
        "FIRST return — this must survive",
      );
      await expect(
        db.assetEvent.count({
          where: { assetId: asset.id, type: AssetEventType.RETURNED },
        }),
      ).resolves.toBe(1);
    });
  });

  describe("the leaver guard", () => {
    it("refuses to assign to a person whose account is deactivated", async () => {
      const asset = await stockedAsset();
      const leaver = await person("Departed Staffer");
      await db.user.create({
        data: {
          email: `leaver-${randomUUID()}@example.com`,
          name: "Departed Staffer",
          role: Role.STAFF_RO,
          personId: leaver.id,
          deactivatedAt: new Date(),
        },
      });

      await expect(
        assignAsset(db, {
          assetId: asset.id,
          personId: leaver.id,
          actorId,
        }),
      ).rejects.toBeInstanceOf(PersonNotAssignableError);

      // The rejection is inside the transaction: nothing partial survives.
      await expect(openAssignments(asset.id)).resolves.toHaveLength(0);
      const finalAsset = await db.asset.findUniqueOrThrow({
        where: { id: asset.id },
      });
      expect(finalAsset.status).toBe(AssetStatus.IN_STOCK);
    });

    it("assigns to a person with an active account", async () => {
      const asset = await stockedAsset();
      const staff = await person("Active Staffer");
      await db.user.create({
        data: {
          email: `active-${randomUUID()}@example.com`,
          name: "Active Staffer",
          role: Role.STAFF_RO,
          personId: staff.id,
        },
      });

      const assigned = await assignAsset(db, {
        assetId: asset.id,
        personId: staff.id,
        actorId,
      });
      expect(assigned.status).toBe(AssetStatus.ASSIGNED);
    });

    it("assigns to a person with no user account at all", async () => {
      // Contractors and staff without logins are real, and the narrow rule is
      // "linked AND deactivated" — not "has no account".
      const asset = await stockedAsset();
      const contractor = await person("Contractor No Login");

      const assigned = await assignAsset(db, {
        assetId: asset.id,
        personId: contractor.id,
        actorId,
      });
      expect(assigned.status).toBe(AssetStatus.ASSIGNED);
    });
  });

  it("reconciles status against open assignments in both directions", async () => {
    // The invariant SQL cannot enforce (a CHECK cannot cross tables). This is
    // the detection mechanism, and the README runbook carries the same query
    // unscoped for operational use.
    //
    // SCOPED TO THIS FILE'S CATEGORY, deliberately. The runbook query is global
    // because production has one consistent register; this test database does
    // not. It is shared (fileParallelism: false, no truncation between files),
    // and asset-errors.integration.test.ts creates an Assignment directly
    // WITHOUT a status change — it has to, because provoking a real unique-index
    // violation is the only way to pin the P2002 discriminator. That row is a
    // deliberately stranded open assignment, and a global assertion here reads
    // it as a failure of code that never touched it.
    //
    // Scoping keeps the assertion about what THIS file's operations leave
    // behind. It is still meaningful: every path exercised above — assign,
    // return, repair-bound return, retire-while-assigned, and all four
    // concurrency races — runs against assets in this category.
    const strandedAssigned = await db.$queryRaw<{ id: string }[]>`
      SELECT a."id" FROM "Asset" a
      WHERE a."categoryId" = ${categoryId}
        AND a."status" = 'ASSIGNED'
        AND NOT EXISTS (
          SELECT 1 FROM "Assignment" x
          WHERE x."assetId" = a."id" AND x."returnedAt" IS NULL
        )
    `;
    expect(strandedAssigned).toEqual([]);

    const strandedOpen = await db.$queryRaw<{ id: string }[]>`
      SELECT x."id" FROM "Assignment" x
      JOIN "Asset" a ON a."id" = x."assetId"
      WHERE a."categoryId" = ${categoryId}
        AND x."returnedAt" IS NULL
        AND a."status" <> 'ASSIGNED'
    `;
    expect(strandedOpen).toEqual([]);

    // Guard the premise: a scope that selected nothing would make both
    // assertions pass unconditionally (LEARNINGS §Testing, vacuous tests).
    // BOTH candidate sets need guarding, not just one — the first query ranges
    // over ASSIGNED assets and the second over open assignments, so proving
    // only that assignments exist leaves the first query unprotected against
    // becoming empty.
    await expect(
      db.assignment.count({ where: { asset: { categoryId } } }),
    ).resolves.toBeGreaterThan(0);
    await expect(
      db.asset.count({ where: { categoryId, status: AssetStatus.ASSIGNED } }),
    ).resolves.toBeGreaterThan(0);
  });
});
