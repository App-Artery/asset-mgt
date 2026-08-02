"use client";

import { useActionState, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

/**
 * A confirmation dialog wrapped around a server action (AM-09 DESIGN §5).
 *
 * Replaces `window.confirm`, which could not carry a field, could not explain a
 * consequence in more than one sentence, and — because it is a blocking browser
 * modal — could not show the result either. The three call sites it replaces
 * are the closest things this app has to a delete.
 *
 * **What this must never become is a weaker guard than the `confirm()` it
 * replaced.** That is the specific failure LEARNINGS §Frontend records as
 * "lift-verbatim drops cross-cutting guards": the behaviour was correct in the
 * source and was never written down as an acceptance criterion, so the rewrite
 * quietly loses it. The properties being preserved, each with a test:
 *
 *  1. The action cannot fire without a second, explicit act. The trigger opens
 *     the dialog and submits nothing; only the confirm button submits.
 *  2. Dismissing NEVER submits. Escape, the overlay, the X and Cancel all close
 *     and do nothing else — `type="button"` on every one of them, because a
 *     bare <button> inside a <form> is a submit button.
 *  3. While the action is in flight the dialog cannot be dismissed at all, and
 *     the confirm button is disabled. A modal that vanishes mid-flight leaves
 *     the operator with no idea whether the thing happened.
 *  4. The result is shown, not swallowed. A rejection ("this would leave no
 *     active IT admin") is the reason the dialog exists, so it renders in
 *     place and the operator can retry or cancel.
 *
 * It deliberately does NOT close itself on success. Auto-closing would need to
 * react to a state change during render, and for an irreversible action the
 * acknowledgement is worth a click — the page behind has already revalidated,
 * so the dialog is reporting, not blocking.
 */

/**
 * The shape both `AssetActionState` and `UserActionState` already have. Stated
 * concretely rather than as a generic: every action this wraps returns exactly
 * this, and a generic here bought nothing but a variance error.
 */
export type ConfirmActionState = { ok: boolean; message: string } | null;

export function ConfirmActionDialog({
  trigger,
  title,
  description,
  confirmLabel,
  pendingLabel,
  destructive = false,
  action,
  hiddenFields,
  children,
}: {
  /** The button that opens the dialog. Opens it; submits nothing. */
  trigger: ReactNode;
  title: string;
  /** What will happen, and what will NOT — most of these delete nothing. */
  description: ReactNode;
  confirmLabel: string;
  pendingLabel: string;
  destructive?: boolean;
  action: (
    previous: ConfirmActionState,
    formData: FormData,
  ) => Promise<ConfirmActionState>;
  /** Rendered as hidden inputs inside the form. */
  hiddenFields: Record<string, string>;
  /** Extra fields — a reason, a condition note. Rendered above the buttons. */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<
    ConfirmActionState,
    FormData
  >(action, null);

  const succeeded = state?.ok === true;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // The one rule Radix cannot express for us: a close request arriving
        // while the action is in flight is refused outright. Radix routes
        // Escape, the overlay and the X through here, so refusing here covers
        // all three at once.
        if (pending) return;
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent
        showClose={!pending}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (pending) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>
            <div>{description}</div>
          </DialogDescription>
        </DialogHeader>

        <form action={formAction} className="flex flex-col gap-4">
          {Object.entries(hiddenFields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}

          {succeeded ? null : children}

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

          <DialogFooter>
            {succeeded ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
              >
                Done
              </Button>
            ) : (
              <>
                <Button
                  // type="button" is load-bearing: a bare <button> inside a
                  // <form> defaults to type="submit", which would turn Cancel
                  // into the very action it is cancelling.
                  type="button"
                  variant="outline"
                  disabled={pending}
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant={destructive ? "destructive" : "default"}
                  disabled={pending}
                >
                  {pending ? pendingLabel : confirmLabel}
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
