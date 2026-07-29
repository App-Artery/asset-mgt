"use server";

import { revalidatePath } from "next/cache";
import { AssetCondition, AssetStatus, Prisma } from "@prisma/client";
import { z } from "zod";
import {
  INITIAL_ASSET_STATUSES,
  TagRequiredError,
  createAssetWithEvent,
  transitionAssetStatus,
  updateAssetWithEvent,
} from "@/lib/asset-admin";
import { IllegalTransitionError } from "@/lib/asset-lifecycle";
import { requireRole } from "@/lib/authz";
import { getDb } from "@/lib/db";

export type AssetActionState = { ok: boolean; message: string } | null;

// ---------------------------------------------------------------------------
// Boundary schemas. Normalisation happens in .preprocess, BEFORE validation —
// .transform() runs after the validators and would reject input it was meant
// to clean (LEARNINGS §Zod).
// ---------------------------------------------------------------------------

/** Every optional field is submitted as "" by an empty input; "" is not a value. */
const blankToNull = (value: unknown) =>
  typeof value === "string" && value.trim() === "" ? null : value;

const optionalText = z.preprocess(
  blankToNull,
  z.string().trim().min(1).nullable(),
);
const requiredText = z.string().trim().min(1);
const optionalId = z.preprocess(blankToNull, z.string().min(1).nullable());

/**
 * <input type="date"> submits YYYY-MM-DD. Pinned to UTC midnight so a local
 * timezone never shifts a purchase date across a day boundary — the register
 * is read from Nairobi and served from fra1.
 */
const optionalDate = z.preprocess((value) => {
  const normalised = blankToNull(value);
  if (typeof normalised !== "string") return normalised;
  const trimmed = normalised.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed)
    ? new Date(`${trimmed}T00:00:00Z`)
    : trimmed;
}, z.date().nullable());

/** 0 is a legitimate price (donated or written-down kit) — .min(0), never .positive(). */
const optionalPrice = z.preprocess((value) => {
  const normalised = blankToNull(value);
  if (typeof normalised !== "string") return normalised;
  const parsed = Number(normalised.trim());
  return Number.isFinite(parsed) ? parsed : normalised;
}, z.number().min(0).nullable());

const optionalCondition = z.preprocess(
  blankToNull,
  z.enum(AssetCondition).nullable(),
);

const assetFieldsSchema = z.object({
  tag: optionalText,
  categoryId: z.string().min(1),
  make: requiredText,
  model: requiredText,
  serial: optionalText,
  purchasedAt: optionalDate,
  purchasePrice: optionalPrice,
  supplier: optionalText,
  warrantyUntil: optionalDate,
  condition: optionalCondition,
  siteId: optionalId,
});

// Status is absent from the edit schema on purpose: transitions are the only
// path that changes it, so every status change lands in the audit trail.
const createAssetSchema = assetFieldsSchema.extend({
  status: z.enum(INITIAL_ASSET_STATUSES),
});
const updateAssetSchema = assetFieldsSchema.extend({
  assetId: z.string().min(1),
});

const receiveSchema = z.object({
  assetId: z.string().min(1),
  tag: requiredText,
  condition: optionalCondition,
  notes: optionalText,
});
const repairSchema = z.object({
  assetId: z.string().min(1),
  condition: optionalCondition,
  notes: optionalText,
});
const retireSchema = z.object({
  assetId: z.string().min(1),
  notes: optionalText,
});

function assetFieldsFrom(formData: FormData) {
  return {
    tag: formData.get("tag"),
    categoryId: formData.get("categoryId"),
    make: formData.get("make"),
    model: formData.get("model"),
    serial: formData.get("serial"),
    purchasedAt: formData.get("purchasedAt"),
    purchasePrice: formData.get("purchasePrice"),
    supplier: formData.get("supplier"),
    warrantyUntil: formData.get("warrantyUntil"),
    condition: formData.get("condition"),
    siteId: formData.get("siteId"),
  };
}

const INVALID_FIELDS_MESSAGE =
  "Check the form: category, make and model are required, and any price must be zero or more.";

// ---------------------------------------------------------------------------
// Error mapping. Anything unmapped rethrows — AuthorizationError in particular
// must fail loudly and never be swallowed into a form message.
// ---------------------------------------------------------------------------

const DUPLICATE_TAG_MESSAGE = "An asset with that tag already exists.";
const TAG_REQUIRED_MESSAGE =
  "A tag is required before this asset can move into stock.";

/**
 * Postgres SQLSTATE 23514 (check_violation) — i.e.
 * Asset_tag_required_when_tracked. Defence in depth behind the TagRequiredError
 * guard, which should mean this never fires. Prisma surfaces a model-layer
 * CHECK violation as PrismaClientUnknownRequestError with no `code` field and
 * the SQLSTATE only in the message text (verified against Postgres 17), so the
 * message is the only thing to match on.
 */
function isCheckViolation(error: unknown): boolean {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) &&
    !(error instanceof Prisma.PrismaClientUnknownRequestError)
  ) {
    return false;
  }
  return error.message.includes("23514");
}

function mapAssetError(error: unknown): AssetActionState {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    return { ok: false, message: DUPLICATE_TAG_MESSAGE };
  }
  if (error instanceof IllegalTransitionError) {
    return {
      ok: false,
      message:
        "That status change isn't allowed from this asset's current status.",
    };
  }
  if (error instanceof TagRequiredError || isCheckViolation(error)) {
    return { ok: false, message: TAG_REQUIRED_MESSAGE };
  }
  return null;
}

