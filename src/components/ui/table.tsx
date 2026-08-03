import * as React from "react";

import { cn } from "@/lib/utils";

// Hand-written shadcn-style table primitives (scaffold pattern — no shadcn
// CLI). The wrapper div owns horizontal overflow so wide tables never
// scroll the page body.
//
// `containerClassName` exists for one reason: `overflow-x-auto` makes this div
// a scroll container on BOTH axes (CSS computes a `visible` axis to `auto` when
// its partner is not), so a `sticky` header inside it anchors to this div and
// not to the viewport. A caller that wants a sticky header must therefore give
// the container a height to scroll within — see the register (AM-09 DESIGN
// §4.2). Passing layout classes here is the only supported way to do that;
// removing the wrapper would put the horizontal scroll back on the page body.
function Table({
  className,
  containerClassName,
  ...props
}: React.ComponentProps<"table"> & { containerClassName?: string }) {
  return (
    <div
      data-slot="table-container"
      className={cn("relative w-full overflow-x-auto", containerClassName)}
    >
      <table
        data-slot="table"
        className={cn("w-full caption-bottom text-sm", className)}
        {...props}
      />
    </div>
  );
}

function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return (
    <thead
      data-slot="table-header"
      className={cn("[&_tr]:border-b", className)}
      {...props}
    />
  );
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-body"
      className={cn("[&_tr:last-child]:border-0", className)}
      {...props}
    />
  );
}

function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        "hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors",
        className,
      )}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        "text-foreground h-10 px-2 text-left align-middle font-medium whitespace-nowrap",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn("p-2 align-middle whitespace-nowrap", className)}
      {...props}
    />
  );
}

/**
 * The sticky treatment, applied to header cells only.
 *
 * Targeted at `thead th` from the `<table>` element rather than pasted onto
 * each `TableHead` — the register had this constant and spread it across seven
 * `SortableHead` call sites, which is seven chances to add an eighth column
 * without it.
 *
 * `sticky top-0` alone is not enough: rows scroll THROUGH a header that paints
 * no background, and the bottom rule has to be an inset shadow because a `<th>`
 * border does not travel with a sticky element in every engine.
 */
const STICKY_HEAD =
  "[&_thead_th]:bg-background [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:shadow-[inset_0_-1px_0_var(--border)]";

/**
 * A scroll pane for a table that can grow without bound and sits below other
 * content. The register does NOT use this — its `max-h-[calc(100vh-19rem)]` is
 * tuned to its own chrome (title, estate bar, filter row) and means nothing on
 * another page.
 */
export const SCROLL_PANE = "max-h-[32rem] min-h-32";

/**
 * One table, two shapes (docs/DESIGN-SYSTEM.md §5).
 *
 * `<table>` at `md:` and above, a stacked card list below, from the same row
 * data in the same component. Two separate screens would drift; a
 * `useMediaQuery` would turn a server component into a client one for no gain.
 *
 * **`cards` is required, and that is the point.** It is not a convenience
 * prop — it is the reason a table added to this app in a year cannot ship
 * without a phone shape. A lint rule or a review checklist would catch the same
 * mistake later and less reliably.
 *
 * `sticky` is meaningless without `containerClassName` bounding the height: the
 * wrapper is `overflow-x-auto`, which CSS computes to `auto` on BOTH axes, so
 * the header anchors to that div rather than the viewport and a div that never
 * scrolls never sticks.
 *
 * So the two are a UNION, not two independent optionals — `sticky` on its own
 * does not typecheck. Same reasoning as `cards` above: a silent no-op that a
 * docblock warns about is a mistake waiting to be made, and the compiler is a
 * better place to catch it than a review. Pass `SCROLL_PANE` unless you have a
 * tuned value (the register does).
 */
type ResponsiveTableProps = {
  cards: React.ReactNode;
  tableTestId: string;
  cardsTestId: string;
  children: React.ReactNode;
} & (
  | { sticky: true; containerClassName: string }
  | { sticky?: false; containerClassName?: string }
);

function ResponsiveTable({
  cards,
  tableTestId,
  cardsTestId,
  sticky,
  containerClassName,
  children,
}: ResponsiveTableProps) {
  return (
    <>
      {/* Above md: the dense table. Its whitespace-nowrap and horizontal
          overflow are correct here and only here. */}
      <div data-testid={tableTestId} className="hidden md:block">
        <Table
          containerClassName={containerClassName}
          className={cn(sticky && STICKY_HEAD)}
        >
          {children}
        </Table>
      </div>
      {/* Below md: one card per row. */}
      <div data-testid={cardsTestId} className="md:hidden">
        {cards}
      </div>
    </>
  );
}

export {
  ResponsiveTable,
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
};
