import Link from "next/link";
import { requireRole } from "@/lib/authz";
import { getDb } from "@/lib/db";
import { AddUserForm } from "./add-user-form";
import { UsersTable, type AdminUserRow } from "./users-table";

export default async function AdminUsersPage() {
  const { userId } = await requireRole("ADMIN_IT");

  const users = await getDb().user.findMany({
    orderBy: { email: "asc" },
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      deactivatedAt: true,
      person: { select: { employeeRef: true } },
    },
  });
  const rows: AdminUserRow[] = users.map((user) => ({
    id: user.id,
    name: user.name,
    email: user.email,
    employeeRef: user.person?.employeeRef ?? null,
    role: user.role,
    deactivated: user.deactivatedAt !== null,
  }));

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-8 p-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
        <div className="flex items-baseline gap-4 text-sm">
          <Link
            href="/admin/reference"
            className="underline underline-offset-4"
          >
            Reference data
          </Link>
          <Link href="/" className="underline underline-offset-4">
            Home
          </Link>
        </div>
      </div>
      <UsersTable users={rows} currentAdminId={userId} />
      <AddUserForm />
    </main>
  );
}
