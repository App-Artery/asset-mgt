"use server";

import { revalidatePath } from "next/cache";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/authz";
import { getDb } from "@/lib/db";

export type ReferenceActionState = { ok: boolean; message: string } | null;

type ReferenceKind = "category" | "site";

// Normalise before validation (LEARNINGS §Zod: .transform() runs after the
// validators, so a padded name would fail .min(1) before anything trimmed it).
const nameField = z.preprocess(
  (value) => (typeof value === "string" ? value.trim() : value),
  z.string().min(1).max(120),
);

const createSchema = z.object({ name: nameField });
const renameSchema = z.object({ id: z.string().min(1), name: nameField });

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

// There is no delete action here, and there will not be one: a Category or
// Site with assets attached must not be able to vanish out from under their
// history — the same argument that makes Asset RETIRED-not-deleted and User
// deactivated-not-deleted. Renaming is the correction path.

export async function createCategory(
  _previous: ReferenceActionState,
  formData: FormData,
): Promise<ReferenceActionState> {
  await requireRole("ADMIN_IT");
  return createNamed("category", formData);
}

export async function renameCategory(
  _previous: ReferenceActionState,
  formData: FormData,
): Promise<ReferenceActionState> {
  await requireRole("ADMIN_IT");
  return renameNamed("category", formData);
}

export async function createSite(
  _previous: ReferenceActionState,
  formData: FormData,
): Promise<ReferenceActionState> {
  await requireRole("ADMIN_IT");
  return createNamed("site", formData);
}

export async function renameSite(
  _previous: ReferenceActionState,
  formData: FormData,
): Promise<ReferenceActionState> {
  await requireRole("ADMIN_IT");
  return renameNamed("site", formData);
}

async function createNamed(
  kind: ReferenceKind,
  formData: FormData,
): Promise<ReferenceActionState> {
  const parsed = createSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { ok: false, message: `Enter a ${kind} name.` };
  }
  const { name } = parsed.data;
  const db = getDb();
  try {
    if (kind === "category") {
      await db.category.create({ data: { name } });
    } else {
      await db.site.create({ data: { name } });
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        ok: false,
        message: `A ${kind} with that name already exists.`,
      };
    }
    throw error;
  }
  revalidatePath("/admin/reference");
  return { ok: true, message: `Added ${name}.` };
}

async function renameNamed(
  kind: ReferenceKind,
  formData: FormData,
): Promise<ReferenceActionState> {
  const parsed = renameSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
  });
  if (!parsed.success) {
    return { ok: false, message: `Enter a ${kind} name.` };
  }
  const { id, name } = parsed.data;
  const db = getDb();
  try {
    // Update by id only: renaming never re-points the assets attached to this
    // row, it relabels the row they already reference.
    if (kind === "category") {
      await db.category.update({ where: { id }, data: { name } });
    } else {
      await db.site.update({ where: { id }, data: { name } });
    }
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        ok: false,
        message: `A ${kind} with that name already exists.`,
      };
    }
    throw error;
  }
  revalidatePath("/admin/reference");
  return { ok: true, message: `Renamed to ${name}.` };
}
