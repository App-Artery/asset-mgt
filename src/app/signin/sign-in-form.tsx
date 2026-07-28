"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { SignInFormState } from "./actions";

/**
 * The one message every sign-in attempt renders — success, unknown email,
 * deactivated user, throttled. Also shown by the /signin?sent=1 page state
 * (Auth.js verifyRequest target). Never branch the copy on the outcome.
 */
export const SENT_MESSAGE =
  "If your address is registered, a sign-in link has been sent. " +
  "Check your inbox — the link is valid for 15 minutes.";

export function SignInForm({
  action,
}: {
  action: (
    previous: SignInFormState,
    formData: FormData,
  ) => Promise<SignInFormState>;
}) {
  const [state, formAction, pending] = useActionState(action, { sent: false });

  if (state.sent) {
    return (
      <p role="status" className="text-muted-foreground text-sm">
        {SENT_MESSAGE}
      </p>
    );
  }

  return (
    <form action={formAction} className="flex w-full flex-col gap-3">
      <Label htmlFor="email">Work email</Label>
      <Input
        id="email"
        name="email"
        type="email"
        required
        autoComplete="email"
        placeholder="you@example.com"
        disabled={pending}
      />
      <Button type="submit" disabled={pending}>
        {pending ? "Sending…" : "Email me a sign-in link"}
      </Button>
    </form>
  );
}
