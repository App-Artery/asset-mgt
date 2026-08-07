// Asset Tiger import CLI — the AM-04 cutover tool.
//
// Run as `pnpm db:import <file.xlsx>` for a DRY RUN, and
// `pnpm db:import <file.xlsx> --commit --batch=<id>` to write.
//
// Config is read from process.env HERE, deliberately not via src/lib/env.ts —
// the same reasoning as scripts/seed-reference.ts: the import's inputs are
// script-only, and the run must not demand the app's Resend/auth secrets.
//
//   DIRECT_DATABASE_URL  target database, UNPOOLED (required — see below)
//   DATABASE_URL         fallback when DIRECT_DATABASE_URL is unset
//
// ## Run it through the package script, not bare tsx
//
// `pnpm db:import` passes `--conditions=react-server`, and WITHOUT IT THIS
// SCRIPT CANNOT START. The modules it needs (`import-run.ts`, `asset-import.ts`
// and `asset-admin.ts` behind them) begin with `import "server-only"`, whose
// package exports resolve to a module that throws on any condition except
// `react-server`. Next.js supplies that condition; a plain Node process does
// not, so the import throws before a single row is read.
//
// The test suite cannot catch this, and that is worth stating plainly: vitest
// aliases `server-only` to `test/server-only-stub.ts`, so every unit and
// integration test exercises these modules with the guard already removed. Only
// running the CLI for real reaches it. It was found by exactly that, after the
// tests were green.
//
// The alternative — dropping `server-only` from those modules — was rejected:
// they legitimately must never reach a client bundle, and the marker is what
// makes that a build error rather than a review question.
//
// ## Why there is no web upload page
//
// The advisor ruled CLI-only for AM-04 and the ruling was accepted in full. The
// argument that survived was architectural rather than security: --commit needs
// an UNPOOLED connection because it holds a SESSION-scoped advisory lock across
// ~400 separate transactions, and a session lock taken on a pooled connection
// may be released onto a different backend than it was taken on. That plus ~400
// sequential row transactions does not fit a Vercel function's execution shape,
// and a one-time cutover does not justify a permanent endpoint.
//
// Authorisation is therefore possession of the database URL — the same boundary
// the two existing seed scripts sit behind — and every event this writes has
// actorId null, per the established "system action (seed script)" convention.
// Attributing ~400 events to whichever admin ran the script would be an
// impersonation the audit trail could not later distinguish from real activity.
//
// ## The two-step, and why --batch exists
//
// A dry run writes an ImportBatch row and prints a REPORT the IT admin reads
// and signs — the assignee resolution list (AM-04-C9) and the category/site
// census (C16). Those are the story's two ONE-WAY DOORS: Assignment is
// write-once and nothing here is ever deleted, so a wrong holder can only be
// papered over with a fabricated return; and reference rows are renamed, never
// removed, and a rename cannot merge.
//
// --commit then takes that batch id, RE-PARSES the file, and recomputes both
// the source SHA-256 and the normalised row hash. Any difference aborts. That
// is what makes "the committed data is the previewed data" provable while
// keeping zero server-side parsed state between the two commands (C21).

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { parseAssetWorkbook } from "../src/lib/import-xlsx";
import { hashRows, hashSource, runImport } from "../src/lib/import-run";
import type { DryRunResult } from "../src/lib/import-run";

type Args = {
  file: string;
  commit: boolean;
  batchId: string | null;
};

export function parseArgs(argv: string[]): Args {
  const positional = argv.filter((arg) => !arg.startsWith("--"));
  const flags = argv.filter((arg) => arg.startsWith("--"));
  const batch = flags.find((flag) => flag.startsWith("--batch="));
  const file = positional[0];
  if (!file) {
    throw new Error(
      "Usage: pnpm db:import <export.xlsx> [--commit --batch=<id>]",
    );
  }
  return {
    file,
    commit: flags.includes("--commit"),
    batchId: batch ? batch.slice("--batch=".length) : null,
  };
}

