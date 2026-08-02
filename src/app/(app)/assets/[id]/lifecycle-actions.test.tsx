import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The server actions are the whole point of `../actions`, and importing it here
// would drag Prisma and the auth stack into a component test. What each button
// DOES is asserted against a real database in actions.integration.test.ts; what
// is asserted here is which button exists and what it asks for.
vi.mock("../actions", () => ({
  receiveAndTagAsset: vi.fn(async () => ({ ok: true, message: "Received." })),
  retireAsset: vi.fn(async () => ({ ok: true, message: "Retired." })),
  returnFromRepair: vi.fn(async () => ({ ok: true, message: "Returned." })),
  sendToRepair: vi.fn(async () => ({ ok: true, message: "Sent." })),
  assignAssetToPerson: vi.fn(async () => ({ ok: true, message: "Assigned." })),
  returnAssetFromPerson: vi.fn(async () => ({ ok: true, message: "Back." })),
}));

import { LifecycleActions, type LifecycleMove } from "./lifecycle-actions";
import type { PickerPerson, ReturnDestination } from "./assignment-actions";

/**
 * #10: the lifecycle forms moved into dialogs behind a primary button and a
 * `More` menu, so every affordance a status offers is now a trigger rather than
 * an expanded form heading.
 *
 * The AM-03 acceptance claim — WHICH moves each status offers, and that ASSIGNED
 * offers no separate "send to repair" — is asserted where it always was, against
 * the real transition map and the real page, in `assignment-ui.integration.test.tsx`.
 * What that file can no longer see is anything INSIDE a dialog: Radix portals it
 * and mounts it only once open, so it is absent from server-rendered markup. The
 * half of the claim that lives inside the return dialog (both destinations, one
 * action) and inside the assign dialog (the picker disambiguates by employeeRef)
 * is asserted here instead, by opening them.
 */

const people: PickerPerson[] = [
  { id: "p1", name: "Asha Mwangi", employeeRef: "EMP-0042" },
  { id: "p2", name: "Asha Mwangi", employeeRef: "EMP-0117" },
];
const BOTH_DESTINATIONS: ReturnDestination[] = ["IN_STOCK", "IN_REPAIR"];

/** The moves the page derives for each status (see `lifecycleMovesFor`). */
const MOVES: Record<string, LifecycleMove[]> = {
  ON_ORDER: ["RECEIVE", "RETIRE"],
  IN_STOCK: ["ASSIGN", "SEND_TO_REPAIR", "RETIRE"],
  ASSIGNED: ["RETURN_FROM_PERSON", "RETIRE"],
  IN_REPAIR: ["RETURN", "RETIRE"],
  RETIRED: [],
};

function renderMoves(moves: LifecycleMove[]) {
  render(
    <LifecycleActions
      assetId="a1"
      moves={moves}
      people={people}
      returnDestinations={BOTH_DESTINATIONS}
    />,
  );
  return userEvent.setup();
}

/** Whether an affordance sits in the `More` menu rather than leading. */
function behindMore(name: string): boolean {
  return screen.getByRole("button", { name }).closest("details") !== null;
}

async function openDialog(
  user: ReturnType<typeof userEvent.setup>,
  name: string,
) {
  if (behindMore(name)) {
    await user.click(screen.getByText("More"));
  }
  await user.click(screen.getByRole("button", { name }));
  return screen.findByRole("dialog");
}

