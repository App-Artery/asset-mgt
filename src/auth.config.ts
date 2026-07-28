import type { NextAuthConfig } from "next-auth";

/**
 * Edge-safe Auth.js configuration — consumed by src/middleware.ts.
 *
 * MUST NOT import Prisma, `server-only`, or anything Node-only, and must not
 * read env at module top level. Providers live in src/auth.ts (Node contexts);
 * middleware only ever checks session presence — it authenticates, it never
 * authorises (roles are read from the DB inside handlers via requireRole).
 */
export const authConfig = {
  providers: [],
  // 14 days: the JWT carries identity only (roles/active-status are DB-read
  // per request), but a stolen field phone still shouldn't hold a month of
  // access (AM-01 design).
  session: { strategy: "jwt", maxAge: 14 * 24 * 3600 },
  // All auth UX lands on /signin — the default Auth.js pages are an
  // enumeration oracle (unknown email → visible AccessDenied) and are not
  // used. Error/verify states map to the same uniform page.
  pages: {
    signIn: "/signin",
    verifyRequest: "/signin?sent=1",
    error: "/signin",
  },
  callbacks: {
    authorized({ auth }) {
      // Deny-by-default: any matched route requires a session. Authorisation
      // (roles) is NOT decided here.
      return Boolean(auth?.user);
    },
    jwt({ token, user }) {
      if (user?.id) {
        token.sub = user.id;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
