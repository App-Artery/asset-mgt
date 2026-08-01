import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusChip } from "@/components/ui/status-chip";

describe("StatusChip", () => {
  it("renders the human label, never the enum", () => {
    render(<StatusChip status="IN_REPAIR" />);

    expect(screen.getByText("In repair")).toBeInTheDocument();
    expect(screen.queryByText("IN_REPAIR")).not.toBeInTheDocument();
  });

  it("distinguishes on-order from retired without relying on hue", () => {
    const { rerender } = render(<StatusChip status="ON_ORDER" />);
    const onOrder = screen.getByTestId("status-chip").className;

    rerender(<StatusChip status="RETIRED" />);
    const retired = screen.getByTestId("status-chip").className;

    // Both draw from the inert pair, so colour alone cannot tell them apart.
    // If these ever collapse to the same class string the two statuses have
    // become visually identical.
    expect(onOrder).not.toEqual(retired);
  });

  // tailwind-merge classifies `text-st-repair` as a text-COLOUR, so it and a
  // caller's colour class are a genuine conflict and exactly one survives —
  // whichever comes last. The chip's colour encodes its status, so a caller
  // must never be able to win that conflict and make the chip render a lie
  // (LEARNINGS §Frontend: a semantic token evicted by a later text-* utility).
  //
  // Falsifiable by construction: flip the cn() argument order in
  // status-chip.tsx and this goes red.
  it("refuses to let a caller override the status colour", () => {
    render(<StatusChip status="IN_REPAIR" className="text-muted-foreground" />);

    const chip = screen.getByTestId("status-chip");
    expect(chip.className).toContain("text-st-repair");
    expect(chip.className).not.toContain("text-muted-foreground");
  });

  it("still lets non-conflicting layout classes through", () => {
    render(<StatusChip status="IN_REPAIR" className="ml-2" />);

    const chip = screen.getByTestId("status-chip");
    expect(chip.className).toContain("ml-2");
    expect(chip.className).toContain("text-st-repair");
  });
});