/** The report an operator reads and signs. Carries names; never persisted. */
export function formatReport(result: DryRunResult, commit: boolean): string {
  const { report } = result;
  const lines: string[] = [];
  const rule = "─".repeat(64);

  lines.push(rule);
  lines.push(commit ? "IMPORT COMMITTED" : "DRY RUN — nothing was written");
  lines.push(rule);
  lines.push(`  source rows   ${report.sourceRowCount}`);
  lines.push(`  imported      ${report.imported}`);
  lines.push(`  skipped       ${report.skipped}   (already present)`);
  lines.push(
    `  conflicts     ${report.conflicted}   (changed since import — NOT overwritten)`,
  );
  lines.push(`  quarantined   ${report.quarantined}`);
  lines.push("");

  // The AC's "reported, never silently dropped", made concrete.
  if (report.quarantined > 0) {
    lines.push("Quarantined rows, by reason:");
    for (const [problem, count] of Object.entries(report.problems)) {
      lines.push(`  ${count.toString().padStart(4)}  ${problem}`);
    }
    lines.push("");
    lines.push("  Row numbers (find these in your own spreadsheet):");
    const rows = report.outcomes
      .filter((outcome) => outcome.kind === "quarantined")
      .map((outcome) => outcome.sourceRow);
    lines.push(`  ${rows.join(", ")}`);
    lines.push("");
  }

  // ONE-WAY DOOR 1 — reference data. Renamed, never removed; a rename cannot
  // merge, so a typo signed off here is permanent.
  lines.push("SIGN-OFF 1 — reference rows this run creates");
  if (report.newCategories.length === 0 && report.newSites.length === 0) {
    lines.push("  (none — every category and site already exists)");
  } else {
    for (const name of report.newCategories) lines.push(`  category  ${name}`);
    for (const name of report.newSites) lines.push(`  site      ${name}`);
  }
  lines.push("");

  // ONE-WAY DOOR 2 — people. A wrong match attributes someone else's laptop to
  // a named individual, and it can only be undone by fabricating a return.
  lines.push("SIGN-OFF 2 — assignee resolution");
  lines.push(
    `  matched ${report.holders.matched}   created ${report.holders.created}   ambiguous ${report.holders.ambiguous}`,
  );
  const seen = new Set<string>();
  for (const entry of result.holderSignOff) {
    if (seen.has(entry.name)) continue;
    seen.add(entry.name);
    const label =
      entry.outcome === "matched"
        ? "MATCHED"
        : entry.outcome === "created"
          ? "WILL CREATE"
          : "AMBIGUOUS — row quarantined, resolve by hand";
    lines.push(`  ${label.padEnd(12)} ${entry.name}`);
  }
  lines.push("");
  lines.push(`  source sha256  ${result.sourceSha256}`);
  lines.push(`  rows hash      ${result.rowsHash}`);
  lines.push(rule);
  return lines.join("\n");
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  const databaseUrl =
    process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      "DIRECT_DATABASE_URL (preferred, unpooled) or DATABASE_URL must be set",
    );
  }
  if (args.commit && !process.env.DIRECT_DATABASE_URL) {
    // Loud rather than subtle: a session advisory lock on a pooled connection
    // may be released onto a different backend, which silently removes the only
    // thing stopping two concurrent runs from each creating their own copy of
    // one person.
    console.warn(
      "WARNING: committing without DIRECT_DATABASE_URL. The run lock needs an\n" +
        "unpooled connection; a pooled URL makes it unreliable.\n",
    );
  }

  const sourceBytes = new Uint8Array(readFileSync(args.file));
  const sheet = parseAssetWorkbook(sourceBytes);

  const db = new PrismaClient({ datasourceUrl: databaseUrl });
  try {
    if (args.commit) {
      if (!args.batchId) {
        throw new Error(
          "--commit requires --batch=<id> from the dry run you signed off",
        );
      }
      const batch = await db.importBatch.findUnique({
        where: { id: args.batchId },
      });
      if (!batch) throw new Error(`No import batch ${args.batchId}`);
      if (!batch.dryRun) {
        throw new Error(
          `Batch ${args.batchId} was already a commit run — start from a new dry run`,
        );
      }
      // AM-04-C21. Both hashes, because they catch different substitutions: a
      // different file, and a file that differs only in ways the parser
      // normalises away.
      const sourceSha256 = hashSource(sourceBytes);
      const rowsHash = hashRows(sheet);
      if (batch.sourceSha256 !== sourceSha256 || batch.rowsHash !== rowsHash) {
        throw new Error(
          `The file has changed since batch ${args.batchId} was reviewed.\n` +
            `  expected sha256 ${batch.sourceSha256}\n` +
            `  actual   sha256 ${sourceSha256}\n` +
            "Re-run the dry run and sign off the new report.",
        );
      }
    }

    const result = await runImport(db, sheet, sourceBytes, {
      commit: args.commit,
    });

    // The batch row is written once at run start and updated exactly once at
    // run end (AM-04-C5). Written here, after the run, because a CLI that dies
    // mid-run leaves no half-open batch to interpret — and the report is the
    // only thing that makes the row useful.
    const batch = await db.importBatch.create({
      data: {
        source: args.file,
        dryRun: !args.commit,
        finishedAt: new Date(),
        rowsOk: result.report.imported,
        rowsFailed: result.report.quarantined,
        // No personal data (AM-04-C6) — this is the persisted artefact, and the
        // named sign-off list above is not part of it.
        report: result.report,
        sourceSha256: result.sourceSha256,
        rowsHash: result.rowsHash,
      },
      select: { id: true },
    });

    console.log(formatReport(result, args.commit));
    if (!args.commit) {
      console.log(
        `\nSigned off? Commit this exact file with:\n` +
          `  pnpm db:import ${args.file} --commit --batch=${batch.id}\n`,
      );
    }

    // A non-zero exit when anything was quarantined, so CI or a wrapper script
    // cannot mistake a partial import for a clean one.
    return result.report.quarantined > 0 ? 1 : 0;
  } finally {
    await db.$disconnect();
  }
}

/* c8 ignore start — entrypoint guard, exercised by running the script */
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main(process.argv.slice(2))
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
/* c8 ignore stop */

export { main };
