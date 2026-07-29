"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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

export function ReferenceSection({
  kind,
  title,
  rows,
}: {
  kind: ReferenceKind;
  title: string;
  rows: ReferenceRow[];
}) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-medium">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">
          No {kind === "category" ? "categories" : "sites"} yet.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Name</TableHead>
              <TableHead>Assets</TableHead>
              <TableHead>Rename</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <RenameRow key={row.id} kind={kind} row={row} />
            ))}
          </TableBody>
        </Table>
      )}
      <AddForm kind={kind} />
    </section>
  );
}

function RenameRow({ kind, row }: { kind: ReferenceKind; row: ReferenceRow }) {
  const [state, formAction, pending] = useActionState(
    ACTIONS[kind].rename,
    null,
  );

  return (
    <TableRow>
      <TableCell>{row.name}</TableCell>
      <TableCell>{row.assetCount}</TableCell>
      <TableCell>
        <form action={formAction} className="flex items-center gap-2">
          <input type="hidden" name="id" value={row.id} />
          <Input
            name="name"
            defaultValue={row.name}
            required
            maxLength={120}
            disabled={pending}
            aria-label={`Name for ${kind} ${row.name}`}
            className="max-w-56"
          />
          <Button type="submit" variant="outline" size="sm" disabled={pending}>
            {pending ? "Saving…" : "Rename"}
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
      </TableCell>
    </TableRow>
  );
}

function AddForm({ kind }: { kind: ReferenceKind }) {
  const [state, formAction, pending] = useActionState(
    ACTIONS[kind].create,
    null,
  );
  const inputId = `add-${kind}-name`;

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={inputId}>Add {kind}</Label>
        <Input
          id={inputId}
          name="name"
          required
          maxLength={120}
          disabled={pending}
        />
      </div>
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Adding…" : `Add ${kind}`}
      </Button>
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
