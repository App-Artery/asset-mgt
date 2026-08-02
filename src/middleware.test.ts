import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Source-shape guards on the edge middleware (issue #14).
 *
 * These read the file rather than the module, and that is deliberate: what
 * this defends is a property of how `NextAuth` is CALLED, which is erased once
 * the module is imported and only the returned handler is in hand. There is no
 * runtime seam here to assert against.
 *
 * **What these cannot prove.** That the deployed edge runtime actually
 * resolves `AUTH_SECRET`. Only a real deployment shows that, and the symptom
 * of failure — every authenticated user bounced to /signin — is
 * indistinguishable from broken sign-in, which is the whole reason #14 was
 * worth pre-empting. These guards defend the code shape that was found to fix
 * it; they are not a substitute for checking prod after deploy.
 *
 * They are still worth having, because the realistic regression is somebody
 * tidying the lazy factory back into the eager `NextAuth(authConfig)` call it
 * replaced — which reads clean, typechecks, builds, and silently reintroduces
 * the outage.
 */
describe("middleware auth construction", () => {
  // Comments are stripped before matching, and finding that out cost a red
  // test: middleware.ts explains in prose why the eager `NextAuth(authConfig)`
  // form was replaced, and the negative assertion below matched the
  // explanation. A source guard that greps a whole file is asserting against
  // documentation as much as code — so this reads only the code.
  const source = readFileSync(
    path.resolve(import.meta.dirname, "middleware.ts"),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  it("reads AUTH_SECRET as a literal static member access", () => {
    // Only statically analysable references survive into an edge bundle, so
    // the spelling is load-bearing: no destructuring, no computed key, no
    // spreading process.env.
    expect(source).toMatch(/process\.env\.AUTH_SECRET/);
    expect(source).not.toMatch(/\{\s*AUTH_SECRET\s*\}\s*=\s*process\.env/);
    expect(source).not.toMatch(/process\.env\[/);
  });

  it("passes the secret into the config", () => {
    // Auth.js infers AUTH_SECRET on its own, so the absence of this is
    // invisible until the inference fails in the edge runtime.
    expect(source).toMatch(/\.\.\.authConfig,\s*secret\b/);
  });

  it("constructs NextAuth with the lazy factory form", () => {
    // The object form calls setEnvDefaults immediately, which does
    // `config.secret ??= process.env.AUTH_SECRET` at module scope — reading
    // once per edge isolate at module evaluation and caching the result,
    // undefined included, on the shared authConfig object. The function form
    // defers it to request time. This is the actual fix for #14, and the thing
    // most likely to be "simplified" away.
    expect(source).toMatch(/NextAuth\(\s*\(\s*\)\s*=>/);
    expect(source).not.toMatch(/NextAuth\(\s*authConfig\s*\)/);
  });

  it("fails closed when the secret is absent", () => {
    // No fallback and no derived default, ever: a derived secret would
    // silently invalidate every existing session rather than say so. The
    // throw is server-side only — /signin is excluded by the matcher, so the
    // uniform sign-in message is untouched.
    expect(source).toMatch(/if\s*\(\s*!secret\s*\)/);
    expect(source).toMatch(/throw new Error\(/);
    expect(source).toMatch(/AUTH_SECRET is not set/);
  });

  it("has no fallback secret", () => {
    // Added because red-proving found the gap: with only the throw asserted
    // above, `process.env.AUTH_SECRET ?? "dev-secret"` passed every test in
    // this file. The throw becomes unreachable and middleware silently signs
    // sessions with a known value — the worst outcome of the three, and the
    // one the guards were least equipped to see.
    expect(source).not.toMatch(/process\.env\.AUTH_SECRET\s*(\?\?|\|\|)/);
  });

  it("does not import the env() chokepoint", () => {
    // src/lib/env.ts imports "server-only". Pulling it in here would break the
    // edge bundle — middleware is the one file where going through env() is
    // the wrong answer (CLAUDE.md §Env chokepoint).
    expect(source).not.toMatch(/from\s+["']@\/lib\/env["']/);
  });
});
