import { describe, expect, it } from "vitest";
import { formatReport, parseArgs } from "./import-assets";
import type { DryRunResult } from "../src/lib/import-run";

describe("parseArgs", () => {
  it("defaults to a dry run", () => {
    expect(parseArgs(["export.xlsx"])).toEqual({
      file: "export.xlsx",
      commit: false,
      batchId: null,
    });
  });

  it("reads --commit and --batch in any order", () => {
    expect(parseArgs(["--batch=abc123", "export.xlsx", "--commit"])).toEqual({
      file: "export.xlsx",
      commit: true,
      batchId: "abc123",
    });
  });

  it("refuses to run with no file", () => {
    expect(() => parseArgs(["--commit"])).toThrow(/Usage/);
  });
});

describe("formatReport", () => {
  const result: DryRunResult = {
    sourceSha256: "a".repeat(64),
    rowsHash: "b".repeat(64),
    holderSignOff: [
      { name: "Jane Holder", outcome: "matched" },
      { name: "New Starter", outcome: "created" },
      { name: "Ambiguous Twin", outcome: "ambiguous" },
      // A repeat, to prove the list is deduped — a person holding nine assets
      // must appear once on a list a human has to read and sign.
      { name: "Jane Holder", outcome: "matched" },
    ],
    report: {
      sourceRowCount: 6,
      imported: 3,
      skipped: 1,
      conflicted: 1,
      quarantined: 1,
      problems: { "unknown-status": 1 },
      newCategories: ["DOCKING STATION"],
      newSites: ["IITA Nairobi ICIPE Office"],
      holders: { matched: 1, created: 1, ambiguous: 1 },
      outcomes: [
        { kind: "quarantined", sourceRow: 4, problem: "unknown-status" },
      ],
    },
  };

  it("says plainly that a dry run wrote nothing", () => {
    expect(formatReport(result, false)).toContain("nothing was written");
    expect(formatReport(result, true)).toContain("IMPORT COMMITTED");
  });

  // The AC: unmapped rows are reported, never silently dropped. An operator
  // must be able to find the offending row in their own spreadsheet.
  it("names every quarantine reason and the source row numbers", () => {
    const out = formatReport(result, false);
    expect(out).toContain("unknown-status");
    expect(out).toContain("4");
  });

  // The two one-way doors. Both are gated on a human reading this list.
  it("prints the reference census for sign-off", () => {
    const out = formatReport(result, false);
    expect(out).toContain("SIGN-OFF 1");
    expect(out).toContain("category  DOCKING STATION");
    expect(out).toContain("site      IITA Nairobi ICIPE Office");
  });

  it("prints each assignee once, labelled by what will happen", () => {
    const out = formatReport(result, false);
    expect(out).toContain("SIGN-OFF 2");
    expect(out).toContain("MATCHED      Jane Holder");
    expect(out).toContain("WILL CREATE  New Starter");
    expect(out).toMatch(/AMBIGUOUS[^\n]*Ambiguous Twin/);
    // Deduped: one line for Jane, not two.
    expect(out.split("Jane Holder").length - 1).toBe(1);
  });

  it("prints both hashes, so the commit can be bound to this review", () => {
    const out = formatReport(result, false);
    expect(out).toContain("a".repeat(64));
    expect(out).toContain("b".repeat(64));
  });
});
