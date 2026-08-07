import "server-only";
import {
  AssetEventType,
  AssetStatus,
  type Prisma,
  type PrismaClient,
} from "@prisma/client";
import { createOpenAssignmentTx } from "@/lib/asset-admin";

/**
 * The AM-04 import write path.
 *
 * This is a SEPARATE write path from `asset-admin.ts` on purpose, and the
 * reasons were recorded as binding carry-forwards a story before it was built.
 * Each one is a way of fabricating history that the register exists to prevent:
 *
 *  - **Not `createAssetWithEvent`.** It accepts only `INITIAL_ASSET_STATUSES`
 *    (ON_ORDER, IN_STOCK), so a legacy row arriving as ASSIGNED, IN_REPAIR or
 *    RETIRED cannot be created through it at all (AM-02 carry-forward).
 *  - **Not create-then-transition.** The tempting workaround — create IN_STOCK,
 *    then `transitionAssetStatus` into place — writes STATUS_CHANGED events for
 *    transitions THAT NEVER HAPPENED, corrupting the audit trail (AM-02).
 *  - **Not `assignAsset`.** It would write an ASSIGNED event dated TODAY for a
 *    handover that happened two years ago (AM-03 carry-forward).
 *  - **Not `eventTypeFor`.** That helper answers "what kind of event is this
 *    transition"; an import is not a transition.
 *
 * Instead: the terminal status is written DIRECTLY, with exactly one reserved
 * `IMPORTED` event carrying it (advisor condition C19).
 *
 * `actorId` is null on every event this module writes — the established "system
 * action (seed script)" convention. The import runs from a CLI behind
 * possession of DATABASE_URL, exactly as the two seed scripts do; attributing
 * ~400 events to whichever admin happened to run it would be an impersonation
 * the audit trail cannot later distinguish from real activity.
 */

type Tx = Prisma.TransactionClient;

/** One row's worth of asset, with every reference already resolved to an id. */
export type ImportAssetInput = {
  tag: string;
  categoryId: string;
  siteId: string | null;
  status: AssetStatus;
  description: string | null;
  make: string | null;
  model: string | null;
  serial: string | null;
  supplier: string | null;
  purchasedAt: Date | null;
  /** A decimal STRING — never a JS float, which would round a money value. */
  purchasePrice: string | null;
  poNumber: string | null;
  costCentre: string | null;
  department: string | null;
  location: string | null;
  /**
   * Set together, or not at all. `personId` without `checkedOutAt` would date a
   * legacy handover to today; `checkedOutAt` without `personId` is meaningless.
   */
  holder: { personId: string; checkedOutAt: Date } | null;
};

export type ImportedAsset = { assetId: string; assignmentId: string | null };

/**
 * Writes one imported asset, its open assignment if it has a holder, and
 * EXACTLY ONE `IMPORTED` event — all inside the caller's transaction, so an
 * asset can never commit without its audit row.
 *
 * The event's `fromStatus` is null (an imported asset came from nowhere in this
 * system) and `toStatus` is the terminal status. Per CLAUDE.md, status
 * questions are answered from `fromStatus`/`toStatus`, never from the event
 * type — so a later "which assets arrived already assigned" query reads
 * `toStatus`, and the single `IMPORTED` type stays honest about what happened.
 */
export async function importAssetWithEvent(
  tx: Tx,
  input: ImportAssetInput,
): Promise<ImportedAsset> {
  if (input.holder !== null && input.status !== AssetStatus.ASSIGNED) {
    // Defence in depth: the mapper already refuses this shape. An asset with an
    // open assignment whose status is not ASSIGNED is the cross-table invariant
    // no CHECK constraint can express.
    throw new Error(
      `Refusing to open an assignment on a ${input.status} asset (tag ${input.tag})`,
    );
  }
  if (input.holder === null && input.status === AssetStatus.ASSIGNED) {
    throw new Error(
      `Refusing to import an ASSIGNED asset with no holder (tag ${input.tag})`,
    );
  }

  const asset = await tx.asset.create({
    data: {
      tag: input.tag,
      categoryId: input.categoryId,
      siteId: input.siteId,
      status: input.status,
      description: input.description,
      make: input.make,
      model: input.model,
      serial: input.serial,
      supplier: input.supplier,
      purchasedAt: input.purchasedAt,
      purchasePrice: input.purchasePrice,
      poNumber: input.poNumber,
      costCentre: input.costCentre,
      department: input.department,
      location: input.location,
    },
    select: { id: true },
  });

  // The tx-scoped primitive AM-03 exported FOR THIS CALLER. It takes the asset
  // row lock itself, and its `checkedOutAt` branch had no production caller
  // until now — a no-coverage gap recorded in issue #12 with AM-04 named as its
  // owner. This call is what closes it.
  const assignmentId =
    input.holder === null
      ? null
      : await createOpenAssignmentTx(tx, {
          assetId: asset.id,
          personId: input.holder.personId,
          checkedOutAt: input.holder.checkedOutAt,
        });

  await tx.assetEvent.create({
    data: {
      assetId: asset.id,
      // System action: this runs from a CLI, not as a signed-in admin.
      actorId: null,
      type: AssetEventType.IMPORTED,
      fromStatus: null,
      toStatus: input.status,
      // The person link, not a person NAME. This is the whole reason
      // AssetEvent.assignmentId exists: it keeps exactly one copy of the person
      // reference, on Assignment, joinable — so a name change or a DPA erasure
      // request is honourable. `notes` stays null; no personal data ever
      // reaches this table.
      assignmentId,
      notes: null,
    },
  });

  return { assetId: asset.id, assignmentId };
}

