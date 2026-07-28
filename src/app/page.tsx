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
  const isActiveAdmin =
    user !== null && user.role === "ADMIN_IT" && user.deactivatedAt === null;

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-3xl font-semibold tracking-tight">Asset Register</h1>
      <p className="text-sm">
        Signed in as{" "}
        <span className="font-medium">{user?.name ?? user?.email}</span>{" "}
        <span className="text-muted-foreground">({user?.role})</span>
      </p>
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
