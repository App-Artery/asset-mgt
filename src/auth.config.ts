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
  session: { strategy: "jwt" },
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
