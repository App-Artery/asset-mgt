"use client";

import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  receiveAndTagAsset,
  retireAsset,
  returnFromRepair,
  sendToRepair,
  type AssetActionState,
} from "../actions";
import { CONDITION_LABELS, CONDITION_ORDER } from "@/lib/labels";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { FormDialog } from "@/components/form-dialog";
import { EventNoteHint } from "./event-note-hint";
import {
  AssignDialog,
  ReturnFromPersonDialog,
  type PickerPerson,
  type ReturnDestination,
} from "./assignment-actions";

/**
 * The lifecycle moves. Not the same vocabulary as AssetStatus: IN_STOCK is
 * reachable from three statuses by three different actions (receiving a
 * delivery, returning from repair, taking an asset back from its holder), so
 * the move names the operator's intent and the status alone cannot.
 *
 * RETURN_FROM_PERSON covers BOTH ways out of ASSIGNED that are not retirement:
 * a repair-bound return is that same action with toStatus=IN_REPAIR, never a
 * separate "send to repair" (AM-03 DESIGN §4.2).
 */
export type LifecycleMove =
  | "RECEIVE"
  | "ASSIGN"
  | "SEND_TO_REPAIR"
  | "RETURN"
  | "RETURN_FROM_PERSON"
  | "RETIRE";

/**
 * The affordance for each move. The trailing ellipsis is this app's convention
 * for "opens a dialog and asks for something" — the same signal `Deactivate…`
 * carries on the users screen.
 */
const MOVE_LABELS: Readonly<Record<LifecycleMove, string>> = {
  RECEIVE: "Receive and tag…",
  ASSIGN: "Assign…",
  RETURN_FROM_PERSON: "Take it back…",
  RETURN: "Return from repair…",
  SEND_TO_REPAIR: "Send to repair…",
  RETIRE: "Retire asset…",
};

/**
 * Which move leads, when a status offers several.
 *
 * Stated here rather than taken from the order `lifecycleMovesFor` happens to
 * push in: the server derives what is LEGAL from the transition map, and which
 * of the legal moves is the likely next step is a UI judgement. Reading the
 * primary off array order would couple the two silently.
 *
 * The order is the operator's own: the move that advances the asset's life comes
 * first, and RETIRE — the closest thing this app has to a delete — is always
 * last, so it is never the button under the cursor.
 */
const MOVE_PRIORITY: readonly LifecycleMove[] = [
  "RECEIVE",
  "ASSIGN",
  "RETURN_FROM_PERSON",
  "RETURN",
  "SEND_TO_REPAIR",
  "RETIRE",
];

/**
 * Lifecycle actions for an asset's current status: one primary button and a
 * `More` menu (AM-09 DESIGN §4.3). The server component derives `moves` from
 * ASSET_TRANSITIONS and renders this only for write roles — but that is UX. The
 * action's requireRole and the lifecycle guard are what actually enforce it.
 *
 * Every form opens in a focused dialog. Before #10 they were stacked and
 * permanently expanded, so an ASSIGNED asset opened with a complete return form
 * — three selects and a note field — before anyone had decided to return it.
 */
export function LifecycleActions({
  assetId,
  moves,
  people,
  returnDestinations,
}: {
  assetId: string;
  moves: readonly LifecycleMove[];
  /** Populated only when the assign form renders; never carries an email. */
  people: readonly PickerPerson[];
  returnDestinations: readonly ReturnDestination[];
}) {
  if (moves.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        Retired assets are read-only: the record and its history stay, but the
        lifecycle ends here.
      </p>
    );
  }

  const [primary, ...secondary] = MOVE_PRIORITY.filter((move) =>
    moves.includes(move),
  );

  const dialogFor = (move: LifecycleMove, trigger: ReactNode) => (
    <MoveDialog
      key={move}
      move={move}
      trigger={trigger}
      assetId={assetId}
      people={people}
      returnDestinations={returnDestinations}
      // RETURN_FROM_PERSON is offered from ASSIGNED and nowhere else, so it is
      // the signal that this asset is currently held.
      isHeld={moves.includes("RETURN_FROM_PERSON")}
    />
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      {primary
        ? dialogFor(
            primary,
            <Button type="button" className="w-fit">
              {MOVE_LABELS[primary]}
            </Button>,
          )
        : null}
      {secondary.length > 0 ? (
        <MoreMenu>
          {secondary.map((move) =>
            dialogFor(
              move,
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-full justify-start"
              >
                {MOVE_LABELS[move]}
              </Button>,
            ),
          )}
        </MoreMenu>
      ) : null}
    </div>
  );
}

/**
 * The secondary moves, one step away.
 *
 * A native `<details>` rather than a menu library. Three reasons, in order of
 * weight: it needs no new dependency (Radix's dialog is the only one in the tree
 * and adding a dropdown for four items is not a trade this earns); its items are
 * in the server-rendered markup whether it is open or not, which is what lets
 * the AM-03 acceptance tests keep asserting WHICH moves a status offers; and it
 * is keyboard- and screen-reader-operable with no code of ours in the path.
 *
 * It does not close when a dialog opens over it. Radix returns focus to the
 * trigger inside it on close, which is the behaviour that matters; forcing the
 * disclosure shut would fight that for a cosmetic gain.
 */
function MoreMenu({ children }: { children: ReactNode }) {
  return (
    <details className="group relative">
      <summary className="border-input bg-background hover:bg-accent hover:text-accent-foreground focus-visible:border-ring focus-visible:ring-ring/50 dark:bg-input/30 dark:hover:bg-input/50 inline-flex h-9 cursor-pointer list-none items-center justify-center rounded-md border px-4 py-2 text-sm font-medium shadow-xs transition-all outline-none select-none focus-visible:ring-[3px] [&::-webkit-details-marker]:hidden">
        More
      </summary>
      <div className="bg-popover absolute right-0 z-20 mt-1 flex min-w-48 flex-col rounded-lg border p-1 shadow-lg">
        {children}
      </div>
    </details>
  );
}

