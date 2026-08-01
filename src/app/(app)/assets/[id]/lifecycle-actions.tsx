"use client";

import { useActionState } from "react";
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
import { ActionMessage } from "./action-message";
import {
  AssignForm,
  ReturnFromPersonForm,
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
/**
 * The standing warning on every free-text field that lands in `AssetEvent.notes`.
 *
 * `notes` is the one PII channel the code cannot close: `CLAUDE.md` forbids the
 * application from writing personal data into the append-only event tables, and
 * it does not — but an operator can type a name into a text box, and that text
 * is rendered to ALL FOUR roles including STAFF_RO, who are otherwise shown no
 * person data at all (AM-03 DESIGN §2.1). `AssetEvent` is never updated and
 * never deleted, so a name typed here cannot be corrected or erased.
 *
 * "Reason" on retirement is the field most likely to attract one ("stolen from
 * X's car"), which is why the hint is on every one of them and not just assign.
 */
function EventNoteHint() {
  return (
    <p className="text-muted-foreground text-xs">
      Never personal data: this lands in the permanent event log, is visible to
      all staff, and cannot be edited or removed. Describe the asset, not a
      person.
    </p>
  );
}

export type LifecycleMove =
  | "RECEIVE"
  | "ASSIGN"
  | "SEND_TO_REPAIR"
  | "RETURN"
  | "RETURN_FROM_PERSON"
  | "RETIRE";

/**
 * Lifecycle buttons for an asset's current status. The server component
 * derives `moves` from ASSET_TRANSITIONS and renders this only for write
 * roles — but that is UX. The action's requireRole and the lifecycle guard are
 * what actually enforce it.
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
  return (
    <div className="flex flex-col gap-6">
      {moves.includes("RECEIVE") ? <ReceiveForm assetId={assetId} /> : null}
      {moves.includes("ASSIGN") ? (
        <AssignForm assetId={assetId} people={people} />
      ) : null}
      {moves.includes("RETURN_FROM_PERSON") ? (
        <ReturnFromPersonForm
          assetId={assetId}
          destinations={returnDestinations}
        />
      ) : null}
      {moves.includes("SEND_TO_REPAIR") ? (
        <RepairForm
          assetId={assetId}
          action={sendToRepair}
          title="Send to repair"
          submitLabel="Send to repair"
          defaultCondition="DEFECTIVE"
        />
      ) : null}
      {moves.includes("RETURN") ? (
        <RepairForm
          assetId={assetId}
          action={returnFromRepair}
          title="Return from repair"
          submitLabel="Return to stock"
          defaultCondition="GOOD"
        />
      ) : null}
      {moves.includes("RETIRE") ? (
        <RetireForm
          assetId={assetId}
          // RETURN_FROM_PERSON is offered from ASSIGNED and nowhere else, so it
          // is the signal that this asset is currently held.
          isHeld={moves.includes("RETURN_FROM_PERSON")}
        />
      ) : null}
    </div>
  );
}

/** ON_ORDER -> IN_STOCK. The tag is mandatory here; the DB CHECK is the backstop. */
function ReceiveForm({ assetId }: { assetId: string }) {
  const [state, formAction, pending] = useActionState(receiveAndTagAsset, null);
  return (
    <form action={formAction} className="flex max-w-md flex-col gap-3">
      <h3 className="font-medium">Receive and tag</h3>
      <input type="hidden" name="assetId" value={assetId} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="receive-tag">Asset tag</Label>
        <Input id="receive-tag" name="tag" required disabled={pending} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="receive-condition">Condition on arrival</Label>
        <Select
          id="receive-condition"
          name="condition"
          defaultValue="NEW"
          disabled={pending}
        >
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
        <Input id="receive-notes" name="notes" disabled={pending} />
        <EventNoteHint />
      </div>
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Receiving…" : "Receive and tag"}
      </Button>
      <ActionMessage state={state} />
    </form>
  );
}

/** The repair loop, in both directions — same fields, different action. */
function RepairForm({
  assetId,
  action,
  title,
  submitLabel,
  defaultCondition,
}: {
  assetId: string;
  action: (
    previous: AssetActionState,
    formData: FormData,
  ) => Promise<AssetActionState>;
  title: string;
  submitLabel: string;
  defaultCondition: string;
}) {
  const [state, formAction, pending] = useActionState(action, null);
  const idPrefix = title.toLowerCase().replace(/\s+/g, "-");
  return (
    <form action={formAction} className="flex max-w-md flex-col gap-3">
      <h3 className="font-medium">{title}</h3>
      <input type="hidden" name="assetId" value={assetId} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-condition`}>Condition</Label>
        <Select
          id={`${idPrefix}-condition`}
          name="condition"
          defaultValue={defaultCondition}
          disabled={pending}
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
        <Input id={`${idPrefix}-notes`} name="notes" disabled={pending} />
        <EventNoteHint />
      </div>
      <Button
        type="submit"
        variant="outline"
        disabled={pending}
        className="w-fit"
      >
        {pending ? "Saving…" : submitLabel}
      </Button>
      <ActionMessage state={state} />
    </form>
  );
}

/** RETIRED is terminal and is the closest thing to a delete this app has. */
function RetireForm({ assetId, isHeld }: { assetId: string; isHeld: boolean }) {
  const [state, formAction, pending] = useActionState(retireAsset, null);
  return (
    <form
      action={formAction}
      className="flex max-w-md flex-col gap-3"
      onSubmit={(event) => {
        if (
          !window.confirm(
            "Retire this asset? Retirement is permanent — the record and its history stay, but the asset cannot re-enter the register.",
          )
        ) {
          event.preventDefault();
        }
      }}
    >
      <h3 className="font-medium">Retire</h3>
      <input type="hidden" name="assetId" value={assetId} />
      {isHeld ? (
        <p className="text-muted-foreground text-sm">
          This asset is still out with someone. Retiring it closes the
          assignment for you — stolen and lost kit must be retirable without
          first recording a return that never happened.
        </p>
      ) : null}
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="retire-notes">Reason</Label>
        <Input id="retire-notes" name="notes" disabled={pending} />
        <EventNoteHint />
      </div>
      <Button
        type="submit"
        variant="destructive"
        disabled={pending}
        className="w-fit"
      >
        {pending ? "Retiring…" : "Retire asset"}
      </Button>
      <ActionMessage state={state} />
    </form>
  );
}
