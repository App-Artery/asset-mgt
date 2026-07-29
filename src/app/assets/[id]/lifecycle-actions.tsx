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
import { CONDITION_OPTIONS } from "../asset-form";

/**
 * The AM-02 lifecycle moves. Not the same vocabulary as AssetStatus: IN_STOCK
 * is reachable from two statuses by two different actions (receiving a
 * delivery, returning from repair), and ASSIGNED has no move at all — AM-03
 * owns assignment.
 */
export type LifecycleMove = "RECEIVE" | "SEND_TO_REPAIR" | "RETURN" | "RETIRE";

/**
 * Lifecycle buttons for an asset's current status. The server component
 * derives `moves` from ASSET_TRANSITIONS and renders this only for write
 * roles — but that is UX. The action's requireRole and the lifecycle guard are
 * what actually enforce it.
 */
export function LifecycleActions({
  assetId,
  moves,
}: {
  assetId: string;
  moves: readonly LifecycleMove[];
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
      {moves.includes("RETIRE") ? <RetireForm assetId={assetId} /> : null}
    </div>
  );
}

function ActionMessage({ state }: { state: AssetActionState }) {
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
          {CONDITION_OPTIONS.map((condition) => (
            <option key={condition} value={condition}>
              {condition}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="receive-notes">Notes</Label>
        <Input id="receive-notes" name="notes" disabled={pending} />
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
          {CONDITION_OPTIONS.map((condition) => (
            <option key={condition} value={condition}>
              {condition}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor={`${idPrefix}-notes`}>Notes</Label>
        <Input id={`${idPrefix}-notes`} name="notes" disabled={pending} />
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
function RetireForm({ assetId }: { assetId: string }) {
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
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="retire-notes">Reason</Label>
        <Input id="retire-notes" name="notes" disabled={pending} />
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
