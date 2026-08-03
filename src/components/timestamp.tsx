import { exactTimestamp, relativeTime } from "@/lib/relative-time";

/**
 * One `<time>` element for the whole app, in two variants.
 *
 * `formatTimestamp` had been copy-pasted verbatim into three page files and was
 * byte-identical to `exactTimestamp` in src/lib/relative-time.ts.
 *
 * The variants are not a style choice — they answer different questions:
 *
 * - `exact` — assignment dates and prose. This is an audit register: a
 *   checked-out date is reconciled against, and hover does not exist on touch,
 *   so "3 weeks ago" with no way to reach the real value is a loss.
 * - default — "how stale is this?" cells: last sign-in, the history timeline.
 *   The phrase leads and the exact value stays one hover away, never replaced.
 *
 * `now` is a required parameter of the relative variant rather than a
 * `Date.now()` read, so two rows on a page cannot disagree about "now".
 */
type TimestampProps =
  | { value: Date; exact: true; now?: never }
  | { value: Date; exact?: false; now: Date };

export function Timestamp(props: TimestampProps) {
  const iso = props.value.toISOString();
  const exact = exactTimestamp(props.value);

  // `whitespace-nowrap` so a timestamp never breaks mid-value. On a phone card
  // the meta line wraps, and without this "2026-05-01 16:00 UTC" splits after
  // "16:00", leaving a bare "UTC" on the next line — verified in a real browser
  // at 390px. The separators around it are ordinary spaces, so the line still
  // breaks BETWEEN values, which is where a break belongs.
  if (props.exact) {
    // No `title`: it would repeat the text the element already shows.
    return (
      <time dateTime={iso} className="whitespace-nowrap">
        {exact}
      </time>
    );
  }

  return (
    <time dateTime={iso} title={exact} className="whitespace-nowrap">
      {relativeTime(props.value, props.now)}
    </time>
  );
}
