import "server-only";
import {
  Prisma,
  Role,
  UserEventType,
  type PrismaClient,
  type User,
} from "@prisma/client";

/**
 * User provisioning/role/status mutations. Only the server actions in
 * src/app/admin/users/actions.ts (behind requireRole) and the seed script
 * call these. Every mutation writes its UserEvent IN THE SAME TRANSACTION —
 * a mutation that commits without its audit row must be impossible.
 */

/** Rejection of a demotion/deactivation that would leave zero active admins. */
export class LastAdminError extends Error {
  constructor() {
    super("Operation would leave no active ADMIN_IT user");
    this.name = "LastAdminError";
  }
}

type Tx = Prisma.TransactionClient;

/**
 * Locks every active admin row (`SELECT … FOR UPDATE`) and returns their ids.
 * All role/status mutations take these locks first, which is what makes the
 * last-admin guard race-safe: a concurrent demotion/deactivation blocks here
 * until the first transaction commits, and READ COMMITTED then re-evaluates
 * the predicate on wake — a just-demoted admin drops out of the set, so the
 * second transaction counts only true survivors.
 */
async function lockActiveAdmins(tx: Tx): Promise<string[]> {
  const rows = await tx.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "User"
    WHERE "role" = 'ADMIN_IT'::"Role" AND "deactivatedAt" IS NULL
    FOR UPDATE`;
  return rows.map((row) => row.id);
}

export async function createUserWithEvent(
  db: PrismaClient,
  input: {
    name: string;
    email: string;
    employeeRef: string | null;
    role: Role;
    actorId: string;
  },
): Promise<User> {
  // Lowercase at every write — a case mismatch silently locks out staff.
  const email = input.email.trim().toLowerCase();
  return db.$transaction(async (tx) => {
    const person = await tx.person.create({
      data: { name: input.name, email, employeeRef: input.employeeRef },
    });
    const user = await tx.user.create({
      data: { name: input.name, email, role: input.role, personId: person.id },
    });
    await tx.userEvent.create({
      data: {
        userId: user.id,
        actorId: input.actorId,
        type: UserEventType.CREATED,
        toRole: input.role,
      },
    });
    return user;
  });
}

export async function changeUserRole(
  db: PrismaClient,
  input: { subjectId: string; toRole: Role; actorId: string },
): Promise<User> {
  return db.$transaction(async (tx) => {
    const activeAdminIds = await lockActiveAdmins(tx);
    const subject = await tx.user.findUnique({
      where: { id: input.subjectId },
      select: { role: true, deactivatedAt: true },
    });
    if (!subject) {
      throw new Error(`User ${input.subjectId} not found`);
    }
    if (subject.role === input.toRole) {
      // No-op change: no mutation, so no event (the audit trail records
      // transitions, not clicks).
      return tx.user.findUniqueOrThrow({ where: { id: input.subjectId } });
    }
    const demotesActiveAdmin =
      subject.role === Role.ADMIN_IT && subject.deactivatedAt === null;
    if (
      demotesActiveAdmin &&
      activeAdminIds.filter((id) => id !== input.subjectId).length === 0
    ) {
      throw new LastAdminError();
    }
    const updated = await tx.user.update({
      where: { id: input.subjectId },
      data: { role: input.toRole },
    });
    await tx.userEvent.create({
      data: {
        userId: input.subjectId,
        actorId: input.actorId,
        type: UserEventType.ROLE_CHANGED,
        fromRole: subject.role,
        toRole: input.toRole,
      },
    });
    return updated;
  });
}

export async function setUserActivation(
  db: PrismaClient,
  input: { subjectId: string; deactivated: boolean; actorId: string },
): Promise<User> {
  return db.$transaction(async (tx) => {
    const activeAdminIds = await lockActiveAdmins(tx);
    const subject = await tx.user.findUnique({
      where: { id: input.subjectId },
      select: { role: true, deactivatedAt: true },
    });
    if (!subject) {
      throw new Error(`User ${input.subjectId} not found`);
    }
    const alreadyThere = (subject.deactivatedAt !== null) === input.deactivated;
    if (alreadyThere) {
      return tx.user.findUniqueOrThrow({ where: { id: input.subjectId } });
    }
    if (
      input.deactivated &&
      subject.role === Role.ADMIN_IT &&
      activeAdminIds.filter((id) => id !== input.subjectId).length === 0
    ) {
      throw new LastAdminError();
    }
    // Deactivation is a flag, never a delete (AssetEvent attribution).
    const updated = await tx.user.update({
      where: { id: input.subjectId },
      data: { deactivatedAt: input.deactivated ? new Date() : null },
    });
    await tx.userEvent.create({
      data: {
        userId: input.subjectId,
        actorId: input.actorId,
        type: input.deactivated
          ? UserEventType.DEACTIVATED
          : UserEventType.REACTIVATED,
      },
    });
    return updated;
  });
}
