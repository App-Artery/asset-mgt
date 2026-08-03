import { Fragment } from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * The phone shape of a table (docs/DESIGN-SYSTEM.md §5).
 *
 * These are the card equivalents of the `Table*` primitives next door: a shell
 * with no opinion about content, so every screen's card is recognisably the
 * same object without any of them having to agree on fields.
 *
 * Deliberately NOT responsible for the breakpoint. `ResponsiveTable` owns
 * `md:hidden`, and it owns it alone — two components each setting half of one
 * breakpoint is exactly how the table and the cards end up appearing at
 * different widths.
 */
export function DataCardList({
  label,
  children,
}: {
  /** Announced by a screen reader in place of the table's caption. */
  label: string;
  children: React.ReactNode;
}) {
  return (
    <ul className="flex flex-col gap-2" aria-label={label}>
      {children}
    </ul>
  );
}

export function DataCard({
  href,
  className,
  children,
}: {
  /** When the whole card is a destination — the common case. */
  href?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const shell = cn(
    "hover:bg-muted/50 flex flex-col gap-1.5 rounded-lg border p-3",
    className,
  );
  return (
    <li>
      {href ? (
        <Link href={href} className={shell}>
          {children}
        </Link>
      ) : (
        // A card carrying its own controls, or its own inner links, cannot be
        // wrapped in one: nesting an anchor, a button or a select inside an
        // anchor is invalid HTML and swallows the click. /admin/users and the
        // assignment cards are those cases.
        <div className={shell}>{children}</div>
      )}
    </li>
  );
}

/** The headline line: the card's proper noun left, its one status right. */
export function DataCardHeadline({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2">{children}</div>
  );
}

/**
 * Secondary metadata, dot-joined.
 *
 * Interleaves separators between NODES rather than joining strings, because a
 * meta line often carries a `<time>` element. `[a, b].filter(Boolean).join()`
 * works right up until one part stops being a string, and then renders
 * "[object Object]".
 */
export function DataCardMeta({ parts }: { parts: React.ReactNode[] }) {
  // Explicitly empty, NOT filter(Boolean). `React.ReactNode` admits `0`, and a
  // falsy filter would silently drop a legitimate count — every caller happens
  // to pass strings today, which is exactly the kind of luck that stops holding
  // the first time someone passes a number.
  const shown = parts.filter(
    (part) =>
      part !== null && part !== undefined && part !== "" && part !== false,
  );
  if (shown.length === 0) {
    // No parts is no line — an empty muted span still occupies a gap.
    return null;
  }
  return (
    <span
      data-testid="data-card-meta"
      className="text-muted-foreground text-xs"
    >
      {shown.map((part, index) => (
        // Index keys are safe here: every part is stateless and the whole list
        // re-renders from server props.
        <Fragment key={index}>
          {/* The spaces sit OUTSIDE the aria-hidden span. Hiding them too
              leaves some screen readers concatenating adjacent inline text with
              no boundary — "Jane MwangiNairobiLaptop". */}
          {index > 0 ? (
            <>
              {" "}
              <span aria-hidden="true">·</span>{" "}
            </>
          ) : null}
          {part}
        </Fragment>
      ))}
    </span>
  );
}
