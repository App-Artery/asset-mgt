import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const setTheme = vi.fn();

// next-themes reads matchMedia and localStorage, neither of which jsdom models
// usefully. Mock the hook rather than the storage layer so these tests assert
// OUR component's contract, not the library's.
vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "system", setTheme, resolvedTheme: "light" }),
}));

import { ThemeToggle } from "@/components/theme-toggle";

describe("ThemeToggle", () => {
  it("offers all three choices, so a user can return to System", () => {
    render(<ThemeToggle />);

    const select = screen.getByRole("combobox", { name: /theme/i });
    const values = Array.from(
      select.querySelectorAll("option"),
      (option) => option.value,
    );

    expect(values).toEqual(["light", "dark", "system"]);
  });

  it("applies the chosen theme", async () => {
    render(<ThemeToggle />);

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: /theme/i }),
      "dark",
    );

    expect(setTheme).toHaveBeenCalledWith("dark");
  });
});
