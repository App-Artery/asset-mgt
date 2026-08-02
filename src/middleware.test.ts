import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { authConfig } from "@/auth.config";
import { edgeAuthConfig } from "./auth.edge";

/**
 * Guards on the edge middleware's secret handling (issue #14).
 *
 * The factory lives in src/auth.edge.ts and is exported so these can assert
 * BEHAVIOUR. An earlier revision asserted the source text instead, and the
 * advisor was right to reject it: a grep closes the spelling it was shown, not
 * the class. `?? "dev-secret"` was red-proved and guarded, and
 *
 *     const effective = secret || "dev-secret";
 *
 * would have walked straight past the same guard — throw unreachable,
 * middleware silently signing sessions with a known value. Calling the factory
 * closes the class: whatever route the code takes, either it throws or it
 * returns the real secret.
 *
 * What these still cannot prove: that the deployed edge runtime resolves
 * AUTH_SECRET at all. Nothing in this suite exercises the edge runtime, and
 * the symptom of failure — every authenticated user bounced to /signin — is
 * indistinguishable from broken sign-in, which is why #14 was worth
 * pre-empting. Only a post-promote check on production shows the happy path.
 */
describe("edgeAuthConfig", () => {
  const original = process.env.AUTH_SECRET;

  afterEach(() => {
    if (original === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = original;
  });

  it("throws, naming the variable, when AUTH_SECRET is absent", () => {
    delete process.env.AUTH_SECRET;
    expect(() => edgeAuthConfig()).toThrow(/AUTH_SECRET is not set/);
  });

  it("passes the secret through when it is present", () => {
    process.env.AUTH_SECRET = "test-secret-value";
    expect(edgeAuthConfig().secret).toBe("test-secret-value");
  });

  it("never yields a truthy secret when the variable is absent", () => {
    // The class-closing assertion. Any fallback — ??, ||, an intermediate
    // variable, a second return branch — makes this produce a truthy secret
    // without throwing, and fails here regardless of how it is spelled.
    delete process.env.AUTH_SECRET;

    let yielded: unknown;
    try {
      yielded = edgeAuthConfig().secret;
    } catch {
      yielded = undefined;
    }
    expect(yielded).toBeFalsy();
  });

  it("does not mutate the shared authConfig", () => {
    // authConfig is imported by src/auth.ts too. The spread in the factory is
    // what stops next-auth's setEnvDefaults writing a secret onto it.
    process.env.AUTH_SECRET = "test-secret-value";
    edgeAuthConfig();
    expect(authConfig).not.toHaveProperty("secret");
  });
});

/**
 * One source-shape guard survives, because it defends something with no
 * runtime seam: only statically analysable `process.env.X` references survive
 * into an edge bundle, and a destructured or computed read would still return
 * the right value under vitest while resolving to undefined at the edge. That
 * is precisely the failure this issue exists to prevent, and it is invisible
 * to a behavioural test running in Node.
 */
describe("edge source shape", () => {
  // Comments stripped before matching, and finding that out cost a red test:
  // the docblocks explain why the eager `NextAuth(authConfig)` form was
  // replaced, and the negative assertion below matched the explanation.
  const codeOf = (file: string) =>
    readFileSync(path.resolve(import.meta.dirname, file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

  it("reads AUTH_SECRET as a literal static member access", () => {
    const source = codeOf("auth.edge.ts");
    expect(source).toMatch(/process\.env\.AUTH_SECRET/);
    expect(source).not.toMatch(/\{[^}]*AUTH_SECRET[^}]*\}\s*=\s*process\.env/);
    expect(source).not.toMatch(/process\.env\[/);
  });

  it("passes the factory to NextAuth without calling it", () => {
    // `NextAuth(edgeAuthConfig())` would typecheck and pass every behavioural
    // test in this file while moving the read back to module scope — the exact
    // bug #14 is about. Only the source shows the difference.
    const source = codeOf("middleware.ts");
    expect(source).toMatch(/NextAuth\(\s*edgeAuthConfig\s*\)/);
    expect(source).not.toMatch(/NextAuth\(\s*edgeAuthConfig\(\)\s*\)/);
    expect(source).not.toMatch(/NextAuth\(\s*authConfig\s*\)/);
  });

  it("keeps the edge config free of server-only modules", () => {
    // src/lib/env.ts imports "server-only" and zod-parses the whole of
    // process.env. Importing it here would break the edge bundle.
    const source = codeOf("auth.edge.ts");
    expect(source).not.toMatch(/from\s+["']@\/lib\/env["']/);
    expect(source).not.toMatch(/["']server-only["']/);
  });
});
