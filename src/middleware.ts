import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

/**
 * Deny-by-default authentication gate (docs/DESIGN.md security constraint 1).
 *
 * The matcher gates EVERYTHING except Auth.js routes and static assets. The
 * middleware only authenticates (session present or not) — authorisation is
 * always requireRole() reading the role from the DB inside the handler; the
 * JWT is never trusted for roles.
 *
 * Uses the edge-safe config only: no Prisma import may ever reach this file.
 *
 * ── Why `secret` is passed here, and read from process.env rather than env() ──
 *
 * This file does NOT share the env() chokepoint, and cannot: src/lib/env.ts
 * imports "server-only", so importing it here would break the edge bundle.
 * Middleware is the one place in the app that reads configuration directly.
 *
 * What actually fixes this is the lazy factory form, and the reason is WHEN
 * the read happens, not where the value comes from. Auth.js infers AUTH_SECRET
 * from the environment on its own — but under the previous eager
 * `NextAuth(authConfig)` call that inference ran at module initialisation of
 * the edge bundle, which is not a point at which the runtime environment is
 * reliably populated. Wrapping the config in a callback defers the whole
 * thing to request time, when it is. Production showed an 18-occurrence
 * MissingSecret group on /middleware (2026-07-28 → 07-30) under the eager
 * form (issue #14); src/auth.ts has always used the lazy form and has never
 * shown it.
 *
 * Verified against the built bundle, not assumed: `.next/server/src/
 * middleware.js` contains the string `process.env.AUTH_SECRET` and does NOT
 * contain the secret's value. So this is a live read in the edge runtime, and
 * no secret is baked into a build artefact.
 *
 * The failure mode is why this is worth pre-empting rather than watching: with
 * no secret, middleware decodes no session, sees every request as anonymous,
 * and bounces every authenticated user to /signin. That is indistinguishable
 * from a broken sign-in — a much larger and more alarming diagnosis, and it
 * cost a full debugging session once already. Hobby-plan runtime logs retain
 * one hour, so it has to be caught live or not at all.
 *
 * The lazy factory form is what keeps this inside the env rule: the read
 * happens per request inside the callback, never at module top level, so
 * `next build` still succeeds with no environment populated (CI proves this
 * every run). Same shape as src/auth.ts, which wraps env() the same way.
 */
export default NextAuth(() => ({
  ...authConfig,
  secret: process.env.AUTH_SECRET,
})).auth;

export const config = {
  // /signin is the ONLY public page (uniform magic-link flow, AM-01);
  // everything else stays behind the deny-by-default session gate. The
  // signin and api/auth exclusions are anchored with (?:/|$) so only the
  // exact segment (and its children, for api/auth) is public — a future
  // /signin-foo or /api/auth-foo route stays gated (advisor condition).
  matcher: [
    "/((?!api/auth(?:/|$)|signin(?:/|$)|_next/static|_next/image|favicon\\.ico).*)",
  ],
};
