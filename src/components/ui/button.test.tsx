import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "@/components/ui/button";

describe("Button", () => {
  it("renders an accessible button with its label", () => {
    render(<Button>Save asset</Button>);

    expect(
      screen.getByRole("button", { name: "Save asset" }),
    ).toBeInTheDocument();
  });

  it("applies the variant class pipeline (cva + cn)", () => {
    render(<Button variant="destructive">Retire</Button>);

    const button = screen.getByRole("button", { name: "Retire" });
    expect(button.className).toContain("bg-destructive");
  });

  it("renders as the child element with asChild", () => {
    render(
      <Button asChild>
        <a href="/assets">Open register</a>
      </Button>,
    );

    const link = screen.getByRole("link", { name: "Open register" });
    expect(link).toHaveAttribute("href", "/assets");
  });
});
