import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Button } from "@/components/ui/button";
import {
  ConfirmActionDialog,
  type ConfirmActionState,
} from "./confirm-action-dialog";

/**
 * The four guards from AM-09 DESIGN §5.
 *
 * These exist because this component REPLACED three `window.confirm` calls, and
 * the failure mode LEARNINGS §Frontend records for exactly that move is
 * "lift-verbatim drops cross-cutting guards" — the behaviour was correct in the
 * source, was never written down as an acceptance criterion, and the rewrite
 * quietly loses it.
 *
 * So each guard is asserted against the property, not against the markup, and
 * each was proven to go red with the production line that defends it removed.
 */

function setup(overrides: Partial<{ action: typeof noopAction }> = {}) {
  const action = overrides.action ?? noopAction;
  render(
    <ConfirmActionDialog
      action={action}
      hiddenFields={{ userId: "u1" }}
      trigger={<Button type="button">Deactivate…</Button>}
      title="Deactivate someone?"
      description={<p>They lose access immediately.</p>}
      confirmLabel="Deactivate"
      pendingLabel="Deactivating…"
      destructive
    />,
  );
  return { user: userEvent.setup() };
}

const noopAction = vi.fn(async (): Promise<ConfirmActionState> => ({
  ok: true,
  message: "Done.",
}));

describe("guard 1 — the action needs a second, explicit act", () => {
  it("does not fire when the trigger is clicked", async () => {
    const action = vi.fn(async (): Promise<ConfirmActionState> => ({
      ok: true,
      message: "Done.",
    }));
    const { user } = setup({ action });

    await user.click(screen.getByRole("button", { name: "Deactivate…" }));

    // The dialog is open — and nothing has happened yet. This is the whole
    // point of the control: opening it is not consenting to it.
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(action).not.toHaveBeenCalled();
  });

  it("fires only on the confirm button", async () => {
    const action = vi.fn(async (): Promise<ConfirmActionState> => ({
      ok: true,
      message: "Done.",
    }));
    const { user } = setup({ action });

    await user.click(screen.getByRole("button", { name: "Deactivate…" }));
    await user.click(await screen.findByRole("button", { name: "Deactivate" }));

    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  });
});

describe("guard 2 — dismissing never submits", () => {
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
    const action = vi.fn(async (): Promise<ConfirmActionState> => ({
      ok: true,
      message: "Done.",
    }));
    const { user } = setup({ action });

    await user.click(screen.getByRole("button", { name: "Deactivate…" }));
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

describe("guard 3 — an in-flight action cannot be dismissed", () => {
  /**
   * An action the test holds open, so the dialog stays pending — and can then
   * RELEASE, which matters more than it looks.
   *
   * The first version of this returned a promise that never settled. It proved
   * what it needed to and left React with a transition that never completes,
   * which then broke `act()` for every later test in the file: guard 4 passed
   * alone and failed after guard 3, with the value sitting in the DOM
   * untouched. A test that quietly changes the outcome of the next one is worse
   * than the bug it was written to catch.
   */
  function controllableAction() {
    let release!: (value: ConfirmActionState) => void;
    const fn = vi.fn(
      () =>
        new Promise<ConfirmActionState>((resolve) => {
          release = resolve;
        }),
    );
    return {
      fn,
      settle: () => act(async () => release({ ok: true, message: "Done." })),
    };
  }

  it("refuses Escape and keeps the dialog open while pending", async () => {
    const { fn, settle } = controllableAction();
    const { user } = setup({ action: fn });

    await user.click(screen.getByRole("button", { name: "Deactivate…" }));
    await user.click(await screen.findByRole("button", { name: "Deactivate" }));
    await waitFor(() => expect(fn).toHaveBeenCalled());

    await user.keyboard("{Escape}");

    // A modal that vanishes mid-flight leaves the operator with no idea
    // whether the thing happened — and this action has no undo.
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await settle();
  });

  it("disables confirm and cancel while pending, so it cannot double-submit", async () => {
    const { fn, settle } = controllableAction();
    const { user } = setup({ action: fn });

    await user.click(screen.getByRole("button", { name: "Deactivate…" }));
    await user.click(await screen.findByRole("button", { name: "Deactivate" }));

    const confirm = await screen.findByRole("button", {
      name: "Deactivating…",
    });
    await waitFor(() => expect(confirm).toBeDisabled());
    expect(screen.getByRole("button", { name: "Cancel" })).toBeDisabled();

    await user.click(confirm);
    expect(fn).toHaveBeenCalledTimes(1);

    await settle();
  });
});

describe("guard 4 — the result is shown, not swallowed", () => {
  it("keeps the dialog open and reports a rejection", async () => {
    const action = vi.fn(async (): Promise<ConfirmActionState> => ({
      ok: false,
      message: "Rejected: this would leave no active IT admin.",
    }));
    const { user } = setup({ action });

    await user.click(screen.getByRole("button", { name: "Deactivate…" }));
    await user.click(await screen.findByRole("button", { name: "Deactivate" }));

    // The rejection IS the reason this dialog exists. Closing on it would
    // throw away the only explanation the operator gets.
    //
    // A single act flush, not `findBy`/`waitFor`. Polling helpers wrap every
    // attempt in `act()`, and an `act()` in progress DEFERS the state update
    // that `useActionState` produces when the action settles — so the poll can
    // never observe it and the test fails while the value sits in the DOM the
    // whole time. `await act(async () => {})` drains the queue once and lets the
    // update land, which makes the assertion synchronous and removes the timing
    // question entirely (no sleeps, no retries, nothing to flake).
    await act(async () => {});
    expect(screen.getByRole("status")).toHaveTextContent(
      "Rejected: this would leave no active IT admin.",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Deactivate" })).toBeEnabled();
  });

  it("reports success and offers a way out", async () => {
    const { user } = setup();

    await user.click(screen.getByRole("button", { name: "Deactivate…" }));
    await user.click(await screen.findByRole("button", { name: "Deactivate" }));

    // See the note above on why this is an act flush and not a polling query.
    await act(async () => {});
    expect(screen.getByRole("status")).toHaveTextContent("Done.");
    // No second confirm to mis-click once the thing has already happened.
    expect(
      screen.queryByRole("button", { name: "Deactivate" }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Done" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
});
