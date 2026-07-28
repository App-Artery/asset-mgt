// @vitest-environment node
//
// Design test matrix items 4 and 6: the last-admin guard under two REAL
// concurrent transactions (Prisma interactive transactions on separate pool
// connections), and UserEvent atomicity — the audit row commits with the
// mutation or neither commits.
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { PrismaClient, Role, UserEventType } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  LastAdminError,
  changeUserRole,
  createUserWithEvent,
  setUserActivation,
} from "@/lib/user-admin";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

describe.skipIf(!testDatabaseUrl)("user-admin transactions (real DB)", () => {
  let db: PrismaClient;

  beforeAll(() => {
    execSync("pnpm exec prisma migrate deploy", {
      env: { ...process.env, DATABASE_URL: testDatabaseUrl },
      stdio: "inherit",
    });
    db = new PrismaClient({ datasourceUrl: testDatabaseUrl });
  });

  afterAll(async () => {
    await db?.$disconnect();
  });

  async function createUser(role: Role, deactivated = false) {
    return db.user.create({
      data: {
        email: `useradmin-${randomUUID()}@example.com`,
        name: "UserAdmin Test",
        role,
        deactivatedAt: deactivated ? new Date() : null,
      },
    });
  }

  // The guard counts active admins across the whole table; the shared test
  // database keeps rows from other files and previous runs. Deactivate every
  // active admin that is not part of the scenario under test (User rows are
  // not append-only; this is plain test staging).
  async function keepOnlyTheseActiveAdmins(ids: string[]) {
    await db.user.updateMany({
      where: {
        role: Role.ADMIN_IT,
        deactivatedAt: null,
        id: { notIn: ids },
      },
      data: { deactivatedAt: new Date() },
    });
  }

  it("creates Person + User + CREATED event in one transaction", async () => {
    const actor = await createUser(Role.ADMIN_IT);
    const email = `USERADMIN-${randomUUID()}@Example.com`;
    const user = await createUserWithEvent(db, {
      name: "New Starter",
      email,
      employeeRef: `REF-${randomUUID().slice(0, 8)}`,
      role: Role.FINANCE,
      actorId: actor.id,
    });

    expect(user.email).toBe(email.toLowerCase());
    const person = await db.person.findUnique({
      where: { email: email.toLowerCase() },
    });
    expect(person).not.toBeNull();
    expect(user.personId).toBe(person?.id);
    const events = await db.userEvent.findMany({
      where: { userId: user.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: UserEventType.CREATED,
      actorId: actor.id,
      toRole: Role.FINANCE,
    });
  });

  it("changes role and writes ROLE_CHANGED with from/to in the same transaction", async () => {
    const actor = await createUser(Role.ADMIN_IT);
    const subject = await createUser(Role.STAFF_RO);

    const updated = await changeUserRole(db, {
      subjectId: subject.id,
      toRole: Role.PROCUREMENT,
      actorId: actor.id,
    });

    expect(updated.role).toBe(Role.PROCUREMENT);
    const events = await db.userEvent.findMany({
      where: { userId: subject.id, type: UserEventType.ROLE_CHANGED },
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      actorId: actor.id,
      fromRole: Role.STAFF_RO,
      toRole: Role.PROCUREMENT,
    });
  });

  it("rolls back the role change when the audit insert fails (atomicity)", async () => {
    const subject = await createUser(Role.STAFF_RO);

    // A nonexistent actor violates the UserEvent.actorId FK — and only at the
    // audit INSERT, which runs after the role UPDATE inside the same
    // transaction. If the event insert ever moves outside the transaction,
    // the update would survive and this test goes red.
    await expect(
      changeUserRole(db, {
        subjectId: subject.id,
        toRole: Role.FINANCE,
        actorId: `nonexistent-${randomUUID()}`,
      }),
    ).rejects.toThrow();

    const after = await db.user.findUniqueOrThrow({
      where: { id: subject.id },
    });
    expect(after.role).toBe(Role.STAFF_RO);
    await expect(
      db.userEvent.count({ where: { userId: subject.id } }),
    ).resolves.toBe(0);
  });

  it("rejects demoting the last active admin", async () => {
    const admin = await createUser(Role.ADMIN_IT);
    await keepOnlyTheseActiveAdmins([admin.id]);

    await expect(
      changeUserRole(db, {
        subjectId: admin.id,
        toRole: Role.STAFF_RO,
        actorId: admin.id,
      }),
    ).rejects.toThrow(LastAdminError);

    const after = await db.user.findUniqueOrThrow({ where: { id: admin.id } });
    expect(after.role).toBe(Role.ADMIN_IT);
    await expect(
      db.userEvent.count({
        where: { userId: admin.id, type: UserEventType.ROLE_CHANGED },
      }),
    ).resolves.toBe(0);
  });

  it("rejects deactivating the last active admin, allows it with a survivor", async () => {
    const adminA = await createUser(Role.ADMIN_IT);
    const adminB = await createUser(Role.ADMIN_IT);
    await keepOnlyTheseActiveAdmins([adminA.id, adminB.id]);

    // With a survivor: allowed, flag set (never a delete), event written.
    const deactivated = await setUserActivation(db, {
      subjectId: adminB.id,
      deactivated: true,
      actorId: adminA.id,
    });
    expect(deactivated.deactivatedAt).not.toBeNull();
    await expect(
      db.userEvent.count({
        where: { userId: adminB.id, type: UserEventType.DEACTIVATED },
      }),
    ).resolves.toBe(1);

    // Now adminA is the last active admin: rejected.
    await expect(
      setUserActivation(db, {
        subjectId: adminA.id,
        deactivated: true,
        actorId: adminA.id,
      }),
    ).rejects.toThrow(LastAdminError);

    // Reactivation writes its own event and restores access.
    const reactivated = await setUserActivation(db, {
      subjectId: adminB.id,
      deactivated: false,
      actorId: adminA.id,
    });
    expect(reactivated.deactivatedAt).toBeNull();
    await expect(
      db.userEvent.count({
        where: { userId: adminB.id, type: UserEventType.REACTIVATED },
      }),
    ).resolves.toBe(1);
  });

  it("holds the last-admin guard under two concurrent demotions (design test 4)", async () => {
    const adminA = await createUser(Role.ADMIN_IT);
    const adminB = await createUser(Role.ADMIN_IT);
    await keepOnlyTheseActiveAdmins([adminA.id, adminB.id]);

    // Two REAL concurrent transactions on separate pool connections, each
    // demoting one of the two remaining admins. Both individually look safe
    // (the other admin survives); committed together they would leave zero.
    //
    // The afterGuard barrier parks transaction 1 AFTER its guard read and
    // BEFORE its write, so transaction 2 provably runs inside the race
    // window — without it, T1 tends to fully commit before T2 reads and the
    // test passes even with the lock removed (verified empirically). With
    // the FOR UPDATE lock, T2 blocks until T1 commits, re-reads only true
    // survivors, and exactly one demotion is rejected; if the lock is ever
    // dropped, both commit and the assertions below go red.
    let t1PassedGuard!: () => void;
    const t1GuardRead = new Promise<void>((resolve) => {
      t1PassedGuard = resolve;
    });
    let releaseT1!: () => void;
    const t1Hold = new Promise<void>((resolve) => {
      releaseT1 = resolve;
    });

    const demoteA = changeUserRole(
      db,
      { subjectId: adminA.id, toRole: Role.STAFF_RO, actorId: adminB.id },
      {
        afterGuard: async () => {
          t1PassedGuard();
          await t1Hold;
        },
      },
    );
    await t1GuardRead;

    // T2 starts while T1 sits inside its transaction holding the row locks.
    const demoteB = changeUserRole(db, {
      subjectId: adminB.id,
      toRole: Role.STAFF_RO,
      actorId: adminA.id,
    });
    // Give T2 real time to reach (and block on) the admin-set lock — or, if
    // the lock were missing, to sail through and commit inside the window.
    await new Promise((resolve) => setTimeout(resolve, 300));
    releaseT1();

    const results = await Promise.allSettled([demoteA, demoteB]);
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      LastAdminError,
    );

    // Exactly one of the two is still an active admin, and exactly one
    // ROLE_CHANGED event exists across the pair.
    const stillAdmins = await db.user.count({
      where: {
        id: { in: [adminA.id, adminB.id] },
        role: Role.ADMIN_IT,
        deactivatedAt: null,
      },
    });
    expect(stillAdmins).toBe(1);
    await expect(
      db.userEvent.count({
        where: {
          userId: { in: [adminA.id, adminB.id] },
          type: UserEventType.ROLE_CHANGED,
        },
      }),
    ).resolves.toBe(1);
  });

  it("treats a same-role change as a no-op without an audit event", async () => {
    const actor = await createUser(Role.ADMIN_IT);
    const subject = await createUser(Role.FINANCE);

    const result = await changeUserRole(db, {
      subjectId: subject.id,
      toRole: Role.FINANCE,
      actorId: actor.id,
    });

    expect(result.role).toBe(Role.FINANCE);
    await expect(
      db.userEvent.count({
        where: { userId: subject.id, type: UserEventType.ROLE_CHANGED },
      }),
    ).resolves.toBe(0);
  });
});
