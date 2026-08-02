import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ReactElement } from "react";

/**
 * The four guards from AM-09 DESIGN §5, asserted once for every dialog that
 * wraps a server action.
 *
 * They exist because `ConfirmActionDialog` REPLACED three `window.confirm`
 * calls, and the failure mode LEARNINGS §Frontend records for exactly that move
 * is "lift-verbatim drops cross-cutting guards" — the behaviour was correct in
 * the source, was never written down as an acceptance criterion, and the rewrite
 * quietly loses it.
 *
 * `FormDialog` (#10) is the same move a second time: five lifecycle forms and
 * `Add user` lifted out of the page and into a dialog. So the guards live HERE
 * rather than in either suite. A copy in each file would be two descriptions of
 * one property, free to drift — and the drift would be silent, because both
 * files would still be green. Run through one helper, a regression in either
 * component fails the same assertion.
 *
 * Each guard is asserted against the property, not against the markup, and each
 * was proven to go red with the production line that defends it removed.
 */

export type ActionDialogState = { ok: boolean; message: string } | null;

export type ActionDialogAction = (
  previous: ActionDialogState,
  formData: FormData,
) => Promise<ActionDialogState>;

export type ActionDialogHarness = {
  /** The dialog under test, wired to the action the guard supplies. */
  element: (action: ActionDialogAction) => ReactElement;
  /** Accessible name of the affordance that OPENS the dialog. */
  trigger: string;
  /** Accessible name of the button that RUNS the action. */
  submit: string;
  /** That button's label while the action is in flight. */
  pending: string;
};

const SUCCESS_MESSAGE = "Done.";
const REJECTION_MESSAGE = "Rejected: this would leave no active IT admin.";

function settledAction(state: ActionDialogState) {
  return vi.fn(async (): Promise<ActionDialogState> => state);
}

/**
 * An action the test holds open, so the dialog stays pending — and can then
 * RELEASE, which matters more than it looks.
 *
 * The first version of this returned a promise that never settled. It proved
 * what it needed to and left React with a transition that never completes, which
 * then broke `act()` for every later test in the file: guard 4 passed alone and
 * failed after guard 3, with the value sitting in the DOM untouched. A test that
 * quietly changes the outcome of the next one is worse than the bug it was
 * written to catch.
 */
function controllableAction() {
  let release!: (value: ActionDialogState) => void;
  const fn = vi.fn(
    () =>
      new Promise<ActionDialogState>((resolve) => {
        release = resolve;
      }),
  );
  return {
    fn,
    settle: () =>
      act(async () => release({ ok: true, message: SUCCESS_MESSAGE })),
  };
}

