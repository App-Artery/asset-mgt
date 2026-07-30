"use client";

import type { AssetActionState } from "../actions";

/**
 * The result banner every lifecycle and assignment form shows.
 *
 * Its own module rather than an export from lifecycle-actions.tsx: that file
 * composes the assignment forms, so exporting this from there and importing it
 * back would make the two modules circular.
 */
export function ActionMessage({ state }: { state: AssetActionState }) {
  if (!state) return null;
  return (
    <p
      role="status"
      className={
        state.ok ? "text-muted-foreground text-sm" : "text-destructive text-sm"
      }
    >
      {state.message}
    </p>
  );
}
