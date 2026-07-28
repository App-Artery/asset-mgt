import { auth } from "@/auth";

export default async function HomePage() {
  const session = await auth();

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-3xl font-semibold tracking-tight">Asset Register</h1>
      <p className="text-muted-foreground text-center">
        Application skeleton — stories AM-01…AM-07 build on this.
      </p>
      {session?.user?.email ? (
        <p className="text-sm">
          Signed in as <span className="font-medium">{session.user.email}</span>
        </p>
      ) : null}
    </main>
  );
}
