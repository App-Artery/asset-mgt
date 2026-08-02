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

  it("passes a secret explicitly", () => {
    // Auth.js infers AUTH_SECRET on its own, so the absence of this line is
    // invisible until the inference fails in the edge runtime.
    expect(source).toMatch(/secret:\s*process\.env\.AUTH_SECRET/);
  });

  it("constructs NextAuth with the lazy factory form", () => {
    // The eager form evaluates the config — including the secret lookup — at
    // module initialisation, which in the edge runtime is not a point where
    // the environment is reliably populated. The callback defers it to request
    // time. This is the actual fix for #14, and the thing most likely to be
    // "simplified" away.
    expect(source).toMatch(/NextAuth\(\s*\(\s*\)\s*=>/);
    expect(source).not.toMatch(/NextAuth\(\s*authConfig\s*\)/);
  });

  it("does not import the env() chokepoint", () => {
    // src/lib/env.ts imports "server-only". Pulling it in here would break the
    // edge bundle — middleware is the one file where going through env() is
    // the wrong answer (CLAUDE.md §Env chokepoint).
    expect(source).not.toMatch(/from\s+["']@\/lib\/env["']/);
  });
});