/**
 * A 64-bit key for the run-scoped advisory lock. Any constant works; this one
 * is written out so a human reading `pg_locks` during a stuck cutover can see
 * what is holding it.
 */
export const IMPORT_ADVISORY_LOCK_KEY = 4_004_042_004;

/**
 * Takes the SESSION-scoped advisory lock that serialises import runs, and
 * returns a release function.
 *
 * Why this exists at all, and why the reason is NOT the one originally
 * recorded: AM-04-CF-A required a deterministic iteration order because a bulk
 * import took one asset row lock per call, so two concurrent runs over
 * overlapping sets in opposite orders would deadlock. With one transaction per
 * row those locks are held briefly and that window all but closes.
 *
 * The hazard that REPLACED it is duplicate stub people. `Person.email` became
 * nullable in this story, so `@unique` no longer dedupes the rows the import
 * creates — two concurrent runs would each find no match for "Jane Holder" and
 * each create one. Sorting cannot fix that; this lock can.
 *
 * SESSION-scoped (`pg_advisory_lock`), not transaction-scoped: it must span the
 * whole run, which is ~400 separate transactions. That REQUIRES an unpooled
 * connection — a session lock taken on a pooled connection may be released onto
 * a different backend than it was taken on, which is a known hazard and the
 * reason the CLI builds its own client from the direct URL.
 */
export async function withImportLock<T>(
  db: PrismaClient,
  run: () => Promise<T>,
): Promise<T> {
  await db.$executeRaw`SELECT pg_advisory_lock(${IMPORT_ADVISORY_LOCK_KEY}::bigint)`;
  try {
    return await run();
  } finally {
    await db.$executeRaw`SELECT pg_advisory_unlock(${IMPORT_ADVISORY_LOCK_KEY}::bigint)`;
  }
}

/** What resolving one `Assigned to` name produced. */
export type HolderResolution =
  | { kind: "matched"; personId: string }
  | { kind: "created"; personId: string }
  | { kind: "ambiguous" };

/**
 * Builds the holder resolver for one import run.
 *
 * ## Why the fold happens in memory and not in SQL
 *
 * The obvious implementation is a per-row
 * `person.findMany({ where: { name: { equals: folded, mode: "insensitive" } } })`.
 * It is wrong, and wrong in the silent direction. `mode: "insensitive"` folds
 * CASE and nothing else, while `foldName` also collapses runs of whitespace —
 * so a person stored as "Jane  Holder" (two spaces, which is exactly the kind
 * of thing a legacy register contains) would not match the folded "jane holder",
 * and the import would CREATE A SECOND JANE rather than link the first. Two
 * Person rows for one human, each holding some of their kit, is precisely the
 * outcome `Person.email @unique` used to prevent and no longer can now that
 * email is nullable.
 *
 * Postgres could express the real predicate, but only with a normalising
 * expression (and an index to match) that would have to stay bit-identical to
 * `foldName` forever. Loading the table once and folding with the SAME FUNCTION
 * the rest of the import uses removes that whole class of drift.
 *
 * It is also fewer queries: one read instead of ~400.
 *
 * ## Exact-unique-or-nothing (advisor condition C8)
 *
 * One match links. No match creates a stub. TWO OR MORE REFUSES — no fuzzy
 * matching, no first-match.
 *
 * The refusal is the point. A wrong match attributes someone else's laptop to a
 * named individual: a data-protection error rather than a data-quality one, and
 * invisible afterwards because the result is indistinguishable from a correct
 * import. It is also not correctable in the ordinary way — `Assignment` is
 * write-once, `AssetEvent` append-only, and nothing here is ever deleted, so the
 * only remedy is a FABRICATED RETURN. Cheap to refuse now, impossible to undo
 * later.
 *
 * Stubs get `email: null` and `employeeRef: null`. Never a synthesized address
 * (C2).
 *
 * MUST be built inside `withImportLock`: it caches the person table, so a
 * concurrent run creating a stub behind its back would reintroduce the
 * duplicate this exists to prevent.
 */
export async function createHolderResolver(
  db: PrismaClient | Tx,
  fold: (name: string) => string,
): Promise<{
  resolve: (tx: Tx, displayName: string) => Promise<HolderResolution>;
}> {
  const byFold = new Map<string, string[]>();
  // id and name only — no email, no employeeRef. This is not a
  // `personSelectFor` surface: nothing here is rendered to a reader, and the
  // narrowest projection that does the job is the one that cannot over-disclose.
  const people = await db.person.findMany({ select: { id: true, name: true } });
  for (const person of people) {
    const key = fold(person.name);
    const existing = byFold.get(key);
    if (existing) {
      existing.push(person.id);
    } else {
      byFold.set(key, [person.id]);
    }
  }

  return {
    async resolve(tx: Tx, displayName: string): Promise<HolderResolution> {
      const key = fold(displayName);
      const matches = byFold.get(key) ?? [];
      if (matches.length === 1) {
        return { kind: "matched", personId: matches[0] };
      }
      if (matches.length > 1) {
        return { kind: "ambiguous" };
      }
      const person = await tx.person.create({
        data: { name: displayName, email: null, employeeRef: null },
        select: { id: true },
      });
      // Cache the stub so a SECOND row naming the same person links to it
      // rather than creating another. Without this the import would duplicate
      // every holder who appears on more than one asset — which, in a register
      // of ~400 assets and far fewer people, is most of them.
      byFold.set(key, [person.id]);
      return { kind: "created", personId: person.id };
    },
  };
}
