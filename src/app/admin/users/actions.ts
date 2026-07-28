"use server";

import { revalidatePath } from "next/cache";
import { Prisma, Role } from "@prisma/client";
import { z } from "zod";
import { requireRole } from "@/lib/authz";
import { getDb } from "@/lib/db";
import {
  LastAdminError,
  changeUserRole,
  createUserWithEvent,
  setUserActivation,
} from "@/lib/user-admin";

export type UserActionState = { ok: boolean; message: string } | null;

// Normalise before validation (LEARNINGS §Zod).
const emailField = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
  z.email(),
);

const createUserSchema = z.object({
  name: z.string().trim().min(1),
  email: emailField,
  // Empty string → null: employeeRef is optional and unique.
  employeeRef: z.preprocess(
    (value) =>
      typeof value === "string" && value.trim() === "" ? null : value,
    z.string().trim().min(1).nullable(),
  ),
  role: z.enum(Role),
});

const changeRoleSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(Role),
});

const activationSchema = z.object({
  userId: z.string().min(1),
});

function isUniqueViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  );
}

export async function createUser(
  _previous: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const { userId: actorId } = await requireRole("ADMIN_IT");
  const parsed = createUserSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    employeeRef: formData.get("employeeRef"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return { ok: false, message: "Enter a name, a valid email and a role." };
  }
  try {
    await createUserWithEvent(getDb(), { ...parsed.data, actorId });
  } catch (error) {
    if (isUniqueViolation(error)) {
      return {
        ok: false,
        message: "A user with that email or employee reference already exists.",
      };
    }
    throw error;
  }
  revalidatePath("/admin/users");
  return { ok: true, message: `Added ${parsed.data.email}.` };
}

export async function changeRole(
  _previous: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const { userId: actorId } = await requireRole("ADMIN_IT");
  const parsed = changeRoleSchema.safeParse({
    userId: formData.get("userId"),
    role: formData.get("role"),
  });
  if (!parsed.success) {
    return { ok: false, message: "Invalid role change request." };
  }
  try {
    await changeUserRole(getDb(), {
      subjectId: parsed.data.userId,
      toRole: parsed.data.role,
      actorId,
    });
  } catch (error) {
    if (error instanceof LastAdminError) {
      return {
        ok: false,
        message: "Rejected: this would leave no active IT admin.",
      };
    }
    throw error;
  }
  revalidatePath("/admin/users");
  return { ok: true, message: "Role updated." };
}

export async function deactivateUser(
  _previous: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const { userId: actorId } = await requireRole("ADMIN_IT");
  const parsed = activationSchema.safeParse({ userId: formData.get("userId") });
  if (!parsed.success) {
    return { ok: false, message: "Invalid request." };
  }
  try {
    await setUserActivation(getDb(), {
      subjectId: parsed.data.userId,
      deactivated: true,
      actorId,
    });
  } catch (error) {
    if (error instanceof LastAdminError) {
      return {
        ok: false,
        message: "Rejected: this would leave no active IT admin.",
      };
    }
    throw error;
  }
  revalidatePath("/admin/users");
  return { ok: true, message: "User deactivated." };
}

export async function reactivateUser(
  _previous: UserActionState,
  formData: FormData,
): Promise<UserActionState> {
  const { userId: actorId } = await requireRole("ADMIN_IT");
  const parsed = activationSchema.safeParse({ userId: formData.get("userId") });
  if (!parsed.success) {
    return { ok: false, message: "Invalid request." };
  }
  await setUserActivation(getDb(), {
    subjectId: parsed.data.userId,
    deactivated: false,
    actorId,
  });
  revalidatePath("/admin/users");
  return { ok: true, message: "User reactivated." };
}