export function describeActionDialogGuards(
  name: string,
  harness: ActionDialogHarness,
): void {
  const { element, trigger, submit, pending } = harness;

  function setup(action: ActionDialogAction) {
    render(element(action));
    return { user: userEvent.setup() };
  }

  const open = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(screen.getByRole("button", { name: trigger }));
  };

  describe(`${name} — guard 1: the action needs a second, explicit act`, () => {
    it("does not fire when the trigger is clicked", async () => {
      const action = settledAction({ ok: true, message: SUCCESS_MESSAGE });
      const { user } = setup(action);

      await open(user);

      // The dialog is open — and nothing has happened yet. This is the whole
      // point of the control: opening it is not consenting to it.
      expect(await screen.findByRole("dialog")).toBeInTheDocument();
      expect(action).not.toHaveBeenCalled();
    });

    it("fires only on the submit button", async () => {
      const action = settledAction({ ok: true, message: SUCCESS_MESSAGE });
      const { user } = setup(action);

      await open(user);
      await user.click(await screen.findByRole("button", { name: submit }));

      await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
    });
  });

  describe(`${name} — guard 2: dismissing never submits`, () => {
    it.each([
      [
        "Cancel",
        async (user: ReturnType<typeof userEvent.setup>) => {
          await user.click(screen.getByRole("button", { name: "Cancel" }));
        },
      ],
      [
        "Escape",
        async (user: ReturnType<typeof userEvent.setup>) => {
          await user.keyboard("{Escape}");
        },
      ],
      [
        "the close button",
        async (user: ReturnType<typeof userEvent.setup>) => {
          await user.click(screen.getByRole("button", { name: "Close" }));
        },
      ],
    ])("closes on %s without calling the action", async (_name, dismiss) => {
      const action = settledAction({ ok: true, message: SUCCESS_MESSAGE });
      const { user } = setup(action);

      await open(user);
      await screen.findByRole("dialog");

      await dismiss(user);

      // Cancel and Close are inside a <form>. A bare <button> there defaults to
      // type="submit", so the failure this catches is the one where dismissing
      // performs the very action it is dismissing.
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
      expect(action).not.toHaveBeenCalled();
    });
  });

  describe(`${name} — guard 3: an in-flight action cannot be dismissed`, () => {
    it("refuses Escape and keeps the dialog open while pending", async () => {
      const { fn, settle } = controllableAction();
      const { user } = setup(fn);

      await open(user);
      await user.click(await screen.findByRole("button", { name: submit }));
      await waitFor(() => expect(fn).toHaveBeenCalled());

      await user.keyboard("{Escape}");

      // A modal that vanishes mid-flight leaves the operator with no idea
      // whether the thing happened — and neither of these has an undo.
      expect(screen.getByRole("dialog")).toBeInTheDocument();

      await settle();
    });

    it("disables submit and cancel while pending, so it cannot double-submit", async () => {
      const { fn, settle } = controllableAction();
      const { user } = setup(fn);

      await open(user);
      await user.click(await screen.findByRole("button", { name: submit }));

      const inFlight = await screen.findByRole("button", { name: pending });
      await waitFor(() => expect(inFlight).toBeDisabled());
      expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

      await user.click(inFlight);
      expect(fn).toHaveBeenCalledTimes(1);

      await settle();
    });
  });

  describe(`${name} — guard 4: the result is shown, not swallowed`, () => {
    it("keeps the dialog open and reports a rejection", async () => {
      const action = settledAction({ ok: false, message: REJECTION_MESSAGE });
      const { user } = setup(action);

      await open(user);
      await user.click(await screen.findByRole("button", { name: submit }));

      // The rejection IS the reason this dialog exists. Closing on it would
      // throw away the only explanation the operator gets — and, for a form,
      // everything they typed.
      //
      // A single act flush, not `findBy`/`waitFor`. Polling helpers wrap every
      // attempt in `act()`, and an `act()` in progress DEFERS the state update
      // that `useActionState` produces when the action settles — so the poll can
      // never observe it and the test fails while the value sits in the DOM the
      // whole time. `await act(async () => {})` drains the queue once and lets
      // the update land, which makes the assertion synchronous and removes the
      // timing question entirely (no sleeps, no retries, nothing to flake).
      await act(async () => {});
      expect(screen.getByRole("status")).toHaveTextContent(REJECTION_MESSAGE);
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(screen.getByRole("button", { name: submit })).toBeEnabled();
    });

    it("reports success and offers a way out", async () => {
      const action = settledAction({ ok: true, message: SUCCESS_MESSAGE });
      const { user } = setup(action);

      await open(user);
      await user.click(await screen.findByRole("button", { name: submit }));

      // See the note above on why this is an act flush and not a polling query.
      await act(async () => {});
      expect(screen.getByRole("status")).toHaveTextContent(SUCCESS_MESSAGE);
      // No second submit to mis-click once the thing has already happened.
      expect(
        screen.queryByRole("button", { name: submit }),
      ).not.toBeInTheDocument();
      await user.click(screen.getByRole("button", { name: "Done" }));
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
    });
  });

  describe(`${name} — guard 5: a reopened dialog is a fresh dialog`, () => {
    it("does not carry the previous result into the next open", async () => {
      const action = settledAction({ ok: true, message: SUCCESS_MESSAGE });
      const { user } = setup(action);

      await open(user);
      await user.click(await screen.findByRole("button", { name: submit }));
      await act(async () => {});
      expect(screen.getByRole("status")).toHaveTextContent(SUCCESS_MESSAGE);

      await user.click(screen.getByRole("button", { name: "Done" }));
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );

      await open(user);
      await screen.findByRole("dialog");

      // `useActionState` keeps its value for the life of the component, and
      // neither dialog unmounts on close — so without a reset the SECOND open
      // is still showing the FIRST open's outcome: success message, no
      // controls, nothing to do but press Done again. The action becomes
      // unreachable until the whole page remounts.
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
      expect(screen.getByRole("button", { name: submit })).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Done" }),
      ).not.toBeInTheDocument();
    });

    it("returns focus to the trigger on close", async () => {
      // Not incidental coverage: the reset above is a remount, and focus
      // RETURN is the Radix guarantee a remount is most likely to cut (see
      // the `ui/dialog.tsx` docblock). Losing it drops the keyboard operator
      // at <body> with no way back to the control they just used, and no
      // guard above would notice.
      const action = settledAction({ ok: true, message: SUCCESS_MESSAGE });
      const { user } = setup(action);

      await open(user);
      await screen.findByRole("dialog");

      await user.keyboard("{Escape}");
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );

      expect(screen.getByRole("button", { name: trigger })).toHaveFocus();
    });
  });
}
