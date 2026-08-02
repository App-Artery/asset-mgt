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
 * What fixes this is the lazy factory form, and the reason is WHEN the read
 * happens. `NextAuth(config)` with an OBJECT calls `setEnvDefaults`
 * immediately, which does `config.secret ??= process.env.AUTH_SECRET` — at
 * module scope. So the secret is read once per edge isolate at module
 * evaluation, and the result, `undefined` included, is then cached on the
 * shared `authConfig` object for that isolate's whole life. With the FUNCTION
 * form the same defaulting runs per request. Production showed an
 * 18-occurrence MissingSecret group on /middleware (2026-07-28 → 07-30) under
 * the object form; src/auth.ts has always used the function form and has
 * never shown it.
 *
 * The spread matters for the same reason: it stops `setEnvDefaults` mutating
 * the `authConfig` object that src/auth.ts also imports.
 *
 * `process.env.AUTH_SECRET` is written out as a literal static member access
 * on purpose — no destructuring, no computed key, no spreading `process.env`,
 * because only statically analysable references survive into an edge bundle.
 * Verified against the build rather than assumed: `.next/server/src/
 * middleware.js` contains the string `process.env.AUTH_SECRET` and does NOT
 * contain the secret's value, so this is a live read at the edge and nothing
 * is baked into a build artefact.
 *
 * The lazy form is also what keeps this inside the env rule: the read happens
 * per request, never at module top level, so `next build` still succeeds with
 * no environment populated (CI proves this every run).
 *
 * Fails closed, loudly, and server-side only. There is no fallback and no
 * derived default — that would silently invalidate every existing session
 * instead of saying so. A throw naming the variable is diagnosable in
 * minutes; the alternative is middleware decoding no session, treating every
 * request as anonymous, and bouncing every authenticated user to /signin,
 * which is indistinguishable from broken sign-in and cost a full debugging
 * session once already (Hobby-plan runtime logs retain one hour, so it has to
 * be caught live or not at all). /signin is excluded by the matcher below, so
 * it still renders and the uniform sign-in message is untouched — this adds
 * no user-visible error surface.
 */
export default NextAuth(() => {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "AUTH_SECRET is not set in the edge runtime. Middleware cannot verify " +
        "sessions without it and would treat every request as anonymous.",
    );
  }
  return { ...authConfig, secret };
}).auth;

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
