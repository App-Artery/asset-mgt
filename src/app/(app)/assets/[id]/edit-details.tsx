"use client";

import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

/**
 * Editing as a mode, not the page's resting state (AM-09 DESIGN §4.3).
 *
 * The ten-field edit form used to be permanently expanded halfway down this
 * page, under two lifecycle forms that were also permanently expanded — so
 * every visit to look one fact up presented three forms first. The form keeps
 * every field it had; it just waits to be asked for.
 *
 * A wrapper rather than a rewrite of AssetForm: the form is unchanged, which is
 * what keeps this a presentation change and leaves its validation, its action
 * and its error surface exactly where they were.
 */
export function EditDetails({
  children,
  summary,
}: {
  /** The form. Rendered only while open, so a cancel truly discards. */
  children: ReactNode;
  /** The read-only view, shown while closed. */
  summary: ReactNode;
}) {
  const [editing, setEditing] = useState(false);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <h2 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          Details
        </h2>
        <span className="flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setEditing((open) => !open)}
          aria-expanded={editing}
        >
          {editing ? "Cancel" : "Edit details"}
        </Button>
      </div>

      {editing ? (
        <>
          <p className="text-muted-foreground text-sm">
            Status is not editable here — it only ever changes through a
            lifecycle action, so every change lands in the history.
          </p>
          {children}
        </>
      ) : (
        summary
      )}
    </section>
  );
}
