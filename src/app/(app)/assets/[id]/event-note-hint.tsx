import type { ReactNode } from "react";

/**
 * The standing warning on every free-text field that lands in `AssetEvent.notes`.
 *
 * `notes` is the one PII channel the code cannot close: `CLAUDE.md` forbids the
 * application from writing personal data into the append-only event tables, and
 * it does not — but an operator can type a name into a text box, and that text
 * is rendered to ALL FOUR roles including STAFF_RO, who are otherwise shown no
 * person data at all (AM-03 DESIGN §2.1). `AssetEvent` is never updated and
 * never deleted, so a name typed here cannot be corrected or erased.
 *
 * "Reason" on retirement is the field most likely to attract one ("stolen from
 * X's car"), which is why the hint is on every one of them and not just assign.
 *
 * Its own module since #10: the five forms that write this column are split
 * across `lifecycle-actions.tsx` and `assignment-actions.tsx`, and they now live
 * inside dialogs, where a field can be moved without the hint noticeably staying
 * behind. One import, five call sites, and a test that opens every one of those
 * dialogs and looks for it beside the input.
 */
export function EventNoteHint({
  children,
}: {
  /** An extra sentence for one form. The standing warning is never replaced. */
  children?: ReactNode;
}) {
  return (
    <p className="text-muted-foreground text-xs">
      Never personal data: this lands in the permanent event log, is visible to
      all staff, and cannot be edited or removed. Describe the asset, not a
      person.
      {children ? <> {children}</> : null}
    </p>
  );
}
