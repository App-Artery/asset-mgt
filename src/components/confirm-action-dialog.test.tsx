import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "./confirm-action-dialog";
import { describeActionDialogGuards } from "../../test/action-dialog-guards";

/**
 * The four AM-09 DESIGN §5 guards, asserted through the shared helper that
 * `FormDialog` also runs through — see `test/action-dialog-guards.tsx` for why
 * they live there rather than being written out once per dialog.
 *
 * This file is now the harness and nothing else. That is the point: the guards
 * are one property held by two components, not two descriptions free to drift.
 */
describeActionDialogGuards("ConfirmActionDialog", {
  element: (action) => (
    <ConfirmActionDialog
      action={action}
      hiddenFields={{ userId: "u1" }}
      trigger={<Button type="button">Deactivate…</Button>}
      title="Deactivate someone?"
      description={<p>They lose access immediately.</p>}
      confirmLabel="Deactivate"
      pendingLabel="Deactivating…"
      destructive
    />
  ),
  trigger: "Deactivate…",
  submit: "Deactivate",
  pending: "Deactivating…",
});
