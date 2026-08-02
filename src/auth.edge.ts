import { authConfig } from "@/auth.config";

/**
 * The edge middleware's Auth.js config factory (issue #14).
 *
 * Lives in its own module, separate from src/middleware.ts, for one reason:
 * middleware.ts imports `next-auth`, and next-auth's `lib/env.js` does a bare
 * `import "next/server"` that Node's ESM resolver rejects under vitest —
 * Next's bundler resolves it, vitest does not. So importing middleware.ts in a
 * test fails to collect at all, and the secret handling would have no runtime
 * seam to assert against. Here it has one, and src/middleware.test.ts calls
 * this function directly.
 *
 * MUST stay edge-safe: no Prisma, no `server-only`, nothing Node-only, and in
 * particular NOT src/lib/env.ts — see below.
 *
 * ── Why process.env directly, and not env() ──
 *
 * The edge runtime does not share the env() chokepoint and cannot: src/lib/
 * env.ts imports "server-only", and zod-parses the whole of process.env,
 * demanding DATABASE_URL and AUTH_RESEND_KEY that the edge has no business
 * requiring. This AUTH_SECRET read is the single permitted inline read of
 * required config in the codebase (CLAUDE.md §Env chokepoint).
 *
 * Passing `secret` explicitly, from a factory rather than an object, does four
 * things: the secret is stated rather than inferred; a missing one fails
 * loudly and by name instead of silently degrading to anonymous; the spread
 * stops next-auth's `setEnvDefaults` mutating the shared `authConfig` object
 * that src/auth.ts also imports; and the read sits inside a function, per the
 * env rule, so `next build` still succeeds with no environment populated (CI
 * proves this every run). None of those depend on the history below.
 *
 * ── What went wrong in production, and what is still unexplained ──
 *
 * /middleware logged an 18-occurrence MissingSecret group between 2026-07-28
 * and 07-30, under a previous eager `NextAuth(authConfig)` call.
 *
 * The eager form does read earlier: `NextAuth(config)` with an OBJECT calls
 * `setEnvDefaults` immediately, doing `config.secret ??= process.env.
 * AUTH_SECRET` at module scope, so the value is read once per edge isolate at
 * module evaluation and cached — `undefined` included — for that isolate's
 * life. But that explains PERSISTENCE, not onset or cessation: within one
 * deployment the env snapshot is fixed, so a present secret is read the same
 * either way. Caching cannot start or stop a three-day window on its own.
 *
 * The cause is therefore NOT established. The leading hypothesis is that the
 * deployments serving that window predate AUTH_SECRET existing, or being
 * scoped to Production — prod was created 2026-07-28 and AM-03 merged 07-30,
 * and a redeploy is the only thing that changes the env snapshot without a
 * code change. Eighteen occurrences over three days is far too few for "every
 * request to a gated route failed", which is what a serving deployment with no
 * secret would produce; it fits a handful of manual requests against early
 * setup deployments. A cold-start race in a minority of isolates is the
 * secondary candidate and cannot be excluded. Deployment and env-var creation
 * times would settle it.
 *
 * ── Why the spelling of the read is load-bearing ──
 *
 * `process.env.AUTH_SECRET` is a literal static member access on purpose: no
 * destructuring, no computed key, no spreading process.env. Next substitutes
 * only the keys it declares and preserves arbitrary ones as live runtime
 * reads. Reproduce with a control, since "the value is absent from the bundle"
 * is equally consistent with "the build had no value to inline" — in
 * `.next/server/src/middleware.js`, `process.env.NODE_ENV` occurs 0 times
 * while `process.env.AUTH_SECRET` is present. Zero NODE_ENV in a bundle
 * carrying React, Next, next-auth and @auth/core proves substitution ran and
 * skipped AUTH_SECRET. So this is a live edge read, and no secret is baked
 * into a build artefact.
 *
 * ── Failing closed ──
 *
 * No fallback and no derived default — that would silently invalidate every
 * existing session rather than say so. A throw naming the variable is
 * diagnosable in minutes; the alternative is middleware decoding no session,
 * treating every request as anonymous, and bouncing every authenticated user
 * to /signin, which is indistinguishable from broken sign-in and cost a full
 * debugging session once already (Hobby-plan runtime logs retain one hour, so
 * it has to be caught live or not at all).
 *
 * Be clear about what the throw costs. next-auth awaits this factory once per
 * request and does not catch it (`next-auth/lib/index.js`, the `await
 * config(req)` in `initAuth`), so with AUTH_SECRET absent the middleware
 * rejects and EVERY GATED ROUTE RETURNS 500 until the variable is restored.
 * That is the intended trade: a loud, obviously-broken deployment beats a
 * quietly anonymous one. What stays server-side is the MESSAGE — the string
 * below goes to the runtime log; the response carries Next's generic 500, not
 * the name of the missing variable.
 *
 * /signin is excluded by the middleware matcher, so it is not among the routes
 * that 500: it still renders, and its one uniform message for every sign-in
 * outcome (CLAUDE.md §sign-in throttle) is untouched. The failure surfaces on
 * the gated app, never as a new distinguishable state in the sign-in flow.
 *
 * The throw can only live in a factory: evaluated eagerly it would fire at
 * module evaluation, which is exactly when a zero-env build touches this
 * module.
 */
export function edgeAuthConfig() {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "AUTH_SECRET is not set in the edge runtime. Middleware cannot verify " +
        "sessions without it and would treat every request as anonymous.",
    );
  }
  return { ...authConfig, secret };
}
