import { AppBar } from "@/components/app-bar";
import { AppRail } from "@/components/app-rail";
import { requireRole } from "@/lib/authz";
import { getDb } from "@/lib/db";

/**
 * The application shell — chrome only (docs/DESIGN-SYSTEM.md §4).
 *
 * Its `requireRole` covers all four roles and exists to decide which nav items
 * to draw. It is NOT an authorisation boundary and does NOT protect the pages
 * beneath it: every page and every server action keeps its own `requireRole`,
 * exactly as before. Deleting a page's check because "the layout checks" is the
 * failure this comment exists to prevent — Next.js layouts do not re-run on
 * every navigation path, and a layout has never been a security boundary.
 *
 * It does inherit `requireRole`'s deactivation kill-switch, which is what
 * preserves the AM-01 advisor condition now that the old home page's
 * hand-rolled `deactivatedAt` check is gone. See layout.integration.test.tsx.
 *
 * /signin deliberately sits outside this group: a signed-out user gets no
 * navigation.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId, role } = await requireRole(
    "ADMIN_IT",
    "PROCUREMENT",
    "FINANCE",
    "STAFF_RO",
  );

  // Chrome-only projection: a display name and nothing else. No Person relation
  // is traversed here — this is the User row, and widening it would put person
  // data on the one component every role renders.
  const user = await getDb().user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });

  return (
    <div className="flex min-h-screen">
      <AppRail role={role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppBar name={user?.name ?? user?.email ?? "Account"} role={role} />
        {/* pb-20 below md leaves room for the fixed tab bar (AM-08 Task 5). */}
        <main className="flex flex-1 flex-col gap-6 p-4 pb-20 md:pb-6">
          {children}
        </main>
      </div>
    </div>
  );
}
