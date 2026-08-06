// @vitest-environment node
//
// The guard harness for ADR-002. `ci.yml` runs `pnpm build` directly and never
// invokes the Vercel buildCommand, so without this file `migrate-if-production.sh`
// would be untested code whose first execution is in production (C1c rationale).
//
// Every test below names the condition it defends and is falsifiable by deleting
// the guard it names — the standing rule in this project after seven guards that
// stayed green while broken (LEARNINGS §Testing).
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

const SCRIPT = path.resolve(import.meta.dirname, "migrate-if-production.sh");
const REPO_ROOT = path.resolve(import.meta.dirname, "..");

/** A database the guards must leave completely alone. */
const SANDBOX_DB = "adr002_guard_sandbox";
/** A second one, so "different database" is a real difference, not a typo. */
const OTHER_DB = "adr002_guard_other";

function urlFor(base: string, database: string): string {
  const url = new URL(base);
  url.pathname = `/${database}`;
  return url.toString();
}

type Run = { status: number; stdout: string; stderr: string };

/**
 * Runs the guard with a controlled environment.
 *
 * `env` is REPLACED, not merged, apart from PATH and HOME — otherwise the
 * developer's own DATABASE_URL leaks in from `.env` via the shell and the
 * "unset" tests silently stop testing anything.
 */
function runGuard(env: Record<string, string>): Run {
  try {
    const stdout = execFileSync("bash", [SCRIPT], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        // NODE_ENV only because the project's ProcessEnv type requires it —
        // nothing in the script reads it.
        NODE_ENV: process.env.NODE_ENV ?? "test",
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        ...env,
      },
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return {
      status: e.status ?? 1,
      stdout: e.stdout ?? "",
      stderr: e.stderr ?? "",
    };
  }
}

describe.skipIf(!testDatabaseUrl)("migrate-if-production.sh (real DB)", () => {
  let admin: PrismaClient;
  let sandboxUrl: string;
  let otherUrl: string;

  async function migrationsTableExists(url: string): Promise<boolean> {
    const client = new PrismaClient({ datasourceUrl: url });
    try {
      const rows = await client.$queryRawUnsafe<{ exists: boolean }[]>(
        `select exists (select 1 from information_schema.tables
           where table_schema = 'public' and table_name = '_prisma_migrations') as exists`,
      );
      return rows[0]?.exists === true;
    } finally {
      await client.$disconnect();
    }
  }

  beforeAll(async () => {
    sandboxUrl = urlFor(testDatabaseUrl!, SANDBOX_DB);
    otherUrl = urlFor(testDatabaseUrl!, OTHER_DB);
    // Connect to `postgres` to issue CREATE DATABASE — you cannot drop the
    // database you are connected to.
    admin = new PrismaClient({
      datasourceUrl: urlFor(testDatabaseUrl!, "postgres"),
    });
    for (const db of [SANDBOX_DB, OTHER_DB]) {
      await admin.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${db}"`);
      await admin.$executeRawUnsafe(`CREATE DATABASE "${db}"`);
    }
  }, 60_000);

  afterAll(async () => {
    for (const db of [SANDBOX_DB, OTHER_DB]) {
      await admin?.$executeRawUnsafe(`DROP DATABASE IF EXISTS "${db}"`);
    }
    await admin?.$disconnect();
  });

  // The positive control. Without it every other test in this file is
  // satisfied by a script that never migrates anything at all, which is the
  // exact shape of guard this project has shipped broken seven times.
  it("DOES migrate a production build from main", async () => {
    expect(await migrationsTableExists(sandboxUrl)).toBe(false);

    const run = runGuard({
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_REF: "main",
      MIGRATE_DATABASE_URL: sandboxUrl,
      DATABASE_URL: sandboxUrl,
    });

    expect(run.status, `stderr: ${run.stderr}`).toBe(0);
    expect(await migrationsTableExists(sandboxUrl)).toBe(true);
  }, 120_000);

  it("C1a: does NOT migrate a preview build, even holding a reachable credential", async () => {
    // The credential is deliberately present and valid. In production it is
    // absent (MIGRATE_DATABASE_URL is Production-scoped), so this proves the
    // SECOND guard on its own — delete the VERCEL_ENV conditional and the
    // sandbox gains a _prisma_migrations table.
    const run = runGuard({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "main",
      MIGRATE_DATABASE_URL: otherUrl,
      DATABASE_URL: otherUrl,
    });

    expect(run.status).toBe(0);
    expect(await migrationsTableExists(otherUrl)).toBe(false);
  }, 60_000);

  it("C2: refuses when the migrate target is a different database from the runtime target", async () => {
    const run = runGuard({
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_REF: "main",
      MIGRATE_DATABASE_URL: otherUrl,
      DATABASE_URL: sandboxUrl,
    });

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("different databases");
    // And it refused BEFORE touching anything.
    expect(await migrationsTableExists(otherUrl)).toBe(false);
  }, 60_000);

  it("C2: accepts a pooled runtime URL against the unpooled migrate URL", async () => {
    // The normal production shape: same database, one through the pooler. If
    // normalisation broke, every real deploy would fail closed — so this is the
    // test that stops C2 from being a deploy-blocking false positive.
    const pooled = new URL(sandboxUrl);
    pooled.hostname = `${pooled.hostname}-pooler`;

    const run = runGuard({
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_REF: "main",
      MIGRATE_DATABASE_URL: sandboxUrl,
      DATABASE_URL: pooled.toString(),
    });

    // Reaches the migration (already applied by the positive control above).
    expect(run.status, `stderr: ${run.stderr}`).toBe(0);
    expect(run.stderr).not.toContain("different databases");
  }, 120_000);
});

