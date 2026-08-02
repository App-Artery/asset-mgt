import Link from "next/link";

/**
 * The register's page footer: what you are looking at, and how to move.
 *
 * Links, not buttons — pagination is URL state, so this works with JavaScript
 * off and page 3 of a filtered register stays a shareable link. That is the
 * same reason the filters and the sort headers are links (AM-09 DESIGN §4.2).
 *
 * No numbered page list. The ACs ask for a range, a total and movement; an
 * ellipsised page list is a second problem (which of 87 pages do you show?)
 * that nothing here has asked for yet. "Page 2 of 9" carries the orientation
 * a numbered list would have provided.
 */
export function RegisterPager({
  page,
  pageCount,
  rangeStart,
  rangeEnd,
  total,
  hrefForPage,
}: {
  /** The page actually being rendered — already clamped by the caller. */
  page: number;
  pageCount: number;
  rangeStart: number;
  rangeEnd: number;
  /** Rows matching the SAME where clause the rendered rows came from. */
  total: number;
  hrefForPage: (page: number) => string;
}) {
  const isPaged = pageCount > 1;

  // "1 assets" reads as a bug, and a register can genuinely hold one asset —
  // a new site, or a category filter narrowed all the way down.
  const noun = total === 1 ? "asset" : "assets";
  // On a single page the range IS the total, so "1–7 of 7 assets" is
  // bureaucratic noise. State the range only once there is somewhere else to
  // be. An en dash, not a hyphen: this is a numeric range.
  const summary = isPaged
    ? `${rangeStart}–${rangeEnd} of ${total} ${noun}`
    : `${total} ${noun}`;

  // tabular-nums so the range does not jitter as the reader pages through —
  // the digits are the thing that changes, and proportional figures shift the
  // whole line when they do.
  const range = (
    <p className="text-muted-foreground font-mono text-sm tabular-nums">
      {summary}
    </p>
  );

  // One page: this is a caption, not navigation. Wrapping it in a <nav> anyway
  // would put a landmark carrying nothing navigable into the landmark list of
  // every screen reader — and a register small enough to fit on one page is
  // the common case for a filtered view.
  if (!isPaged) {
    return <div className="pt-1">{range}</div>;
  }

  return (
    <nav
      aria-label="Register pages"
      className="flex flex-wrap items-center justify-between gap-3 pt-1"
    >
      {range}
      <div className="flex items-center gap-1">
        <PagerStep
          href={page > 1 ? hrefForPage(page - 1) : null}
          rel="prev"
          label="Previous"
        />
        {/* aria-current on neither step: there is no list of pages here for one
            to be current WITHIN. This is the position readout instead. */}
        <p className="text-muted-foreground px-2 font-mono text-sm tabular-nums">
          Page {page} of {pageCount}
        </p>
        <PagerStep
          href={page < pageCount ? hrefForPage(page + 1) : null}
          rel="next"
          label="Next"
        />
      </div>
    </nav>
  );
}

/**
 * One step control, present in both states.
 *
 * At a boundary it renders as text rather than as a disabled link: a link to
 * page 0 is a link to a lie, and an anchor with no href is focusable in some
 * engines and not others. Keeping the element in the layout stops the row
 * from reflowing between the first page and the second.
 */
function PagerStep({
  href,
  rel,
  label,
}: {
  href: string | null;
  rel: "prev" | "next";
  label: string;
}) {
  const arrow = rel === "prev" ? "←" : "→";
  const content = (
    <>
      {rel === "prev" ? <span aria-hidden="true">{arrow}</span> : null}
      {label}
      {rel === "next" ? <span aria-hidden="true">{arrow}</span> : null}
    </>
  );

  if (!href) {
    return (
      <span className="text-muted-foreground/50 inline-flex items-center gap-1.5 rounded-md border border-transparent px-2.5 py-1 text-sm">
        {content}
      </span>
    );
  }

  return (
    <Link
      href={href}
      rel={rel}
      className="hover:bg-muted focus-visible:ring-ring inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-sm focus-visible:ring-2 focus-visible:outline-none"
    >
      {content}
    </Link>
  );
}
