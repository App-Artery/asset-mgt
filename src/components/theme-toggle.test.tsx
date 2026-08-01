import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

const setTheme = vi.fn();
let currentTheme = "system";

// next-themes reads matchMedia and localStorage, neither of which jsdom models
// usefully. Mock the hook rather than the storage layer so these tests assert
// OUR component's contract, not the library's.
vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: currentTheme, setTheme, resolvedTheme: "light" }),
}));

import { ThemeToggle } from "@/components/theme-toggle";

afterEach(() => {
  currentTheme = "system";
  setTheme.mockClear();
});

describe("ThemeToggle", () => {
  // The cycle must return to System. A two-way toggle would strand anyone who
  // started on System, which is the default — this is the reason the control
  // is a three-step cycle and not a switch.
  it.each([
    ["light", "dark"],
    ["dark", "system"],
    ["system", "light"],
  ])("cycles %s to %s", async (from, to) => {
    currentTheme = from;
    render(<ThemeToggle />);

    await userEvent.click(screen.getByRole("button", { name: /theme/i }));

    expect(setTheme).toHaveBeenCalledWith(to);
  });

  it("names the current theme and the next one, since the icon cannot", () => {
    currentTheme = "dark";
    render(<ThemeToggle />);

    expect(
      screen.getByRole("button", { name: "Theme: Dark. Switch to system." }),
    ).toBeInTheDocument();
  });

  // Guards the hydration contract: `theme` is undefined on the server and on
  // the first client render, so an unguarded branch renders one glyph server
  // side and another after hydration. Falling back to System keeps them equal.
  it("falls back to System when the theme is not yet resolved", () => {
    currentTheme = undefined as unknown as string;
    render(<ThemeToggle />);

    expect(
      screen.getByRole("button", { name: /^Theme: System\./ }),
    ).toBeInTheDocument();
  });
});
