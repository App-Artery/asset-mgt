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
    // message. Reading status without a lock is fine here: a concurrent
    // transition can only race us into the constraint, never past it.
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

export async function transitionAssetStatus(
  db: PrismaClient,
  input: {
    assetId: string;
    toStatus: AssetStatus;
    /** Supplied at delivery (ON_ORDER -> IN_STOCK). Omit to keep the existing tag. */
    tag?: string | null;
    condition?: AssetCondition | null;
    notes?: string | null;
    actorId: string;
  },
  // Test-only scheduling seam: the concurrency test parks one transaction
  // here — after the guard read, before the write — so the second transaction
  // provably overlaps it. Production callers must never pass this.
  testHooks?: { afterGuard?: () => Promise<void> },
): Promise<Asset> {
  return db.$transaction(async (tx) => {
    const current = await lockAsset(tx, input.assetId);
    assertTransition(current.status, input.toStatus);
    const suppliedTag =
      input.tag === undefined ? undefined : normaliseTag(input.tag);
    const effectiveTag = suppliedTag === undefined ? current.tag : suppliedTag;
    if (tagRequiredFor(input.toStatus) && effectiveTag === null) {
      throw new TagRequiredError(input.toStatus);
    }
    await testHooks?.afterGuard?.();
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
        type: AssetEventType.STATUS_CHANGED,
        fromStatus: current.status,
        toStatus: input.toStatus,
        notes: input.notes ?? null,
      },
    });
    return updated;
  });
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
