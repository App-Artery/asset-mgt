import NextAuth from "next-auth";
import { edgeAuthConfig } from "@/auth.edge";

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
 * `edgeAuthConfig` is passed as a FUNCTION, never called here. The object form
 * of NextAuth() runs `setEnvDefaults` at module scope, reading AUTH_SECRET
 * once per edge isolate at module evaluation; the function form defers it to
 * request time, which is also the only form in which the factory's throw does
 * not fire during a zero-env build. Why the secret is handled there rather
 * than here, and what is and is not known about the production failure it
 * fixes, is documented in src/auth.edge.ts (issue #14).
 */
export default NextAuth(edgeAuthConfig).auth;

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