/** One move, one dialog. The trigger is supplied so the caller decides its rank. */
function MoveDialog({
  move,
  trigger,
  assetId,
  people,
  returnDestinations,
  isHeld,
}: {
  move: LifecycleMove;
  trigger: ReactNode;
  assetId: string;
  people: readonly PickerPerson[];
  returnDestinations: readonly ReturnDestination[];
  isHeld: boolean;
}) {
  switch (move) {
    case "RECEIVE":
      return <ReceiveDialog assetId={assetId} trigger={trigger} />;
    case "ASSIGN":
      return (
        <AssignDialog assetId={assetId} people={people} trigger={trigger} />
      );
    case "RETURN_FROM_PERSON":
      return (
        <ReturnFromPersonDialog
          assetId={assetId}
          destinations={returnDestinations}
          trigger={trigger}
        />
      );
    case "SEND_TO_REPAIR":
      return (
        <RepairDialog
          assetId={assetId}
          trigger={trigger}
          action={sendToRepair}
          title="Send to repair"
          description="It leaves stock until it comes back. The asset keeps its tag and its history."
          submitLabel="Send to repair"
          pendingLabel="Sending…"
          defaultCondition="DEFECTIVE"
        />
      );
    case "RETURN":
      return (
        <RepairDialog
          assetId={assetId}
          trigger={trigger}
          action={returnFromRepair}
          title="Return from repair"
          description="Back on the shelf, in whatever condition it came back in."
          submitLabel="Return to stock"
          pendingLabel="Saving…"
          defaultCondition="GOOD"
        />
      );
    case "RETIRE":
      return (
        <RetireDialog assetId={assetId} trigger={trigger} isHeld={isHeld} />
      );
  }
}

/** ON_ORDER -> IN_STOCK. The tag is mandatory here; the DB CHECK is the backstop. */
function ReceiveDialog({
  assetId,
  trigger,
}: {
  assetId: string;
  trigger: ReactNode;
}) {
  return (
    <FormDialog
      action={receiveAndTagAsset}
      hiddenFields={{ assetId }}
      trigger={trigger}
      title="Receive and tag"
      description="A tag is mandatory from delivery onwards — the register tracks the asset by it from here."
      submitLabel="Receive and tag"
      pendingLabel="Receiving…"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="receive-tag">Asset tag</Label>
        <Input id="receive-tag" name="tag" required />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="receive-condition">Condition on arrival</Label>
        <Select id="receive-condition" name="condition" defaultValue="NEW">
          <option value="">Not recorded</option>
          {CONDITION_ORDER.map((condition) => (
            <option key={condition} value={condition}>
              {CONDITION_LABELS[condition]}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="receive-notes">Notes</Label>
        <Input id="receive-notes" name="notes" />
        <EventNoteHint />
      </div>
    </FormDialog>
  );
}

/** The repair loop, in both directions — same fields, different action. */
function RepairDialog({
  assetId,
  trigger,
  action,
  title,
  description,
  submitLabel,
  pendingLabel,
  defaultCondition,
}: {
  assetId: string;
  trigger: ReactNode;
  action: (
    previous: AssetActionState,
    formData: FormData,
  ) => Promise<AssetActionState>;
  title: string;
  description: string;
  submitLabel: string;
  pendingLabel: string;
  defaultCondition: string;
}) {
  const idPrefix = title.toLowerCase().replace(/\s+/g, "-");
  return (
    <FormDialog
      action={action}
      hiddenFields={{ assetId }}
      trigger={trigger}
      title={title}
      description={description}
      submitLabel={submitLabel}
      pendingLabel={pendingLabel}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-condition`}>Condition</Label>
        <Select
          id={`${idPrefix}-condition`}
          name="condition"
          defaultValue={defaultCondition}
        >
          <option value="">Leave unchanged</option>
          {CONDITION_ORDER.map((condition) => (
            <option key={condition} value={condition}>
              {CONDITION_LABELS[condition]}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-notes`}>Notes</Label>
        <Input id={`${idPrefix}-notes`} name="notes" />
        <EventNoteHint />
      </div>
    </FormDialog>
  );
}

/**
 * RETIRED is terminal and is the closest thing to a delete this app has.
 *
 * The one lifecycle move that stays a ConfirmActionDialog rather than becoming a
 * FormDialog: it takes a field, but what it is asking for is consent, and the
 * dialog says what retiring does NOT do. Nothing here is ever deleted, and a
 * confirmation that fails to say so invites the operator to hesitate over the
 * one action they are allowed to take.
 */
function RetireDialog({
  assetId,
  trigger,
  isHeld,
}: {
  assetId: string;
  trigger: ReactNode;
  isHeld: boolean;
}) {
  return (
    <ConfirmActionDialog
      action={retireAsset}
      hiddenFields={{ assetId }}
      trigger={trigger}
      title="Retire this asset?"
      description={
        <>
          <p>
            It leaves the active register and stays in it forever — retired
            assets are never deleted, and this page keeps working.
          </p>
          {isHeld ? (
            <p className="mt-2">
              It is still out with someone. Retiring closes that assignment for
              you: stolen and lost kit must be retirable without first recording
              a return that never happened.
            </p>
          ) : null}
        </>
      }
      confirmLabel="Retire asset"
      pendingLabel="Retiring…"
      destructive
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="retire-notes">Reason</Label>
        <Input id="retire-notes" name="notes" />
        <EventNoteHint />
      </div>
    </ConfirmActionDialog>
  );
}
