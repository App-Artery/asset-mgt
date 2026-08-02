import { describe, expect, it } from "vitest";

import { exactTimestamp, relativeTime } from "./relative-time";

const now = new Date("2026-08-02T12:00:00.000Z");
const ago = (ms: number) => new Date(now.getTime() - ms);

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe("relativeTime", () => {
  it.each([
    [30 * MINUTE, "under an hour ago"],
    [HOUR, "1 hour ago"],
    [5 * HOUR, "5 hours ago"],
    [DAY, "yesterday"],
    [3 * DAY, "3 days ago"],
    [29 * DAY, "29 days ago"],
    [30 * DAY, "1 month ago"],
    [90 * DAY, "3 months ago"],
    [359 * DAY, "11 months ago"],
    // The window that used to render "0 years ago". `days / 30` reaches 12 at
    // 360 days while `days / 365` is still 0, so the two units disagreed for
    // five days a year and the disagreement was user-visible. Every unit now
    // cascades from the one below it, which is what makes the boundary a single
    // place rather than two that can drift.
    [360 * DAY, "1 year ago"],
    [364 * DAY, "1 year ago"],
    [365 * DAY, "1 year ago"],
    [400 * DAY, "1 year ago"],
    [800 * DAY, "2 years ago"],
  ])("renders %i ms ago as %s", (elapsed, expected) => {
    expect(relativeTime(ago(elapsed), now)).toBe(expected);
  });

  it("never renders a zero quantity", () => {
    // The failure this pins is not "360 days is wrong" but the CLASS of it: a
    // phrase like "0 years ago" tells the reader nothing and looks like a bug
    // in the record, not in the formatter. Swept across two years of daily
    // values so a future boundary change cannot reintroduce it somewhere else.
    for (let days = 0; days <= 730; days++) {
      const phrase = relativeTime(ago(days * DAY), now);
      expect(phrase, `${days} days`).not.toMatch(/\b0\b/);
    }
  });

  it("never says a negative amount of time", () => {
    // A record dated slightly ahead of the server — clock skew between the app
    // and the database is enough. "in -3 days" is the kind of string that makes
    // a reader distrust the whole page.
    const future = new Date(now.getTime() + 5 * MINUTE);
    expect(relativeTime(future, now)).toBe("just now");
  });

  it("does not report false precision inside the hour", () => {
    // 40 minutes and 50 minutes must read the same: the difference changes no
    // decision, and a number here invites someone to reconcile against it,
    // which is what the exact timestamp is for.
    expect(relativeTime(ago(40 * MINUTE), now)).toBe(
      relativeTime(ago(50 * MINUTE), now),
    );
  });
});

describe("exactTimestamp", () => {
  it("is UTC and locale-independent", () => {
    // An audit trail that renders differently per viewer is not an audit trail.
    expect(exactTimestamp(new Date("2026-08-01T21:21:33.500Z"))).toBe(
      "2026-08-01 21:21 UTC",
    );
  });
});
