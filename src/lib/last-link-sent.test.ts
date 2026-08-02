import { describe, expect, it } from "vitest";

import {
  lastLinkSentByEmail,
  normaliseIdentifier,
  type LinkSendRow,
} from "./last-link-sent";

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

  // The stored identifier is NFKC — `@auth/core`'s `defaultNormalizer` applies
  // it before `createVerificationToken` inserts. `User.email` is whatever the
  // admin typed when provisioning, which is NOT normalised for us. So the
  // realistic shape of this bug is a token row in composed form and a user
  // record in decomposed form: without NFKC on both sides the lookup misses
  // and the column reports "No link sent yet" about somebody who was invited.
  it("matches a decomposed user email against a composed token row", () => {
    const composed = "josé@example.com"; // é as one code point
    const decomposed = "josé@example.com"; // e + combining acute

    const byEmail = lastLinkSentByEmail([row(composed, NEWER)]);

    expect(byEmail.get(normaliseIdentifier(decomposed))).toEqual(NEWER);
  });

  it("folds the two spellings onto one key rather than two entries", () => {
    const byEmail = lastLinkSentByEmail([
      row("josé@example.com", OLDER),
      row("josé@example.com", NEWER),
    ]);

    expect(byEmail.size).toBe(1);
    expect(byEmail.get("josé@example.com")).toEqual(NEWER);
  });
});

describe("normaliseIdentifier", () => {
  it("folds decomposed onto composed", () => {
    expect(normaliseIdentifier("josé@example.com")).toBe("josé@example.com");
  });

  // Compatibility folding — the K in NFKC. Plain NFC leaves these alone, so
  // this case fails against `.normalize("NFC")` as well as against no
  // normalisation, which is what pins the choice of form.
  it("folds fullwidth compatibility characters to ASCII", () => {
    expect(normaliseIdentifier("ＧＲＡＣＥ@example.com")).toBe(
      "grace@example.com",
    );
  });

  it("still lowercases and trims", () => {
    expect(normaliseIdentifier("  Grace@Example.com  ")).toBe(
      "grace@example.com",
    );
  });
});
