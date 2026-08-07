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
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;

const SCRIPT = path.resolve(import.meta.dirname, "migrate-if-production.sh");
const BUILD_SCRIPT = path.resolve(import.meta.dirname, "vercel-build.sh");
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
      await dropDatabase(db);
      await admin.$executeRawUnsafe(`CREATE DATABASE "${db}"`);
    }
  }, 60_000);

  afterAll(async () => {
    for (const db of [SANDBOX_DB, OTHER_DB]) {
      await dropDatabase(db);
    }
    await admin?.$disconnect();
  });

  /**
   * `WITH (FORCE)` — Postgres 13+, and this project is pinned to 17.
   *
   * A plain DROP fails with "database is being accessed by other users" if any
   * connection lingers: a `migrationsTableExists` client, or a `prisma migrate
   * deploy` the script spawned in a previous run. That surfaces as a failing
   * `beforeAll` and takes the whole real-DB block red for a reason unrelated to
   * anything under test. Observed once, after a run whose mutated script left
   * the sandbox mid-migration; it does not reproduce on clean runs, so this is
   * precautionary rather than a fix for a diagnosed defect — but the required
   * check is not the place to find out.
   */
  async function dropDatabase(db: string): Promise<void> {
    await admin?.$executeRawUnsafe(
      `DROP DATABASE IF EXISTS "${db}" WITH (FORCE)`,
    );
  }

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
});

