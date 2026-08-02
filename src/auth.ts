import "server-only";
import NextAuth, { type NextAuthConfig } from "next-auth";
import { PrismaAdapter } from "@auth/prisma-adapter";
import Resend from "next-auth/providers/resend";
import { authConfig } from "@/auth.config";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { isSignInAllowed } from "@/lib/sign-in-policy";

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
 *
 * Still the lazy factory form NextAuth requires (CLAUDE.md) — named and
 * exported only so a test can read the provider list without standing up an
 * HTTP request.
 *
 * `/admin/users` reads `User.emailVerified` as "last successful magic-link
 * sign-in", which is only true while the magic link is the ONLY way in: the
 * adapter writes that column from the `account.type === "email"` branch alone.
 * `src/auth.providers.test.ts` pins the provider count to one so that adding
 * an OAuth or WebAuthn provider fails loudly here rather than quietly turning
 * that column into a lie (issue #11).
 */
export function authOptions(): NextAuthConfig {
  return {
    ...authConfig,
    adapter: PrismaAdapter(getDb()),
    secret: env().AUTH_SECRET,
    providers: [
      Resend({
        apiKey: env().AUTH_RESEND_KEY,
        from: env().AUTH_EMAIL_FROM,
        // Magic-link TTL 15 minutes: delivery is seconds; the Auth.js 24h
        // default is needless exposure (AM-01 design).
        maxAge: 15 * 60,
      }),
    ],
    callbacks: {
      ...authConfig.callbacks,
      // No open signup: magic links issue only for provisioned, active users,
      // and send bursts are throttled (src/lib/sign-in-policy.ts). All
      // rejections return false — indistinguishable AccessDenied — because the
      // uniform /signin UX must not leak which addresses are registered.
      async signIn({ user, email }) {
        return isSignInAllowed(getDb(), user.email, {
          verificationRequest: email?.verificationRequest === true,
        });
      },
    },
  };
}

export const { handlers, auth, signIn, signOut } = NextAuth(authOptions);
