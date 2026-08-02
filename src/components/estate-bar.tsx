import Link from "next/link";
import type { AssetStatus } from "@prisma/client";

import { STATUS_LABELS } from "@/lib/asset-lifecycle";
import { cn } from "@/lib/utils";

/**
 * The register's status summary and its status filter, as one control
 * (AM-09 DESIGN §4.2).
 *
 * The templated answer here is a row of stat cards — four big numbers with
 * small labels. It cannot show proportion and you cannot click it. This is one
 * proportional band above labelled chips: what the estate is made of, and how
 * to narrow it, in the same object.
 *
 * **Colour never carries identity here.** The band is proportion only; every
 * chip beneath it is labelled, because the five status hues fail a
 * colour-vision check as adjacent fills (green↔amber ΔE 4.5 protan). Segments
 * are separated by a real gap, and ON_ORDER is hatched rather than tinted so it
 * is distinguishable from RETIRED, which shares its hue by design — neither
 * state wants attention. That mirrors the dashed-vs-solid dot the status chip
 * already uses.
 *
 * Server component: every control is a `Link`, so the filter works without
 * JavaScript and a filtered register stays a shareable URL.
 */

/** Lifecycle order, not count order — an asset moves left to right through it. */
const BAR_ORDER: readonly AssetStatus[] = [
  "ON_ORDER",
  "IN_STOCK",
  "ASSIGNED",
  "IN_REPAIR",
  "RETIRED",
];

const SEGMENT_FILL: Record<AssetStatus, string> = {
  ON_ORDER: "bg-st-fill-order",
  IN_STOCK: "bg-st-fill-stock",
  ASSIGNED: "bg-st-fill-assigned",
  IN_REPAIR: "bg-st-fill-repair",
  RETIRED: "bg-st-fill-inert",
};

/** Chip tone per status — the same pairs the StatusChip uses, as filter chips. */
const CHIP_TONE: Record<AssetStatus, string> = {
  ON_ORDER: "text-st-inert",
  IN_STOCK: "text-st-stock",
  ASSIGNED: "text-st-assigned",
  IN_REPAIR: "text-st-repair",
  RETIRED: "text-st-inert",
};

const CHIP_ACTIVE_BG: Record<AssetStatus, string> = {
  ON_ORDER: "bg-st-inert-bg",
  IN_STOCK: "bg-st-stock-bg",
  ASSIGNED: "bg-st-assigned-bg",
  IN_REPAIR: "bg-st-repair-bg",
  RETIRED: "bg-st-inert-bg",
};

/** The dot treatment, so the five stay distinguishable without colour vision. */
const CHIP_DOT: Record<AssetStatus, string> = {
  ON_ORDER: "border border-dashed border-current",
  IN_STOCK: "bg-current",
  ASSIGNED: "bg-current",
  IN_REPAIR: "bg-current",
  RETIRED: "border border-current",
};

export type EstateCounts = Record<AssetStatus, number>;

export function EstateBar({
  counts,
  active,
  hrefFor,
}: {
  /** Counts across every status matching the OTHER filters — see the page. */
  counts: EstateCounts;
  /** The status currently filtered on, if any. */
  active: AssetStatus | null;
  /** Builds the href that toggles a status on or off, preserving everything else. */
  hrefFor: (status: AssetStatus | null) => string;
}) {
  const total = BAR_ORDER.reduce((sum, status) => sum + counts[status], 0);

  if (total === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div
        className="flex h-2.5 gap-0.5 overflow-hidden rounded-full"
        // A group, not a list: each child is an alternative filter, and a
        // screen reader gets the same counts from the labelled chips below.
        role="group"
        aria-label="Assets by status"
      >
        {BAR_ORDER.filter((status) => counts[status] > 0).map((status) => (
          <Link
            key={status}
            href={hrefFor(status === active ? null : status)}
            style={{ flexGrow: counts[status] }}
            aria-label={`${STATUS_LABELS[status]}, ${counts[status]} of ${total}`}
            className={cn(
              "focus-visible:ring-ring min-w-1 basis-0 transition-opacity first:rounded-l-full last:rounded-r-full focus-visible:ring-2 focus-visible:outline-none",
              SEGMENT_FILL[status],
              // Hatched, not tinted: ON_ORDER shares RETIRED's grey on purpose.
              status === "ON_ORDER" &&
                "bg-[repeating-linear-gradient(135deg,var(--st-fill-order)_0_3px,transparent_3px_6px)] bg-muted",
              active !== null && status !== active && "opacity-30",
            )}
          />
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {BAR_ORDER.map((status) => {
          const isActive = status === active;
          return (
            <Link
              key={status}
              href={hrefFor(isActive ? null : status)}
              // `aria-current`, not `aria-pressed`: these are links, and
              // aria-pressed only carries meaning on role="button". On an
              // anchor it is ignored, so the active filter would have been
              // announced as nothing at all. `aria-current` is the attribute
              // for "this is the one you are on" among a set of links.
              aria-current={isActive ? "true" : undefined}
              className={cn(
                "focus-visible:ring-ring inline-flex items-center gap-1.5 rounded-full border border-transparent px-2.5 py-1 text-xs font-medium whitespace-nowrap focus-visible:ring-2 focus-visible:outline-none",
                CHIP_TONE[status],
                isActive
                  ? cn(CHIP_ACTIVE_BG[status], "border-current")
                  : "hover:bg-muted",
              )}
            >
              <span
                aria-hidden="true"
                className={cn("size-1.5 rounded-full", CHIP_DOT[status])}
              />
              {STATUS_LABELS[status]}
              <span className="font-mono tabular-nums opacity-80">
                {counts[status]}
              </span>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
