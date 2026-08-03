/**
 * An in-page section label (the AM-09 treatment, already used on /assets/[id]).
 *
 * Quiet on purpose: these label regions of a page whose content is the point, so
 * they should read as furniture rather than compete with the `<h1>`. Three
 * treatments existed across four pages.
 *
 * `<h1>`s are NOT this component's business — the register's small title and the
 * asset detail's mono tag are both deliberate, documented choices.
 */
export function SectionHeading({
  children,
  /** Rendered beside the label when the count is the reason you look. */
  count,
  /** A control belonging to the section, pushed to the far end of the row. */
  action,
}: {
  children: React.ReactNode;
  count?: number;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-2">
      <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
        {children}
      </h2>
      {count !== undefined ? (
        <span className="text-muted-foreground font-mono text-xs tabular-nums">
          {count}
        </span>
      ) : null}
      {action ? (
        <>
          <span className="flex-1" />
          {action}
        </>
      ) : null}
    </div>
  );
}
