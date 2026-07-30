import Link from "next/link";
import { redirect } from "next/navigation";
import { auth, signOut } from "@/auth";
import { getDb } from "@/lib/db";
import { Button } from "@/components/ui/button";

export default async function HomePage() {
  const session = await auth();
  if (!session?.user?.id) {
    redirect("/signin");
  }

  // Role comes from the DB, never the JWT — a runtime role change shows up on
  // the next request without re-login (AM-01 AC).
  const user = await getDb().user.findUnique({
    where: { id: session.user.id },
    select: { name: true, email: true, role: true, deactivatedAt: true },
  });
  // A deactivated (or deleted) user holding a still-valid JWT gets no page,
  // matching requireRole's kill-switch (advisor condition).
  if (!user || user.deactivatedAt !== null) {
    redirect("/signin");
  }
  const isActiveAdmin = user.role === "ADMIN_IT";

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-3xl font-semibold tracking-tight">Asset Register</h1>
      <p className="text-sm">
        Signed in as{" "}
        <span className="font-medium">{user.name ?? user.email}</span>{" "}
        <span className="text-muted-foreground">({user.role})</span>
      </p>
      {/* Every role reads the register — staff read-only, IT and procurement
          write. The page's own requireRole is what enforces that. */}
      <Link href="/assets" className="text-sm underline underline-offset-4">
        Asset register
      </Link>
      {/* Every role, including STAFF_RO: /me/assignments is self-scoped from the
          session, so it is the one place a read-only staff user sees assignment
          data — their own. Nothing here links to a /people/[id] view, which is
          role-gated to the three privileged roles (AM-03 DESIGN §5.1); those
          views are reached from the asset detail page's holder. */}
      <Link
        href="/me/assignments"
        className="text-sm underline underline-offset-4"
      >
        My assignments
      </Link>
      {isActiveAdmin ? (
        <Link
          href="/admin/users"
          className="text-sm underline underline-offset-4"
        >
          Manage users
        </Link>
      ) : null}
      <form
        action={async () => {
          "use server";
          // Sign-out is a session mutation on the caller's own cookie, not a
          // data mutation — the one action that deliberately has no
          // requireRole (any authenticated role may sign out).
          await signOut({ redirectTo: "/signin" });
        }}
      >
        <Button type="submit" variant="outline">
          Sign out
        </Button>
      </form>
    </main>
  );
}
