"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { conditionNotesRequiredFor } from "@/lib/asset-lifecycle";
import { assignAssetToPerson, returnAssetFromPerson } from "../actions";
import { CONDITION_OPTIONS } from "../asset-form";
import { ActionMessage } from "./action-message";

/**
 * The person picker's row shape. Deliberately NOT the shape personSelectFor
 * returns: email never crosses to the client, whatever the viewer's role. The
 * picker's job is to tell two staff with the same name apart, and employeeRef —
 * the organisation's own internal number — is the field chosen for that.
 */
export type PickerPerson = {
  id: string;
  name: string;
  employeeRef: string | null;
};

/** Where a return may land. Mirrors RETURN_STATUSES, which is server-only. */
export type ReturnDestination = "IN_STOCK" | "IN_REPAIR";

/**
 * Phrased as the operator's intent rather than reusing STATUS_LABELS: this is a
 * choice between two ways of taking a laptop back, not a status picker.
 */
const DESTINATION_LABELS: Record<ReturnDestination, string> = {
  IN_STOCK: "Back to stock",
  IN_REPAIR: "Straight to repair",
};

type ConditionOption = (typeof CONDITION_OPTIONS)[number];

/** IN_STOCK -> ASSIGNED. Opens the assignment; the picker is over existing Person rows. */
export function AssignForm({
  assetId,
  people,
}: {
  assetId: string;
  people: readonly PickerPerson[];
}) {
  const [state, formAction, pending] = useActionState(
    assignAssetToPerson,
    null,
  );

  if (people.length === 0) {
    return (
      <div className="flex max-w-md flex-col gap-2">
        <h3 className="font-medium">Assign</h3>
        <p className="text-muted-foreground text-sm">
          There are no staff records to assign to. Staff are loaded by the seed
          script — this release has no screen for creating them (AM-03-CF-1).
        </p>
      </div>
    );
  }

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-3">
      <h3 className="font-medium">Assign</h3>
      <input type="hidden" name="assetId" value={assetId} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="assign-person">Assign to</Label>
        <Select
          id="assign-person"
          name="personId"
          defaultValue=""
          required
          disabled={pending}
        >
          <option value="" disabled>
            Choose a person
          </option>
          {people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name} — {person.employeeRef ?? "no employee ref"}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="assign-notes">Notes</Label>
        <Input id="assign-notes" name="notes" disabled={pending} />
        <p className="text-muted-foreground text-xs">
          Optional, and never personal data: this lands in the append-only event
          log. Who holds the asset is already recorded by the assignment itself.
        </p>
      </div>
      <Button type="submit" disabled={pending} className="w-fit">
        {pending ? "Assigning…" : "Assign"}
      </Button>
      <ActionMessage state={state} />
    </form>
  );
}

/**
 * ASSIGNED -> IN_STOCK, or ASSIGNED -> IN_REPAIR.
 *
 * There is no separate "send to repair" on an assigned asset: a repair-bound
 * return IS this form with toStatus=IN_REPAIR, which keeps closing the
 * assignment and changing the status in one transaction and one event
 * (AM-03 DESIGN §4.2).
 *
 * The condition is mandatory — z.enum rejects the empty string, so there is no
 * "not recorded" option here, unlike the AM-02 forms. Whether the free-text note
 * is required depends on the SELECTED destination and condition, so it is
 * client state; conditionNotesRequiredFor is the same function the server action
 * validates with, so the marker and the guard cannot drift apart.
 */
export function ReturnFromPersonForm({
  assetId,
  destinations,
}: {
  assetId: string;
  destinations: readonly ReturnDestination[];
}) {
  const [state, formAction, pending] = useActionState(
    returnAssetFromPerson,
    null,
  );
  const [toStatus, setToStatus] = useState<ReturnDestination>(destinations[0]);
  const [condition, setCondition] = useState<ConditionOption>("GOOD");
  const notesRequired = conditionNotesRequiredFor(toStatus, condition);

  return (
    <form action={formAction} className="flex max-w-md flex-col gap-3">
      <h3 className="font-medium">Take it back</h3>
      <input type="hidden" name="assetId" value={assetId} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="return-destination">Where it goes</Label>
        <Select
          id="return-destination"
          name="toStatus"
          value={toStatus}
          onChange={(event) =>
            setToStatus(event.target.value as ReturnDestination)
          }
          disabled={pending}
        >
          {destinations.map((destination) => (
            <option key={destination} value={destination}>
              {DESTINATION_LABELS[destination]}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="return-condition">Condition on return</Label>
        <Select
          id="return-condition"
          name="condition"
          value={condition}
          onChange={(event) =>
            setCondition(event.target.value as ConditionOption)
          }
          required
          disabled={pending}
        >
          {CONDITION_OPTIONS.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="return-condition-notes">
          Condition note{notesRequired ? " (required)" : ""}
        </Label>
        <Input
          id="return-condition-notes"
          name="conditionNotes"
          required={notesRequired}
          disabled={pending}
        />
        <p className="text-muted-foreground text-xs">
          {notesRequired
            ? "Required for kit going to repair and for anything coming back poor or defective — say what is wrong with it."
            : "Optional for a routine return."}
        </p>
      </div>
      <Button type="submit" disabled={pending} className="w-fit">
        {pending
          ? "Saving…"
          : toStatus === "IN_REPAIR"
            ? "Take back and send to repair"
            : "Take back"}
      </Button>
      <ActionMessage state={state} />
    </form>
  );
}
