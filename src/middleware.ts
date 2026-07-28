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
 */
export default NextAuth(authConfig).auth;

export const config = {
  // /signin is the ONLY public page (uniform magic-link flow, AM-01);
  // everything else stays behind the deny-by-default session gate.
  matcher: ["/((?!api/auth|signin|_next/static|_next/image|favicon\\.ico).*)"],
};