function revalidateAsset(assetId: string): void {
  revalidatePath("/assets");
  revalidatePath(`/assets/${assetId}`);
}

// ---------------------------------------------------------------------------
// Actions. `await requireRole(...)` is the FIRST statement of every one, with
// no exceptions, so review can verify coverage mechanically by grep.
// ---------------------------------------------------------------------------

export async function createAsset(
  _previous: AssetActionState,
  formData: FormData,
): Promise<AssetActionState> {
  const { userId: actorId } = await requireRole("ADMIN_IT", "PROCUREMENT");
  const parsed = createAssetSchema.safeParse({
    ...assetFieldsFrom(formData),
    status: formData.get("status"),
  });
  if (!parsed.success) {
    return { ok: false, message: INVALID_FIELDS_MESSAGE };
  }
  let assetId: string;
  try {
    const asset = await createAssetWithEvent(getDb(), {
      ...parsed.data,
      actorId,
    });
    assetId = asset.id;
  } catch (error) {
    const failure = mapAssetError(error);
    if (!failure) throw error;
    return failure;
  }
  revalidateAsset(assetId);
  return {
    ok: true,
    message: `Added ${parsed.data.make} ${parsed.data.model}.`,
  };
}

export async function updateAsset(
  _previous: AssetActionState,
  formData: FormData,
): Promise<AssetActionState> {
  const { userId: actorId } = await requireRole("ADMIN_IT", "PROCUREMENT");
  const parsed = updateAssetSchema.safeParse({
    ...assetFieldsFrom(formData),
    assetId: formData.get("assetId"),
  });
  if (!parsed.success) {
    return { ok: false, message: INVALID_FIELDS_MESSAGE };
  }
  try {
    await updateAssetWithEvent(getDb(), { ...parsed.data, actorId });
  } catch (error) {
    const failure = mapAssetError(error);
    if (!failure) throw error;
    return failure;
  }
  revalidateAsset(parsed.data.assetId);
  return { ok: true, message: "Asset updated." };
}

/** Tag-on-delivery: ON_ORDER -> IN_STOCK, rejected without a tag. */
export async function receiveAndTagAsset(
  _previous: AssetActionState,
  formData: FormData,
): Promise<AssetActionState> {
  const { userId: actorId } = await requireRole("ADMIN_IT", "PROCUREMENT");
  const parsed = receiveSchema.safeParse({
    assetId: formData.get("assetId"),
    tag: formData.get("tag"),
    condition: formData.get("condition"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) {
    return { ok: false, message: TAG_REQUIRED_MESSAGE };
  }
  return runTransition(parsed.data.assetId, AssetStatus.IN_STOCK, actorId, {
    tag: parsed.data.tag,
    condition: parsed.data.condition,
    notes: parsed.data.notes,
    successMessage: `Received and tagged ${parsed.data.tag}.`,
  });
}

export async function sendToRepair(
  _previous: AssetActionState,
  formData: FormData,
): Promise<AssetActionState> {
  const { userId: actorId } = await requireRole("ADMIN_IT", "PROCUREMENT");
  const parsed = repairSchema.safeParse({
    assetId: formData.get("assetId"),
    condition: formData.get("condition"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) {
    return { ok: false, message: INVALID_FIELDS_MESSAGE };
  }
  return runTransition(parsed.data.assetId, AssetStatus.IN_REPAIR, actorId, {
    condition: parsed.data.condition,
    notes: parsed.data.notes,
    successMessage: "Sent to repair.",
  });
}

export async function returnFromRepair(
  _previous: AssetActionState,
  formData: FormData,
): Promise<AssetActionState> {
  const { userId: actorId } = await requireRole("ADMIN_IT", "PROCUREMENT");
  const parsed = repairSchema.safeParse({
    assetId: formData.get("assetId"),
    condition: formData.get("condition"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) {
    return { ok: false, message: INVALID_FIELDS_MESSAGE };
  }
  return runTransition(parsed.data.assetId, AssetStatus.IN_STOCK, actorId, {
    condition: parsed.data.condition,
    notes: parsed.data.notes,
    successMessage: "Returned to stock.",
  });
}

/** RETIRED is the delete: no asset row is ever removed (PLAN.md §Decisions 1). */
export async function retireAsset(
  _previous: AssetActionState,
  formData: FormData,
): Promise<AssetActionState> {
  const { userId: actorId } = await requireRole("ADMIN_IT", "PROCUREMENT");
  const parsed = retireSchema.safeParse({
    assetId: formData.get("assetId"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) {
    return { ok: false, message: INVALID_FIELDS_MESSAGE };
  }
  return runTransition(parsed.data.assetId, AssetStatus.RETIRED, actorId, {
    notes: parsed.data.notes,
    successMessage: "Asset retired.",
  });
}

async function runTransition(
  assetId: string,
  toStatus: AssetStatus,
  actorId: string,
  options: {
    tag?: string;
    condition?: AssetCondition | null;
    notes?: string | null;
    successMessage: string;
  },
): Promise<AssetActionState> {
  try {
    await transitionAssetStatus(getDb(), {
      assetId,
      toStatus,
      tag: options.tag,
      condition: options.condition,
      notes: options.notes,
      actorId,
    });
  } catch (error) {
    const failure = mapAssetError(error);
    if (!failure) throw error;
    return failure;
  }
  revalidateAsset(assetId);
  return { ok: true, message: options.successMessage };
}
