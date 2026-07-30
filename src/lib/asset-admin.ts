import "server-only";
import {
  AssetEventType,
  AssetStatus,
  type Asset,
  type AssetCondition,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import { assertTransition, tagRequiredFor } from "@/lib/asset-lifecycle";

/**
 * Asset register mutations. Only the server actions in
 * src/app/assets/actions.ts (behind requireRole) call these. Every mutation
 * writes its AssetEvent IN THE SAME TRANSACTION — a mutation that commits
 * without its audit row must be impossible.
 *
 * AssetEvent is append-only: no update or delete is ever written against it.
 * Asset has no delete path either — RETIRED is the delete (PLAN.md §Decisions
 * 1); deleting an Asset would sever its history.
 */

/** Rejection of a status change that would leave a tracked asset untagged. */
export class TagRequiredError extends Error {
  readonly status: AssetStatus;

  constructor(status: AssetStatus) {
    super(`A tag is required for status ${status}`);
    this.name = "TagRequiredError";
    this.status = status;
  }
}

type Tx = Prisma.TransactionClient;

/**
 * Test-only scheduling seams. Production callers must never pass these.
 *
 * Two distinct windows, because a guard's red-proof has to exercise ITS OWN
 * window rather than a neighbouring one:
 *  - `afterGuard` — after the lock and the transition guard, before any write.
 *    Proves the asset row lock serialises concurrent transitions.
 *  - `beforeCloseWrite` — inside closeOpenAssignmentTx, between reading the open
 *    assignment and writing its closure. Proves the `returnedAt IS NULL` +
 *    `count === 1` predicate, which the asset lock cannot cover because it locks
 *    the ASSET row, not Assignment rows.
 */
type TransitionTestHooks = {
  afterGuard?: () => Promise<void>;
  beforeCloseWrite?: () => Promise<void>;
};

/**
 * The only statuses an asset may be created in. ON_ORDER is the procurement
 * path; IN_STOCK exists because not everything is ordered through the tool —
 * kit already on a shelf gets recorded where it actually is. Every other
 * status is reachable only through transitionAssetStatus, so the history can
 * never start mid-lifecycle with no trail behind it.
 */
export const INITIAL_ASSET_STATUSES = [
  AssetStatus.ON_ORDER,
  AssetStatus.IN_STOCK,
] as const;
export type InitialAssetStatus = (typeof INITIAL_ASSET_STATUSES)[number];

/** Editable asset fields. Status is absent: transitions are its only path. */
type EditableAssetFields = {
  tag: string | null;
  categoryId: string;
  make: string;
  model: string;
  serial: string | null;
  purchasedAt: Date | null;
  purchasePrice: number | null;
  supplier: string | null;
  warrantyUntil: Date | null;
  condition: AssetCondition | null;
  siteId: string | null;
};

const EDITABLE_FIELDS = [
  "tag",
  "categoryId",
  "make",
  "model",
  "serial",
  "purchasedAt",
  "purchasePrice",
  "supplier",
  "warrantyUntil",
  "condition",
  "siteId",
] as const satisfies readonly (keyof EditableAssetFields)[];

/** Trim, and treat an empty tag as absent — "" is not a tag, and it would
 *  collide on the unique index with every other blank one. */
function normaliseTag(tag: string | null): string | null {
  const trimmed = tag?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/**
 * Locks a single asset row (`SELECT … FOR UPDATE`) and returns the fields the
 * transition guard reads, exactly as lockActiveAdmins does in user-admin.ts.
 *
 * This lock is what makes the transition guard race-safe. Without it two
 * concurrent transitions both read the same `from` status, both pass
 * assertTransition, and the history records a transition that never happened
 * (AM-01 retro's headline lesson). With it the second transaction blocks until
 * the first commits, then READ COMMITTED re-reads the new status and the guard
 * rejects it.
 */
async function lockAsset(
  tx: Tx,
  assetId: string,
): Promise<{ id: string; status: AssetStatus; tag: string | null }> {
  const rows = await tx.$queryRaw<
    { id: string; status: AssetStatus; tag: string | null }[]
  >`SELECT "id", "status", "tag" FROM "Asset" WHERE "id" = ${assetId} FOR UPDATE`;
  const row = rows[0];
  if (!row) {
    throw new Error(`Asset ${assetId} not found`);
  }
  return row;
}

export async function createAssetWithEvent(
  db: PrismaClient,
  input: EditableAssetFields & {
    status: InitialAssetStatus;
    actorId: string;
  },
): Promise<Asset> {
  if (!INITIAL_ASSET_STATUSES.includes(input.status)) {
    throw new Error(
      `Assets may only be created in ${INITIAL_ASSET_STATUSES.join(" or ")}, not ${input.status}`,
    );
  }
  const tag = normaliseTag(input.tag);
  if (tagRequiredFor(input.status) && tag === null) {
    throw new TagRequiredError(input.status);
  }
  return db.$transaction(async (tx) => {
    const asset = await tx.asset.create({
      data: {
        tag,
        categoryId: input.categoryId,
        make: input.make,
        model: input.model,
        serial: input.serial,
        purchasedAt: input.purchasedAt,
        purchasePrice: input.purchasePrice,
        supplier: input.supplier,
        warrantyUntil: input.warrantyUntil,
        status: input.status,
        condition: input.condition,
        siteId: input.siteId,
      },
    });
    await tx.assetEvent.create({
      data: {
        assetId: asset.id,
        actorId: input.actorId,
        type: AssetEventType.CREATED,
        toStatus: input.status,
      },
    });
    return asset;
  });
}

export async function updateAssetWithEvent(
  db: PrismaClient,
  input: EditableAssetFields & { assetId: string; actorId: string },
): Promise<Asset> {
  const tag = normaliseTag(input.tag);
  return db.$transaction(async (tx) => {
    const current = await tx.asset.findUnique({ where: { id: input.assetId } });
    if (!current) {
      throw new Error(`Asset ${input.assetId} not found`);
    }
    // Editing cannot strip the tag off an asset whose status requires one.
    // The CHECK constraint is the real enforcement; this is the friendly
    // message.
    //
    // This read is deliberately unlocked, and that is safe for the TAG-NULL
    // INVARIANT ONLY: a concurrent transition can race us into the constraint
    // but never past it, because the constraint re-checks the committed row.
    // It is NOT a general safety claim about this function. Two races remain
    // open, both last-write-wins, neither backstopped by any constraint:
    //   - a concurrent repair setting `condition` can be clobbered by an edit
    //     carrying the stale value, and since the UPDATED event records field
    //     NAMES and not values, the overwritten value is unreconstructable
    //     from the history;
    //   - an edit can land tag T1 on a row a concurrent delivery just tagged
    //     T2.
    // Accepted for AM-02: no AC requires optimistic concurrency and the plan
    // scoped this as a simple edit path. AM-03 builds assignment writes on
    // this file's pattern and has NO equivalent CHECK backstop, so it must
    // decide locking on its own merits rather than inheriting this comment.
    if (tagRequiredFor(current.status) && tag === null) {
      throw new TagRequiredError(current.status);
    }
    const next: EditableAssetFields = { ...input, tag };
    const changed = EDITABLE_FIELDS.filter((field) =>
      hasChanged(current[field], next[field]),
    );
    if (changed.length === 0) {
      // No-op edit: no mutation, so no event. The audit trail records
      // changes, not clicks (same rule as changeUserRole).
      return current;
    }
    const updated = await tx.asset.update({
      where: { id: input.assetId },
      data: {
        tag,
        categoryId: input.categoryId,
        make: input.make,
        model: input.model,
        serial: input.serial,
        purchasedAt: input.purchasedAt,
        purchasePrice: input.purchasePrice,
        supplier: input.supplier,
        warrantyUntil: input.warrantyUntil,
        condition: input.condition,
        siteId: input.siteId,
      },
    });
    await tx.assetEvent.create({
      data: {
        assetId: input.assetId,
        actorId: input.actorId,
        type: AssetEventType.UPDATED,
        // Field names, not values: the history stays readable without
        // duplicating the register into the audit log.
        notes: `Changed: ${changed.join(", ")}`,
      },
    });
    return updated;
  });
}

/** The statuses a return may land in: back on the shelf, or straight to repair. */
export const RETURN_STATUSES = [
  AssetStatus.IN_STOCK,
  AssetStatus.IN_REPAIR,
] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

/** Rejection of an assignment to a person whose linked account is deactivated. */
export class PersonNotAssignableError extends Error {
  readonly personId: string;

  constructor(personId: string) {
    super(
      `Person ${personId} has a deactivated account and cannot hold assets`,
    );
    this.name = "PersonNotAssignableError";
    this.personId = personId;
  }
}

/**
 * A person may hold assets unless they have a LINKED, DEACTIVATED user account.
 *
 * A person with no `User` at all is fully assignable — contractors and staff
 * without logins are real, and the seed creates Person rows independently of
 * accounts. Deliberately not a DB constraint: it is cross-table, and the flag
 * changes after the fact.
 *
 * What this does NOT do is enforce anything against a leaver's EXISTING open
 * assignments (AM-03-CF-2, advisor §4b). Blocking deactivation on outstanding
 * assets would be a security regression — the AM-01 kill-switch must never be
 * blockable by asset state, or a departing employee with an unreturned laptop
 * cannot be locked out. Auto-returning would fabricate a return that never
 * happened. Neither: the person view shows the deactivated marker instead.
 */
async function assertPersonAssignable(tx: Tx, personId: string): Promise<void> {
  const person = await tx.person.findUnique({
    where: { id: personId },
    select: { id: true, user: { select: { deactivatedAt: true } } },
  });
  if (!person) {
    throw new Error(`Person ${personId} not found`);
  }
  if (person.user?.deactivatedAt != null) {
    throw new PersonNotAssignableError(personId);
  }
}

/**
 * Inserts an open Assignment, taking the asset row lock itself.
 *
 * Exported as a tx-scoped primitive specifically so AM-04's import can create
 * an open assignment with a historical `checkedOutAt` WITHOUT passing through
 * the lifecycle guard — importing a legacy `ASSIGNED` row must not fabricate an
 * `ASSIGNED` event dated today for a handover that happened two years ago.
 * That is AM-02's `INITIAL_ASSET_STATUSES` trap one story later; the seam
 * exists so AM-04 does not rebuild it.
 *
 * IT TAKES THE LOCK RATHER THAN DOCUMENTING THAT THE CALLER MUST (security
 * review, AM-04-CF-A). `lockAsset` is private, so an external caller could not
 * honour a "caller must hold the lock" contract without duplicating the raw
 * SQL — and duplicating it is precisely how uniform lock ordering breaks. The
 * lock is re-entrant within a transaction, so the core path below, which has
 * already taken it, pays nothing for the second acquisition. The seam is now
 * safe by construction instead of by comment.
 */
export async function createOpenAssignmentTx(
  tx: Tx,
  input: { assetId: string; personId: string; checkedOutAt?: Date },
): Promise<string> {
  await lockAsset(tx, input.assetId);
  const assignment = await tx.assignment.create({
    data: {
      assetId: input.assetId,
      personId: input.personId,
      ...(input.checkedOutAt === undefined
        ? {}
        : { checkedOutAt: input.checkedOutAt }),
    },
    select: { id: true },
  });
  return assignment.id;
}

/**
 * Closes the open assignment on an asset, if there is one. Returns its id, or
 * null when the asset was not actually held.
 *
 * The update is predicated on `returnedAt: null` and asserts it touched exactly
 * one row. That keeps the `Assignment` mutability exception self-limiting: the
 * two mutable columns can only ever be written to a row that is still open.
 * Application enforced, not DB enforced.
 *
 * WHAT THIS PREDICATE DOES NOT DO — and an earlier version of this comment
 * wrongly claimed it did: it is NOT a second layer that survives deleting the
 * asset row lock. Without the lock, the losing transaction's `findFirst` below
 * sees the row already closed, returns null, and takes the "proceed" branch —
 * the `count === 1` assertion is never reached, and a second transition commits
 * against an already-returned asset. Verified: with `FOR UPDATE` removed, the
 * concurrent-double-return test fails with two RETURNED events, not one.
 *
 * WHAT IT DOES DEFEND, precisely: a writer that closes this assignment WITHOUT
 * holding the asset row lock, landing between the findFirst and the updateMany.
 * The lock is on the ASSET row — it does not lock Assignment rows, so raw SQL,
 * a psql session, or any future path that writes Assignment directly is not
 * excluded by it and can close a row out from under us. That is the window this
 * predicate closes, and it is why deleting it is not free even though the lock
 * is correct. `closeRace` below exists so that claim is falsifiable rather than
 * asserted: the test drives exactly that interleaving and this throw is what
 * catches it.
 *
 * A null return means `Asset.status` said ASSIGNED while no open assignment
 * existed — the invariant the DB cannot enforce (a CHECK cannot cross tables).
 * We proceed rather than throw: the open Assignment is the source of truth for
 * holdership, so an asset with none is not actually held, and refusing to
 * retire it would strand it with no operator remedy. The reconciliation query
 * in the README runbook is the detection mechanism.
 */
async function closeOpenAssignmentTx(
  tx: Tx,
  input: { assetId: string; conditionNotes?: string | null },
  testHooks?: TransitionTestHooks,
): Promise<string | null> {
  const open = await tx.assignment.findFirst({
    where: { assetId: input.assetId, returnedAt: null },
    select: { id: true },
  });
  if (!open) {
    return null;
  }
  // Test-only seam, parked in the window the predicate defends — between the
  // read and the write. Distinct from afterGuard, which sits outside this
  // function and cannot reach here. Production callers never pass it.
  await testHooks?.beforeCloseWrite?.();
  const { count } = await tx.assignment.updateMany({
    where: { id: open.id, returnedAt: null },
    data: {
      returnedAt: new Date(),
      conditionNotes: input.conditionNotes ?? null,
    },
  });
  if (count !== 1) {
    throw new Error(
      `Assignment ${open.id} was closed concurrently — refusing to overwrite a recorded return`,
    );
  }
  return open.id;
}

/**
 * Exactly ONE AssetEvent per action, and its type is DERIVED, never passed in
 * (advisor condition 4).
 *
 * Deriving rather than parameterising is a deliberate strengthening of the
 * advisor's condition, which called for an event-type parameter: a caller that
 * opens an assignment cannot then mislabel the event, and a caller cannot emit
 * a second row. Both are structurally impossible here instead of being a rule
 * callers must remember.
 *
 * Corollary every reader must honour: STATUS QUESTIONS ARE ANSWERED BY QUERYING
 * fromStatus/toStatus, NEVER BY EVENT TYPE. Retiring an assigned asset writes a
 * single RETURNED event carrying ASSIGNED -> RETIRED.
 */
function eventTypeFor(
  openedAssignmentId: string | null,
  closedAssignmentId: string | null,
): AssetEventType {
  if (openedAssignmentId !== null && closedAssignmentId !== null) {
    // Unreachable today ONLY because assertTransition rejects
    // ASSIGNED -> ASSIGNED — a guarantee that lives in asset-lifecycle.ts, with
    // nothing in the type system tying it to this function. Adding ASSIGNED to
    // its own transition list (a plausible "reassign without returning first"
    // request) would make this reachable, and the single-event rule would then
    // silently LOSE information: the event would be typed ASSIGNED and carry
    // only the opened assignment, dropping the closed custody period entirely.
    //
    // Failing loudly is the honest response. A one-step reassign needs a
    // deliberate decision about how to represent two custody changes in one
    // event, not a default that quietly discards one of them (AM-03-CF-3).
    throw new Error(
      "A single transition both opened and closed an assignment; one AssetEvent cannot represent both custody changes without losing one",
    );
  }
  if (openedAssignmentId !== null) return AssetEventType.ASSIGNED;
  if (closedAssignmentId !== null) return AssetEventType.RETURNED;
  return AssetEventType.STATUS_CHANGED;
}

/**
 * The transaction-scoped core of every status change, including assignment and
 * return. Callers supply the transaction; this never opens one.
 *
 * Deliberately NOT typed as `PrismaClient | TransactionClient` with a branch
 * (advisor condition 2): that makes the transaction boundary implicit at the
 * call site and permits a caller who is silently not in one.
 *
 * LOCK ORDERING IS UNIFORM AND ABSOLUTE (advisor condition 3): the asset row
 * lock is taken FIRST, before any Assignment row is read or written, on every
 * path. The Asset row is the mutex for that asset's assignment rows. Taking
 * Asset->Assignment on one path and Assignment->Asset on another is a deadlock
 * cycle, and under Neon those surface as intermittent production failures.
 * Because the lock is always first, no Assignment row needs its own FOR UPDATE.
 *
 * The partial unique index is NOT a substitute for this lock: it protects
 * exactly one race (two concurrent inserts for the same asset) and does nothing
 * for assign-vs-sendToRepair, assign-vs-retire, or two concurrent returns.
 */
async function transitionAssetStatusTx(
  tx: Tx,
  input: {
    assetId: string;
    toStatus: AssetStatus;
    /** Supplied at delivery (ON_ORDER -> IN_STOCK). Omit to keep the existing tag. */
    tag?: string | null;
    condition?: AssetCondition | null;
    notes?: string | null;
    /** Recorded on the assignment being closed, when this leaves ASSIGNED. */
    conditionNotes?: string | null;
    /** Set only by assignAsset: opens an assignment as part of this transition. */
    assignToPersonId?: string;
    actorId: string;
  },
  // Test-only scheduling seam: the concurrency tests park one transaction
  // here — after the guard reads, before any write — so the second transaction
  // provably overlaps it. Production callers must never pass this.
  testHooks?: TransitionTestHooks,
): Promise<Asset> {
  const current = await lockAsset(tx, input.assetId);
  assertTransition(current.status, input.toStatus);
  const suppliedTag =
    input.tag === undefined ? undefined : normaliseTag(input.tag);
  const effectiveTag = suppliedTag === undefined ? current.tag : suppliedTag;
  if (tagRequiredFor(input.toStatus) && effectiveTag === null) {
    throw new TagRequiredError(input.toStatus);
  }
  if (input.assignToPersonId !== undefined) {
    await assertPersonAssignable(tx, input.assignToPersonId);
  }
  await testHooks?.afterGuard?.();

  // EVERY transition out of ASSIGNED closes the open assignment, in this same
  // transaction (advisor condition 5). Implemented once here rather than per
  // caller, so the AM-02 actions that predate assignment — sendToRepair,
  // retireAsset — cannot strand an open assignment and leave the register
  // claiming a retired laptop is still held by a named person.
  //
  // Consequence: on an ASSIGNED asset, sending to repair IS the repair-bound
  // return of AC-2, not a second parallel path. There is deliberately no
  // "return it first" rejection — forcing a two-step return on a stolen laptop
  // trains operators to record a fictional "returned to stock".
  const closedAssignmentId =
    current.status === AssetStatus.ASSIGNED
      ? await closeOpenAssignmentTx(
          tx,
          {
            assetId: input.assetId,
            conditionNotes: input.conditionNotes,
          },
          testHooks,
        )
      : null;

  const openedAssignmentId =
    input.assignToPersonId === undefined
      ? null
      : await createOpenAssignmentTx(tx, {
          assetId: input.assetId,
          personId: input.assignToPersonId,
        });

  const updated = await tx.asset.update({
    where: { id: input.assetId },
    data: {
      status: input.toStatus,
      ...(suppliedTag === undefined ? {} : { tag: suppliedTag }),
      ...(input.condition == null ? {} : { condition: input.condition }),
    },
  });
  await tx.assetEvent.create({
    data: {
      assetId: input.assetId,
      actorId: input.actorId,
      type: eventTypeFor(openedAssignmentId, closedAssignmentId),
      fromStatus: current.status,
      toStatus: input.toStatus,
      // The ONLY record of who held the asset: a foreign key, never a name.
      // No personal data is ever written into notes (CLAUDE.md).
      assignmentId: openedAssignmentId ?? closedAssignmentId,
      notes: input.notes ?? null,
    },
  });
  return updated;
}

export async function transitionAssetStatus(
  db: PrismaClient,
  input: {
    assetId: string;
    toStatus: AssetStatus;
    /** Supplied at delivery (ON_ORDER -> IN_STOCK). Omit to keep the existing tag. */
    tag?: string | null;
    condition?: AssetCondition | null;
    notes?: string | null;
    conditionNotes?: string | null;
    actorId: string;
  },
  testHooks?: TransitionTestHooks,
): Promise<Asset> {
  return db.$transaction((tx) => transitionAssetStatusTx(tx, input, testHooks));
}

/**
 * Hands an asset to a person: IN_STOCK -> ASSIGNED, opening an Assignment and
 * writing a single ASSIGNED event, atomically.
 *
 * Assigning an already-assigned asset fails on the lifecycle guard
 * (ASSIGNED -> ASSIGNED is not a legal transition) — an IllegalTransitionError,
 * NOT a unique-index violation. That distinction is load-bearing in the
 * concurrency tests: if the loser of a double-assign race reports P2002, the
 * row lock is not doing its job and the index is masking it.
 */
export async function assignAsset(
  db: PrismaClient,
  input: {
    assetId: string;
    personId: string;
    notes?: string | null;
    actorId: string;
  },
  testHooks?: TransitionTestHooks,
): Promise<Asset> {
  return db.$transaction((tx) =>
    transitionAssetStatusTx(
      tx,
      {
        assetId: input.assetId,
        toStatus: AssetStatus.ASSIGNED,
        assignToPersonId: input.personId,
        notes: input.notes,
        actorId: input.actorId,
      },
      testHooks,
    ),
  );
}

/**
 * Takes an asset back: ASSIGNED -> IN_STOCK or ASSIGNED -> IN_REPAIR, closing
 * the open Assignment and writing a single RETURNED event, atomically.
 *
 * `condition` is mandatory (AC-2's "captures a condition note"): it is the
 * structured field that answers "in what state", it is one click, and it
 * updates Asset.condition in the same transaction. The free-text
 * `conditionNotes` is required by the action layer only for repair-bound
 * returns and for POOR/DEFECTIVE — forcing prose on every routine "GOOD, back
 * on the shelf" return trains operators to type "ok" and destroys the signal.
 */
export async function returnAsset(
  db: PrismaClient,
  input: {
    assetId: string;
    toStatus: ReturnStatus;
    condition: AssetCondition;
    conditionNotes?: string | null;
    notes?: string | null;
    actorId: string;
  },
  testHooks?: TransitionTestHooks,
): Promise<Asset> {
  return db.$transaction((tx) =>
    transitionAssetStatusTx(
      tx,
      {
        assetId: input.assetId,
        toStatus: input.toStatus,
        condition: input.condition,
        conditionNotes: input.conditionNotes,
        notes: input.notes,
        actorId: input.actorId,
      },
      testHooks,
    ),
  );
}

/** Field-level equality across the shapes Prisma returns: Date, Decimal, scalars. */
function hasChanged(before: unknown, after: unknown): boolean {
  if (before === after) return false;
  if (before == null || after == null) return true;
  if (before instanceof Date && after instanceof Date) {
    return before.getTime() !== after.getTime();
  }
  // Prisma.Decimal (purchasePrice) compared against the plain number the
  // boundary parsed: string form is exact for both, unlike ===.
  return String(before) !== String(after);
}
