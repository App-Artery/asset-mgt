import { requestSignIn } from "./actions";
import { SENT_MESSAGE, SignInForm } from "./sign-in-form";

/**
 * The only public page (middleware matcher exclusion). Auth.js redirects land
 * here too: verifyRequest → ?sent=1, every error → ?error=… — the error copy
 * stays generic (one line for all error codes) because the default Auth.js
 * pages are an enumeration oracle and distinct copy would reopen it.
 */
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ sent?: string; error?: string }>;
}) {
  const { sent, error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 p-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-2xl font-semibold tracking-tight">
          Asset Register
        </h1>
        <p className="text-muted-foreground text-sm">
          Sign in with your work email.
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-sm">
          That sign-in link is invalid or has expired. Enter your email to
          request a new one.
        </p>
      ) : null}
      {sent ? (
        <p role="status" className="text-muted-foreground text-sm">
          {SENT_MESSAGE}
        </p>
      ) : (
        <SignInForm action={requestSignIn} />
      )}
    </main>
  );
}
