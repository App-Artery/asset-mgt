/**
 * Human-scale time for the asset history (AM-09 DESIGN §4.3).
 *
 * The history rendered `2026-08-01 21:21 UTC` on every row. That is what an
 * auditor needs and it is not what a human checks — "was this assigned
 * recently, or has it been out for a year?" is answered by a phrase, and the
 * timestamp is the detail you go to afterwards. So the phrase leads and the
 * exact value stays one hover away, never replaced.
 *
 * Deliberately coarse. This is not a countdown: an event that happened 40
 * minutes ago and one that happened 50 both read "under an hour ago", because
 * the difference does not change any decision and false precision invites
 * someone to trust it for reconciliation, which is what the timestamp is for.
 *
 * Pure and dependency-free, so it is a unit test rather than a render test, and
 * so the same function can label a timeline on either side of the boundary.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * `now` is a parameter, not `Date.now()` — a function that reads the clock
 * cannot be tested without freezing time, and this one is called several times
 * per render, where two rows disagreeing about "now" would be a real bug.
 */
export function relativeTime(value: Date, now: Date): string {
  const elapsed = now.getTime() - value.getTime();

  // A clock skew or a record dated slightly ahead of the server: say something
  // true rather than "in -3 days".
  if (elapsed < 0) return "just now";
  if (elapsed < HOUR) return "under an hour ago";

  const hours = Math.floor(elapsed / HOUR);
  if (hours < 24) return hours === 1 ? "1 hour ago" : `${hours} hours ago`;

  const days = Math.floor(elapsed / DAY);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;

  // Each unit is derived from the one below it, never from `elapsed` again.
  // Deriving months from a 30-day month and years from a 365-day year let the
  // two disagree: at 360 days `days / 30` is already 12 while `days / 365` is
  // still 0, so five days a year rendered "0 years ago". One cascade, one
  // boundary, nothing to keep in step.
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? "1 month ago" : `${months} months ago`;

  const years = Math.floor(months / 12);
  return years === 1 ? "1 year ago" : `${years} years ago`;
}

/**
 * The exact value, for the `title` and for anything reconciling against another
 * system. UTC and ISO-shaped on purpose: the server's locale is not the
 * reader's, and an audit trail that renders differently per viewer is not one.
 */
export function exactTimestamp(value: Date): string {
  return `${value.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
