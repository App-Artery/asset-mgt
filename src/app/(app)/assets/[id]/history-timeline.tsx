import type { AssetEventType, AssetStatus } from "@prisma/client";

import { STATUS_LABELS } from "@/lib/asset-lifecycle";
import { EVENT_TYPE_LABELS } from "@/lib/labels";
import { exactTimestamp, relativeTime } from "@/lib/relative-time";
import { cn } from "@/lib/utils";

/**
 * The asset's history (AM-09 DESIGN §4.3).
 *
 * Was a five-column table of raw enums and UTC timestamps below the fold. A
 * history is a sequence, so it reads as one: newest first, each entry saying
 * what happened, to what, and how long ago — with the exact timestamp on hover
 * for the reader who needs to reconcile rather than skim.
 *
 * The dot is coloured by the status the asset LANDED in, not by the event type.
 * Status questions are answered from fromStatus/toStatus and never from the
 * event type (CLAUDE.md), and the same rule makes the visual honest: retiring
 * an assigned asset writes a single RETURNED event carrying
 * fromStatus=ASSIGNED, toStatus=RETIRED, and it is the RETIRED that the reader
 * needs to see.
 */
export type HistoryEntry = {
  id: string;
  at: Date;
  type: AssetEventType;
  fromStatus: AssetStatus | null;
  toStatus: AssetStatus | null;
  notes: string | null;
  who: string;
};

const NODE_TONE: Record<AssetStatus, string> = {
  ON_ORDER: "border border-dashed border-st-inert",
  IN_STOCK: "bg-st-stock",
  ASSIGNED: "bg-st-assigned",
  IN_REPAIR: "bg-st-repair",
  RETIRED: "border border-st-inert",
};

export function HistoryTimeline({
  entries,
  now,
}: {
  entries: readonly HistoryEntry[];
  /** Passed in so every entry on the page agrees about what "now" is. */
  now: Date;
}) {
  if (entries.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Nothing recorded yet. Every change from here on lands in this list.
      </p>
    );
  }

  return (
    <ol className="flex flex-col">
      {entries.map((entry, index) => {
        const isLast = index === entries.length - 1;
        const change =
          entry.fromStatus || entry.toStatus
            ? `${entry.fromStatus ? STATUS_LABELS[entry.fromStatus] : "—"} → ${
                entry.toStatus ? STATUS_LABELS[entry.toStatus] : "—"
              }`
            : null;

        return (
          <li
            key={entry.id}
            className="relative grid grid-cols-[9px_1fr] gap-3"
          >
            <span
              aria-hidden="true"
              className={cn(
                "mt-1.5 size-2 shrink-0 rounded-full",
                entry.toStatus
                  ? NODE_TONE[entry.toStatus]
                  : "bg-muted-foreground",
              )}
            />
            {/* The connecting rule stops at the last entry, so the line reads
                as "and before this, nothing" rather than trailing off. */}
            {isLast ? null : (
              <span
                aria-hidden="true"
                className="bg-border absolute top-4 bottom-0 left-[3.5px] w-px"
              />
            )}
            <div className="min-w-0 pb-4 text-sm">
              <span className="font-medium">
                {EVENT_TYPE_LABELS[entry.type]}
              </span>
              {change ? (
                <span className="text-muted-foreground"> · {change}</span>
              ) : null}
              <div className="text-muted-foreground text-xs">
                {/* The phrase leads, the exact value is one hover away and is
                    never replaced — the auditor still gets UTC to the minute. */}
                <time
                  dateTime={entry.at.toISOString()}
                  title={exactTimestamp(entry.at)}
                >
                  {relativeTime(entry.at, now)}
                </time>
                {" · "}
                {/* Its own element, not a bare text node: the privacy tests
                    assert on `>IT<` — the neutral label a viewer sees when the
                    actor is someone they may not be told about — and that
                    assertion is only meaningful if the value has a boundary of
                    its own to match against. */}
                <span>{entry.who}</span>
              </div>
              {entry.notes ? (
                <p className="mt-1 text-xs break-words whitespace-normal">
                  {entry.notes}
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
