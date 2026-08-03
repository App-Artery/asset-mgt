import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Timestamp } from "./timestamp";

const VALUE = new Date("2026-07-01T09:30:00.000Z");
const NOW = new Date("2026-07-04T09:30:00.000Z");

describe("Timestamp", () => {
  it("renders the exact UTC value when asked", () => {
    render(<Timestamp value={VALUE} exact />);
    expect(screen.getByText("2026-07-01 09:30 UTC")).toBeInTheDocument();
  });

  it("renders a relative phrase by default, with the exact value one hover away", () => {
    render(<Timestamp value={VALUE} now={NOW} />);
    const el = screen.getByText("3 days ago");
    expect(el).toHaveAttribute("title", "2026-07-01 09:30 UTC");
  });

  it("always carries a machine-readable dateTime, whichever variant", () => {
    const { rerender } = render(<Timestamp value={VALUE} exact />);
    expect(screen.getByText(/2026-07-01/)).toHaveAttribute(
      "datetime",
      "2026-07-01T09:30:00.000Z",
    );
    rerender(<Timestamp value={VALUE} now={NOW} />);
    expect(screen.getByText("3 days ago")).toHaveAttribute(
      "datetime",
      "2026-07-01T09:30:00.000Z",
    );
  });
});
