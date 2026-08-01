import type { AssetStatus } from "@prisma/client";
import { cva, type VariantProps } from "class-variance-authority";

import { STATUS_LABELS } from "@/lib/asset-lifecycle";
import { cn } from "@/lib/utils";

/**
 * The status vocabulary as colour (docs/DESIGN-SYSTEM.md §6).
 *
 * Built with cva rather than a status->class map merged into cn(), because a
 * per-entity colour map spread into the same cn() call is exactly how a
 * semantic token gets silently evicted by a later text-* utility
 * (LEARNINGS §Frontend). Callers pass layout classes; the tone is not theirs
 * to override.
 *
 * ON_ORDER and RETIRED share the inert pair deliberately — neither state wants
 * attention — and are told apart by the dot: dashed ring for "not here yet",
 * solid ring for "terminal". Colour is never the only signal; every chip also
 * carries its text label, so the five stay distinguishable without colour
 * vision.
 *
 * The only import from @prisma/client is a type, so this module stays
 * client-safe and never drags the Prisma client into the browser bundle —
 * matching the same rule in asset-lifecycle.ts.
 */
const chipVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap [&>span]:size-1.5 [&>span]:rounded-full",
  {
    variants: {
      tone: {
        stock: "bg-st-stock-bg text-st-stock [&>span]:bg-current",
        assigned: "bg-st-assigned-bg text-st-assigned [&>span]:bg-current",
        repair: "bg-st-repair-bg text-st-repair [&>span]:bg-current",
        order:
          "bg-st-inert-bg text-st-inert ring-border ring-1 ring-inset [&>span]:border [&>span]:border-dashed [&>span]:border-current",
        retired:
          "bg-st-inert-bg text-st-inert [&>span]:border [&>span]:border-current",
      },
    },
    defaultVariants: { tone: "retired" },
  },
);

const STATUS_TONES: Record<
  AssetStatus,
  NonNullable<VariantProps<typeof chipVariants>["tone"]>
> = {
  IN_STOCK: "stock",
  ASSIGNED: "assigned",
  IN_REPAIR: "repair",
  ON_ORDER: "order",
  RETIRED: "retired",
};

export function StatusChip({
  status,
  className,
}: {
  status: AssetStatus;
  className?: string;
}) {
  return (
    <span
      data-testid="status-chip"
      // Caller classes go FIRST, inverting the usual shadcn order, so the tone
      // wins every conflict. Deliberate: tailwind-merge classifies
      // `text-st-repair` as a text-COLOUR (verified — twMerge("text-st-repair",
      // "text-muted-foreground") returns only the latter), so with the usual
      // order any caller colour silently evicts the status colour and the chip
      // renders a lie. Non-conflicting layout classes still pass through.
      className={cn(className, chipVariants({ tone: STATUS_TONES[status] }))}
    >
      <span aria-hidden="true" />
      {STATUS_LABELS[status]}
    </span>
  );
}