describe("one primary action per status, the rest behind More", () => {
  it("leads with Receive and tag on an ON_ORDER asset", () => {
    renderMoves(MOVES.ON_ORDER!);

    expect(behindMore("Receive and tag…")).toBe(false);
    expect(behindMore("Retire asset…")).toBe(true);
    expect(screen.queryByRole("button", { name: "Assign…" })).toBeNull();
  });

  it("leads with Assign on an IN_STOCK asset, and offers send to repair and retire", () => {
    renderMoves(MOVES.IN_STOCK!);

    expect(behindMore("Assign…")).toBe(false);
    expect(behindMore("Send to repair…")).toBe(true);
    expect(behindMore("Retire asset…")).toBe(true);
    // Nothing is out with anyone, so there is nothing to take back.
    expect(screen.queryByRole("button", { name: "Take it back…" })).toBeNull();
  });

  it("leads with Take it back on an ASSIGNED asset, and offers no second path out", () => {
    renderMoves(MOVES.ASSIGNED!);

    expect(behindMore("Take it back…")).toBe(false);
    expect(behindMore("Retire asset…")).toBe(true);
    // AM-03 §4.2: a repair-bound return IS the return action. A parallel
    // "send to repair" here would close the assignment in a second event.
    expect(
      screen.queryByRole("button", { name: "Send to repair…" }),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Assign…" })).toBeNull();
  });

  it("leads with Return from repair on an IN_REPAIR asset", () => {
    renderMoves(MOVES.IN_REPAIR!);

    expect(behindMore("Return from repair…")).toBe(false);
    expect(behindMore("Retire asset…")).toBe(true);
  });

  it("offers nothing at all on a RETIRED asset", () => {
    renderMoves(MOVES.RETIRED!);

    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(screen.getByText(/lifecycle ends here/i)).toBeInTheDocument();
  });
});

describe("what the dialogs ask for", () => {
  it("offers both destinations on one Take it back form", async () => {
    const user = renderMoves(MOVES.ASSIGNED!);

    const dialog = await openDialog(user, "Take it back…");

    // Both ways out of ASSIGNED, on one form and one action.
    const destination = within(dialog).getByLabelText("Where it goes");
    expect(
      within(destination).getByRole("option", { name: "Back to stock" }),
    ).toBeInTheDocument();
    expect(
      within(destination).getByRole("option", { name: "Straight to repair" }),
    ).toBeInTheDocument();
    // Condition is the structured answer to "in what state" and is mandatory:
    // there is deliberately no "not recorded" option (AM-03 AC-2).
    const condition = within(dialog).getByLabelText("Condition on return");
    expect(condition).toBeRequired();
    expect(
      within(condition).queryByRole("option", { name: "Not recorded" }),
    ).toBeNull();
  });

  it("disambiguates the picker by employee ref, and carries no email", async () => {
    const user = renderMoves(MOVES.IN_STOCK!);

    const dialog = await openDialog(user, "Assign…");

    // Two people, same name. The employee ref is the organisation's own
    // internal number and the only thing telling them apart — an email would
    // work too, and is deliberately never sent to the client.
    const picker = within(dialog).getByLabelText("Assign to");
    expect(
      within(picker).getByRole("option", { name: "Asha Mwangi — EMP-0042" }),
    ).toBeInTheDocument();
    expect(
      within(picker).getByRole("option", { name: "Asha Mwangi — EMP-0117" }),
    ).toBeInTheDocument();
    expect(dialog.textContent).not.toMatch(/@/);
  });
});

/**
 * THE assertion this file exists for.
 *
 * `AssetEvent.notes` is operator-typed free text rendered to all four roles
 * including STAFF_RO, who are otherwise shown no person data at all, and the
 * table is never updated and never deleted. `EventNoteHint` is the only
 * mitigation on that channel (CLAUDE.md, §"No personal data in event tables").
 *
 * Moving five forms into dialogs is exactly the change that loses it silently:
 * the field goes, the hint stays behind, and every other test still passes. So
 * each dialog is opened and the hint is looked for BESIDE its input — not
 * anywhere in the dialog, which would still pass with the two pulled apart.
 */
describe("EventNoteHint travels with every field that writes AssetEvent.notes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["Receive and tag…", "Notes", MOVES.ON_ORDER!],
    ["Assign…", "Notes", MOVES.IN_STOCK!],
    ["Send to repair…", "Notes", MOVES.IN_STOCK!],
    ["Return from repair…", "Notes", MOVES.IN_REPAIR!],
    ["Retire asset…", "Reason", MOVES.ASSIGNED!],
  ])("warns beside the %s field", async (trigger, label, moves) => {
    const user = renderMoves(moves);

    const dialog = await openDialog(user, trigger);

    const field = within(dialog).getByLabelText(label);
    expect(field.closest("div")).toHaveTextContent(/never personal data/i);
  });
});