// No database needed: these assert the script refuses before it would connect.
describe("migrate-if-production.sh (guards that never reach a database)", () => {
  const UNREACHABLE =
    "postgresql://u:p@127.0.0.1:1/adr002_should_never_be_contacted";

  it("C1b: fails closed when MIGRATE_DATABASE_URL is unset", () => {
    const run = runGuard({
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_REF: "main",
      DATABASE_URL: UNREACHABLE,
    });

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("MIGRATE_DATABASE_URL");
  });

  it("C1b: fails closed when DATABASE_URL is unset, so C2 cannot be vacuous", () => {
    // Without this the same-database check would silently no-op whenever the
    // runtime URL is absent from the build container — a guard that cannot fail.
    const run = runGuard({
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_REF: "main",
      MIGRATE_DATABASE_URL: UNREACHABLE,
    });

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("DATABASE_URL");
  });

  it("C8: refuses a production deployment built from a non-main ref", () => {
    const run = runGuard({
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_REF: "feature/x",
      MIGRATE_DATABASE_URL: UNREACHABLE,
      DATABASE_URL: UNREACHABLE,
    });

    // Non-zero, NOT a quiet skip: a production deploy that silently declines to
    // migrate is the incident this ADR exists to prevent.
    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("expected 'main'");
  });

  it("C8: skips quietly for preview, which is not an error", () => {
    const run = runGuard({
      VERCEL_ENV: "preview",
      VERCEL_GIT_COMMIT_REF: "feature/x",
    });

    expect(run.status).toBe(0);
    expect(run.stdout).toContain("skipping migrations");
  });

  it("C1c: vercel-build.sh reaches the build after the guard skips", () => {
    // The composition, end to end. Without this a shell typo in vercel-build.sh
    // is discovered on the first production deploy, because ci.yml runs
    // `pnpm build` directly and never touches this file.
    //
    // `pnpm` is stubbed on PATH rather than really run: this asserts the build
    // is INVOKED, which is the part that can break, without spending a minute
    // compiling Next.
    const bin = mkdtempSync(path.join(tmpdir(), "adr002-bin-"));
    const log = path.join(bin, "invocations.log");
    writeFileSync(
      path.join(bin, "pnpm"),
      `#!/usr/bin/env bash\necho "$@" >> "${log}"\n`,
      { mode: 0o755 },
    );

    const run = execFileSync(
      "bash",
      [path.resolve(import.meta.dirname, "vercel-build.sh")],
      {
        cwd: REPO_ROOT,
        encoding: "utf8",
        env: {
          NODE_ENV: process.env.NODE_ENV ?? "test",
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          HOME: process.env.HOME ?? "",
          VERCEL_ENV: "preview",
          VERCEL_GIT_COMMIT_REF: "feature/x",
        },
      },
    );

    expect(run).toContain("skipping migrations");
    expect(readFileSync(log, "utf8").trim()).toBe("build");
  });

  it("C7: never prints a connection string to stdout or stderr", () => {
    const sentinel = "s3nt1nel-must-never-appear-in-a-build-log";
    const run = runGuard({
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_REF: "main",
      MIGRATE_DATABASE_URL: `postgresql://u:${sentinel}@127.0.0.1:1/a`,
      DATABASE_URL: `postgresql://u:${sentinel}@127.0.0.1:1/b`,
    });

    // It must fail (different databases) AND stay quiet about the values.
    expect(run.status).not.toBe(0);
    expect(run.stdout).not.toContain(sentinel);
    expect(run.stderr).not.toContain(sentinel);
  });
});
