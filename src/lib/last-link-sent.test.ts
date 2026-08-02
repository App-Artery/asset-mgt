import { describe, expect, it } from "vitest";

import { lastLinkSentByEmail, type LinkSendRow } from "./last-link-sent";

const OLDER = new Date("2026-07-28T09:00:00.000Z");
const NEWER = new Date("2026-08-01T17:30:00.000Z");

const row = (identifier: string, createdAt: Date | null): LinkSendRow => ({
  identifier,
  _max: { createdAt },
});

describe("lastLinkSentByEmail", () => {
  it("keys on the lowercased identifier", () => {
    const byEmail = lastLinkSentByEmail([row("Grace@Example.com", NEWER)]);

    expect(byEmail.get("grace@example.com")).toEqual(NEWER);
  });

  // The reason this function exists. `groupBy` returns one row per EXACT
  // identifier, so two spellings of one address arrive as two rows competing
  // for a single key — and Postgres promises no order for a GROUP BY without
  // ORDER BY. Both permutations are asserted because a real-DB test can only
  // ever observe the one the planner chose: the equivalent integration test
  // passed against a plain last-write-wins `set`, proving nothing.
  it.each([
    [
      "newest first",
      [row("Grace@example.com", NEWER), row("grace@example.com", OLDER)],
    ],
    [
      "oldest first",
      [row("grace@example.com", OLDER), row("Grace@example.com", NEWER)],
    ],
  ])("takes the newest of colliding identifiers — %s", (_label, rows) => {
    expect(lastLinkSentByEmail(rows).get("grace@example.com")).toEqual(NEWER);
  });

  it("ignores rows with no timestamp", () => {
    // `_max` is null only for an empty group, which groupBy does not return —
    // but the type admits it, and a null must not become an entry claiming a
    // link was sent.
    const byEmail = lastLinkSentByEmail([row("nobody@example.com", null)]);

    expect(byEmail.has("nobody@example.com")).toBe(false);
  });

  it("has no entry for an address that was never sent a link", () => {
    expect(lastLinkSentByEmail([]).size).toBe(0);
  });
});
