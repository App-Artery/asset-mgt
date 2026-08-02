import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormDialog, type FormDialogState } from "./form-dialog";
import {
  describeActionDialogGuards,
  type ActionDialogAction,
} from "../../test/action-dialog-guards";

/**
 * The four §5 guards come from the shared helper — the same one
 * `ConfirmActionDialog` runs through, so a regression in either component fails
 * the same assertion. What is asserted below it is what is specific to a FORM in
 * a dialog: that the fields are actually submitted, and that they freeze with
 * everything else while the action is in flight.
 */
function dialog(action: ActionDialogAction) {
  return (
    <FormDialog
      action={action}
      hiddenFields={{ assetId: "a1" }}
      trigger={<Button type="button">Receive and tag…</Button>}
      title="Receive and tag"
      description="The tag is mandatory from delivery onwards."
      submitLabel="Receive and tag"
      pendingLabel="Receiving…"
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tag">Asset tag</Label>
        <Input id="tag" name="tag" defaultValue="LT-0001" />
      </div>
    </FormDialog>
  );
}

describeActionDialogGuards("FormDialog", {
  element: dialog,
  trigger: "Receive and tag…",
  submit: "Receive and tag",
  pending: "Receiving…",
});

describe("FormDialog — the fields are the point", () => {
  it("submits the hidden fields and what the operator typed", async () => {
    const seen: Record<string, FormDataEntryValue | null> = {};
    const action = vi.fn(
      async (
        _previous: FormDialogState,
        formData: FormData,
      ): Promise<FormDialogState> => {
        seen.assetId = formData.get("assetId");
        seen.tag = formData.get("tag");
        return { ok: true, message: "Received and tagged." };
      },
    );
    render(dialog(action));
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Receive and tag…" }));
    const tag = await screen.findByLabelText("Asset tag");
    await user.clear(tag);
    await user.type(tag, "LT-0042");
    await user.click(screen.getByRole("button", { name: "Receive and tag" }));

    // See the shared helper on why this is an act flush and not a polling query.
    await act(async () => {});
    // The hidden field lives OUTSIDE the fieldset precisely so it survives; a
    // disabled fieldset submits none of its controls.
    expect(seen.assetId).toBe("a1");
    expect(seen.tag).toBe("LT-0042");
  });

  it("freezes the fields while the action is in flight", async () => {
    // Releasable, never a promise that simply never settles: a permanently
    // pending transition breaks act() for every later test in the file.
    let release!: (value: FormDialogState) => void;
    const action = vi.fn(
      () =>
        new Promise<FormDialogState>((resolve) => {
          release = resolve;
        }),
    );
    render(dialog(action));
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Receive and tag…" }));
    await user.click(await screen.findByLabelText("Asset tag"));
    await user.click(screen.getByRole("button", { name: "Receive and tag" }));
    await screen.findByRole("button", { name: "Receiving…" });

    // The submitted values are already gone to the server. A field that still
    // accepts typing invites the operator to "correct" a tag that has been
    // written, and to believe the correction took.
    expect(screen.getByLabelText("Asset tag")).toBeDisabled();

    await act(async () => release({ ok: true, message: "Received." }));
  });

  it("gives the next open an empty form, not the last one's", async () => {
    // Guard 5 in the shared helper asserts the property both dialogs share:
    // the previous result is gone. This is the half only a FORM has — the
    // fields are back, and back at their defaults rather than still holding
    // what was typed into the run that already succeeded. Re-submitting a
    // prefilled tag is how an operator tags the wrong asset.
    const action = vi.fn(async (): Promise<FormDialogState> => ({
      ok: true,
      message: "Received and tagged.",
    }));
    render(dialog(action));
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Receive and tag…" }));
    const tag = await screen.findByLabelText("Asset tag");
    await user.clear(tag);
    await user.type(tag, "LT-0042");
    await user.click(screen.getByRole("button", { name: "Receive and tag" }));

    // See the shared helper on why this is an act flush and not a polling query.
    await act(async () => {});
    expect(screen.queryByLabelText("Asset tag")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Done" }));
    await user.click(screen.getByRole("button", { name: "Receive and tag…" }));

    const reopened = await screen.findByLabelText("Asset tag");
    expect(reopened).toBeInTheDocument();
    expect(reopened).toHaveValue("LT-0001");
    expect(reopened).toBeEnabled();
  });
});