// No TEST_DATABASE_URL needed. Not hermetic, though: three of these do reach
// `pnpm db:deploy` and attempt a connection, deliberately — that is the only
// path where the credential meets a third-party CLI. They use fake credentials
// on port 1.
//
// LOAD-BEARING: these run Prisma with cwd = repo root, where the gitignored
// `.env` holds the PRODUCTION DATABASE_URL (vitest.setup.ts). They are safe
// only because migrate-if-production.sh always sets DATABASE_URL explicitly on
// the `pnpm db:deploy` line, and Prisma's dotenv never overrides an
// already-set variable. Do not "simplify" that line into a bare command.
describe("migrate-if-production.sh (guards that need no test database)", () => {
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

  it("C1: fails closed when VERCEL_ENV is unset entirely", () => {
    // The one input that decides whether production migrates, and the only one
    // that used to fail OPEN. VERCEL_ENV is present only while the project's
    // "Automatically expose System Environment Variables" toggle is on — a UI
    // setting outside code review. If unset skipped quietly, flipping that
    // toggle would silently disable this whole gate.
    const run = runGuard({
      VERCEL_GIT_COMMIT_REF: "main",
      MIGRATE_DATABASE_URL: UNREACHABLE,
      DATABASE_URL: UNREACHABLE,
    });

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("not a recognised Vercel environment");
  });

  it("C1: fails closed on an unrecognised VERCEL_ENV value", () => {
    const run = runGuard({
      VERCEL_ENV: "staging",
      VERCEL_GIT_COMMIT_REF: "main",
      MIGRATE_DATABASE_URL: UNREACHABLE,
      DATABASE_URL: UNREACHABLE,
    });

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("not a recognised Vercel environment");
  });

  it("C2: refuses a POOLED MIGRATE_DATABASE_URL", () => {
    // Both sides of the same-database comparison are -pooler-stripped, so a
    // pooled migrate URL passes that check. Prisma's session advisory lock is
    // broken over PgBouncer, and the resulting failure freezes every deploy.
    const pooled =
      "postgresql://u:p@ep-x-1-pooler.eu-central-1.aws.neon.tech:5432/db";
    const direct = "postgresql://u:p@ep-x-1.eu-central-1.aws.neon.tech:5432/db";

    const run = runGuard({
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_REF: "main",
      MIGRATE_DATABASE_URL: pooled,
      DATABASE_URL: direct,
    });

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("POOLED");
  });

  it("C2: accepts the real production shape — pooled runtime, unpooled migrate", () => {
    // The shape every real deploy has. If normalisation broke, production would
    // fail CLOSED on every push, so this is the test that stops C2 from being a
    // deploy-blocking false positive.
    //
    // Neon-shaped hosts on purpose: `-pooler` sits immediately before the first
    // dot, which is what the anchored pattern keys on. A bare `localhost-pooler`
    // is not a shape Neon ever produces and testing against it would be testing
    // a fiction.
    const run = runGuard({
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_REF: "main",
      MIGRATE_DATABASE_URL:
        "postgresql://u:p@ep-x-1.eu-central-1.aws.neon.tech:1/db",
      DATABASE_URL:
        "postgresql://u:p@ep-x-1-pooler.eu-central-1.aws.neon.tech:1/db",
    });

    // POSITIVE first. Two `not.toContain` assertions alone are satisfied by a
    // run that exited at the `case` statement and never evaluated C2 at all —
    // so any mutation upstream of the comparison would leave this green while
    // proving nothing. This line asserts the script actually got past both
    // checks to the migration itself.
    expect(run.stdout).toContain("applying pending migrations");
    expect(run.stderr).not.toContain("different databases");
    expect(run.stderr).not.toContain("POOLED");
  }, 60_000);

  it("C2: does not corrupt a host that merely contains the word pooler", () => {
    // `ep-pooler-dawn-42` is a legitimate endpoint name. An unanchored
    // replace() rewrites it to `ep-dawn-42` — a different, real endpoint — so
    // two distinct databases would compare equal.
    const run = runGuard({
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_REF: "main",
      MIGRATE_DATABASE_URL: "postgresql://u:p@ep-pooler-dawn-42.neon.tech:1/db",
      DATABASE_URL: "postgresql://u:p@ep-dawn-42.neon.tech:1/db",
    });

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("different databases");
  });

  it("C2: distinguishes databases that differ only by port", () => {
    const run = runGuard({
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_REF: "main",
      MIGRATE_DATABASE_URL: "postgresql://u:p@127.0.0.1:5432/db",
      DATABASE_URL: "postgresql://u:p@127.0.0.1:5433/db",
    });

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("different databases");
  });

  it("C2: distinguishes schemas within one database", () => {
    const run = runGuard({
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_REF: "main",
      MIGRATE_DATABASE_URL: "postgresql://u:p@127.0.0.1:1/db?schema=staging",
      DATABASE_URL: "postgresql://u:p@127.0.0.1:1/db?schema=public",
    });

    expect(run.status).not.toBe(0);
    expect(run.stderr).toContain("different databases");
  });

  it("C1c: vercel-build.sh does NOT build when the guard fails", () => {
    // The property this whole change exists to provide, and the inverse of the
    // test below. It rests on `set -e` over an unwrapped command: an added
    // `|| true`, an `if`, or moving the call into a pipeline turns the gate off
    // with every other test still green.
    const bin = mkdtempSync(path.join(tmpdir(), "adr002-bin-"));
    const log = path.join(bin, "invocations.log");
    writeFileSync(
      path.join(bin, "pnpm"),
      `#!/usr/bin/env bash\necho "$@" >> "${log}"\n`,
      { mode: 0o755 },
    );

    let status = 0;
    try {
      execFileSync("bash", [BUILD_SCRIPT], {
        cwd: REPO_ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          NODE_ENV: process.env.NODE_ENV ?? "test",
          PATH: `${bin}:${process.env.PATH ?? ""}`,
          HOME: process.env.HOME ?? "",
          VERCEL_ENV: "production",
          VERCEL_GIT_COMMIT_REF: "feature/x", // C8 refuses
        },
      });
    } catch (error) {
      status = (error as { status?: number }).status ?? 1;
    }

    expect(status).not.toBe(0);
    // The build must never have been invoked at all.
    expect(existsSync(log)).toBe(false);
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

    const run = execFileSync("bash", [BUILD_SCRIPT], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      env: {
        NODE_ENV: process.env.NODE_ENV ?? "test",
        PATH: `${bin}:${process.env.PATH ?? ""}`,
        HOME: process.env.HOME ?? "",
        VERCEL_ENV: "preview",
        VERCEL_GIT_COMMIT_REF: "feature/x",
      },
    });

    expect(run).toContain("skipping migrations");
    expect(readFileSync(log, "utf8").trim()).toBe("build");
  });

  it("C7: never prints a connection string when it refuses early", () => {
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

  it("C7: never prints a connection string when Prisma itself fails to connect", () => {
    // The case above refuses at C2 and never invokes `pnpm db:deploy` — so it
    // does not cover the one point where the credential is handed to a
    // third-party CLI. Matching URLs get past every guard and fail at the
    // connection instead, which is the path that actually carries the secret.
    const sentinel = "s3nt1nel-prisma-connect-failure";
    const url = `postgresql://u:${sentinel}@127.0.0.1:1/adr002_unreachable`;
    const run = runGuard({
      VERCEL_ENV: "production",
      VERCEL_GIT_COMMIT_REF: "main",
      MIGRATE_DATABASE_URL: url,
      DATABASE_URL: url,
    });

    expect(run.status).not.toBe(0);
    expect(run.stdout).not.toContain(sentinel);
    expect(run.stderr).not.toContain(sentinel);
  }, 60_000);
});
