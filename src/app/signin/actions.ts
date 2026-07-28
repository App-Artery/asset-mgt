"use server";

import { z } from "zod";
import { signIn } from "@/auth";

export type SignInFormState = { sent: boolean };

// Normalise before validation (LEARNINGS §Zod): trim + lowercase, then shape.
const emailSchema = z.preprocess(
  (value) => (typeof value === "string" ? value.trim().toLowerCase() : value),
  z.email(),
);

/**
 * Requests a magic link and returns the SAME state for every outcome —
 * success, unknown email, deactivated user, throttled, malformed input. The
 * server-side `signIn` throws AccessDenied when the sign-in policy rejects
 * (raw mode rethrows AuthError); swallowing it here is what closes the
 * enumeration oracle. Do not add distinct error states to this action.
 *
 * Public by design: this is the one unauthenticated mutation in the app, so
 * it deliberately has no requireRole — abuse is bounded by the sign-in
 * throttle (src/lib/sign-in-policy.ts), not by authorisation.
 */
export async function requestSignIn(
  _previous: SignInFormState,
  formData: FormData,
): Promise<SignInFormState> {
  const parsed = emailSchema.safeParse(formData.get("email"));
  if (parsed.success) {
    try {
      await signIn("resend", { email: parsed.data, redirect: false });
    } catch {
      // Intentionally identical to success — see above.
    }
  }
  return { sent: true };
}
