"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { AssetCondition, AssetStatus } from "@prisma/client";
import { z } from "zod";
import {
  INITIAL_ASSET_STATUSES,
  RETURN_STATUSES,
  assignAsset as assignAssetRecord,
  createAssetWithEvent,
  returnAsset as returnAssetRecord,
  transitionAssetStatus,
  updateAssetWithEvent,
} from "@/lib/asset-admin";
import {
  CONDITION_NOTES_REQUIRED_MESSAGE,
  INVALID_FIELDS_MESSAGE,
  TAG_REQUIRED_MESSAGE,
  mapAssetError,
} from "@/lib/asset-errors";
import { conditionNotesRequiredFor } from "@/lib/asset-lifecycle";
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

const assignSchema = z.object({
  assetId: z.string().min(1),
  personId: z.string().min(1),
  notes: optionalText,
});

// Condition is MANDATORY on every return — it is the structured answer to
// "in what state" (AC-2), and z.enum rejects the empty string a "not recorded"
// option would submit. The free-text note is required only where it carries
// information; conditionNotesRequiredFor is shared with the form so the UI's
// required marker and this guard cannot drift apart.
const returnSchema = z
  .object({
    assetId: z.string().min(1),
    toStatus: z.enum(RETURN_STATUSES),
    condition: z.enum(AssetCondition),
    conditionNotes: optionalText,
  })
  .refine(
    (data) =>
      !conditionNotesRequiredFor(data.toStatus, data.condition) ||
      data.conditionNotes !== null,
    { path: ["conditionNotes"], message: "A condition note is required." },
  );

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

function revalidateAsset(assetId: string): void {
  revalidatePath("/assets");
  revalidatePath(`/assets/${assetId}`);
}

/**
 * Assignment changes who holds what, so the person views go stale too — and
 * they are separate routes with their own caches. `/people/[id]` is revalidated
 * by route pattern rather than by id: a return has closed the assignment by the
 * time we get here, and re-reading the row just to name one path would be a
 * query in service of a cache hint.
 *
 * All of this runs OUTSIDE the transaction, deliberately: nothing slow belongs
 * inside AM-03's transactions, which are the longest in the codebase and run
 * against Prisma's default 5s interactive-transaction timeout.
 */
function revalidateAssignment(assetId: string): void {
  revalidateAsset(assetId);
  revalidatePath("/me/assignments");
  revalidatePath("/people/[id]", "page");
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
  // Redirect rather than returning a success state. Staying on a populated
  // /assets/new means a second click creates a byte-identical row, and for an
  // untagged ON_ORDER asset there is nothing to tell the two apart — with no
  // delete path, the only remedy is retiring one permanently. Redirect throws
  // NEXT_REDIRECT, which is not an application error: it must escape the
  // try/catch above, so it sits outside it deliberately.
  redirect(`/assets/${assetId}`);
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
    // Only a bad/missing tag earns the tag message. A malformed assetId is not
    // a tagging problem, and reporting it as one sends the operator hunting for
    // a tag that was never the issue.
    const tagAtFault = parsed.error.issues.some(
      (issue) => issue.path[0] === "tag",
    );
    return {
      ok: false,
      message: tagAtFault ? TAG_REQUIRED_MESSAGE : INVALID_FIELDS_MESSAGE,
    };
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

/**
 * Hands an asset to a member of staff. IN_STOCK -> ASSIGNED.
 *
 * ADMIN_IT + PROCUREMENT, identical to every other write action here: both
 * roles already see person names and employeeRef under personSelectFor, so this
 * grants no visibility the read gate does not, and procurement handing out
 * newly received kit is a real workflow (AM-03 DESIGN §2.2, approved).
 */
export async function assignAssetToPerson(
  _previous: AssetActionState,
  formData: FormData,
): Promise<AssetActionState> {
  const { userId: actorId } = await requireRole("ADMIN_IT", "PROCUREMENT");
  const parsed = assignSchema.safeParse({
    assetId: formData.get("assetId"),
    personId: formData.get("personId"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) {
    return { ok: false, message: INVALID_FIELDS_MESSAGE };
  }
  try {
    await assignAssetRecord(getDb(), { ...parsed.data, actorId });
  } catch (error) {
    const failure = mapAssetError(error);
    if (!failure) throw error;
    return failure;
  }
  revalidateAssignment(parsed.data.assetId);
  return { ok: true, message: "Asset assigned." };
}

/**
 * Takes an asset back. ASSIGNED -> IN_STOCK, or ASSIGNED -> IN_REPAIR for the
 * repair-bound return of AC-2.
 *
 * Note there is no separate "send an assigned asset to repair" action: on an
 * ASSIGNED asset that IS this action with toStatus=IN_REPAIR, so the closing of
 * the assignment and the status change stay one transaction and one event.
 */
export async function returnAssetFromPerson(
  _previous: AssetActionState,
  formData: FormData,
): Promise<AssetActionState> {
  const { userId: actorId } = await requireRole("ADMIN_IT", "PROCUREMENT");
  const parsed = returnSchema.safeParse({
    assetId: formData.get("assetId"),
    toStatus: formData.get("toStatus"),
    condition: formData.get("condition"),
    conditionNotes: formData.get("conditionNotes"),
  });
  if (!parsed.success) {
    // A missing condition note is a specific, fixable thing — saying only
    // "check the form" sends the operator looking at the fields that are fine.
    const notesAtFault = parsed.error.issues.some(
      (issue) => issue.path[0] === "conditionNotes",
    );
    return {
      ok: false,
      message: notesAtFault
        ? CONDITION_NOTES_REQUIRED_MESSAGE
        : INVALID_FIELDS_MESSAGE,
    };
  }
  try {
    await returnAssetRecord(getDb(), { ...parsed.data, actorId });
  } catch (error) {
    const failure = mapAssetError(error);
    if (!failure) throw error;
    return failure;
  }
  revalidateAssignment(parsed.data.assetId);
  return {
    ok: true,
    message:
      parsed.data.toStatus === AssetStatus.IN_REPAIR
        ? "Returned and sent to repair."
        : "Returned to stock.",
  };
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
      // These AM-02 actions predate assignment, and on an ASSIGNED asset the
      // write layer closes the open assignment for them. The UI never offers
      // them there — but a STALE FORM does: an operator holding a detail page
      // that still says IN_STOCK, on an asset someone else has since assigned,
      // clicks "Send to repair" and closes a real assignment. Carrying the
      // operator's note onto the closing record means that path documents
      // itself instead of writing a silent null.
      conditionNotes: options.notes,
      actorId,
    });
  } catch (error) {
    const failure = mapAssetError(error);
    if (!failure) throw error;
    return failure;
  }
  // Cheap and correct on every path: these actions cannot know whether the
  // write layer closed an assignment, and revalidating a person view that did
  // not change costs nothing next to showing a stale holder.
  revalidateAssignment(assetId);
  return { ok: true, message: options.successMessage };
}
