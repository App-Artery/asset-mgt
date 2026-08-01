"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createCategory,
  createSite,
  renameCategory,
  renameSite,
} from "./actions";

export type ReferenceKind = "category" | "site";

export type ReferenceRow = {
  id: string;
  name: string;
  assetCount: number;
};

// Categories and sites are the same shape with the same two operations, so one
// section renders both; the action pair is picked here rather than passed down
// so the server actions stay statically imported (as in users-table.tsx).
const ACTIONS = {
  category: { create: createCategory, rename: renameCategory },
  site: { create: createSite, rename: renameSite },
} as const;

/** The register filter each count links to. */
const FILTER_PARAM = { category: "categoryId", site: "siteId" } as const;

/**
 * A list you read, not a form you fill in (AM-09 DESIGN §4.5).
 *
 * This page used to render a text input and a Rename button on every row —
 * 22 of them — for an operation that happens maybe twice a year, with each
 * row's name printed immediately to the left of an input pre-filled with the
 * same string. The counts, which are the only reason anyone opens this page
 * between renames, were inert text.
 *
 * So the count becomes the content and a link into the filtered register, and
 * rename retreats behind a per-row control.
 */
export function ReferenceSection({
  kind,
  title,
  rows,
}: {
  kind: ReferenceKind;
  title: string;
  rows: ReferenceRow[];
}) {
  const busiest = Math.max(1, ...rows.map((row) => row.assetCount));

  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex items-baseline gap-2">
        <h2 className="font-semibold">{title}</h2>
        <span className="text-muted-foreground font-mono text-xs tabular-nums">
          {rows.length}
        </span>
      </div>

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No {kind === "category" ? "categories" : "sites"} yet. Add the first
          one below.
        </p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((row) => (
            <ReferenceItem
              key={row.id}
              kind={kind}
              row={row}
              busiest={busiest}
            />
          ))}
        </ul>
      )}

      <AddForm kind={kind} />
    </section>
  );
}

function ReferenceItem({
  kind,
  row,
  busiest,
}: {
  kind: ReferenceKind;
  row: ReferenceRow;
  busiest: number;
}) {
  const [renaming, setRenaming] = useState(false);
  const [state, formAction, pending] = useActionState(
    ACTIONS[kind].rename,
    null,
  );

  if (renaming) {
    return (
      <li className="border-b py-1.5">
        <form action={formAction} className="flex flex-wrap items-center gap-2">
          <input type="hidden" name="id" value={row.id} />
          <Input
            name="name"
            defaultValue={row.name}
            required
            maxLength={120}
            disabled={pending}
            autoFocus
            aria-label={`New name for ${kind} ${row.name}`}
            className="h-8 max-w-56"
          />
          <Button type="submit" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Save"}
          </Button>
          <Button
            // type="button", or this submits the form it sits in — the
            // classic cancel-button bug (LEARNINGS §Frontend).
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => setRenaming(false)}
          >
            Cancel
          </Button>
          {state ? (
            <span
              role="status"
              className={
                state.ok
                  ? "text-muted-foreground text-xs"
                  : "text-destructive text-xs"
              }
            >
              {state.message}
            </span>
          ) : null}
        </form>
      </li>
    );
  }

  const share = Math.round((row.assetCount / busiest) * 100);

  return (
    // `group` + focus-within, not hover alone: a hover-only control is
    // unreachable by keyboard and invisible to touch, so it also stays visible
    // whenever anything inside the row has focus.
    <li className="group hover:bg-muted/50 flex items-center gap-3 border-b py-1.5 pr-1">
      <span className="min-w-0 flex-1 truncate text-sm">{row.name}</span>

      {row.assetCount === 0 ? (
        // Nothing here is ever deleted, so an unused row cannot be tidied
        // away — labelling it is the most the UI can do.
        <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-xs">
          unused
        </span>
      ) : null}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setRenaming(true)}
        className="opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100 focus-visible:opacity-100 max-md:opacity-100"
      >
        Rename
      </Button>

      {/* Every count is a link (AM-09 DESIGN §3.5): "112 laptops" is an answer
          someone wants to open, and this is the only breakdown of the estate
          by category the app has. */}
      {row.assetCount === 0 ? (
        <span className="text-muted-foreground w-10 text-right font-mono text-xs tabular-nums">
          0
        </span>
      ) : (
        <Link
          href={`/assets?${FILTER_PARAM[kind]}=${row.id}`}
          className="w-10 text-right font-mono text-xs tabular-nums underline underline-offset-4"
        >
          {row.assetCount}
        </Link>
      )}

      {/* Magnitude only, one series, muted ink — the list is already sorted by
          name, so this is what makes 112 vs 12 legible without reading digits. */}
      <span
        aria-hidden="true"
        className="bg-muted hidden h-1 w-14 shrink-0 overflow-hidden rounded-full sm:block"
      >
        <span
          className="bg-muted-foreground/50 block h-full"
          style={{ width: `${Math.max(share, 2)}%` }}
        />
      </span>
    </li>
  );
}

function AddForm({ kind }: { kind: ReferenceKind }) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState(
    ACTIONS[kind].create,
    null,
  );
  const inputId = `add-${kind}-name`;

  if (!open) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-fit"
        onClick={() => setOpen(true)}
      >
        Add {kind}
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-2">
      <Label htmlFor={inputId}>New {kind}</Label>
      <div className="flex items-center gap-2">
        <Input
          id={inputId}
          name="name"
          required
          maxLength={120}
          disabled={pending}
          autoFocus
          className="h-8"
        />
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "Adding…" : "Add"}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => setOpen(false)}
        >
          Cancel
        </Button>
      </div>
      {state ? (
        <p
          role="status"
          className={
            state.ok
              ? "text-muted-foreground text-sm"
              : "text-destructive text-sm"
          }
        >
          {state.message}
        </p>
      ) : null}
    </form>
  );
}
