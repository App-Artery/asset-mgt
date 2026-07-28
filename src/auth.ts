import "server-only";
import NextAuth from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Resend from "next-auth/providers/resend";
import { authConfig } from "@/auth.config";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * Full Auth.js configuration for Node contexts (route handlers, server
 * components, server actions). The config is built lazily per request so that
 * `next build` succeeds with no environment populated (env chokepoint rule).
 *
 * Sessions are JWT (docs/DESIGN.md); the Prisma adapter handles users and
 * verification tokens for the Resend magic-link flow.
 *
 * AM-01 implements the real auth story on top of this skeleton. One rule is
 * already binding: there is NO open signup — magic links issue only for
 * provisioned users, and unknown emails get a generic failure.
 */
export const { handlers, auth, signIn, signOut } = NextAuth(() => ({
  ...authConfig,
  adapter: PrismaAdapter(getDb()),
  secret: env().AUTH_SECRET,
  providers: [
    Resend({
      apiKey: env().AUTH_RESEND_KEY,
      from: env().AUTH_EMAIL_FROM,
    }),
  ],
  callbacks: {
    ...authConfig.callbacks,
    // No open signup: only emails already provisioned in the User table may
    // sign in. The adapter would otherwise auto-create users on first
    // magic-link request. Staff are seeded (AM-01), never self-registered.
    async signIn({ user }) {
      if (!user.email) {
        return false;
      }
      const provisioned = await getDb().user.findUnique({
        where: { email: user.email },
        select: { id: true },
      });
      return provisioned !== null;
    },
  },
}));
