import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

let pathname = "/assets";

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}));

import { NavLink } from "@/components/nav-link";

function renderAt(at: string, href: string) {
  pathname = at;
  render(
    <NavLink href={href} className="base" activeClassName="is-active">
      Register
    </NavLink>,
  );
  return screen.getByRole("link", { name: "Register" });
}

describe("NavLink", () => {
  it("marks the exact route as the current page", () => {
    const link = renderAt("/assets", "/assets");

    expect(link).toHaveAttribute("aria-current", "page");
    expect(link.className).toContain("is-active");
  });

  it.each(["/assets/new", "/assets/abc123"])(
    "stays current on the child route %s",
    (at) => {
      expect(renderAt(at, "/assets")).toHaveAttribute("aria-current", "page");
    },
  );

  // The reason this is a boundary check and not a bare startsWith. A sibling
  // route sharing a prefix must NOT light up the parent — the same failure
  // class as the middleware matcher's anchored exclusions, where /signin-foo
  // shipped public because the prefix matched (LEARNINGS §Next.js).
  it.each(["/assets-archive", "/assetsomething"])(
    "does not claim the prefix-sharing sibling %s",
    (at) => {
      const link = renderAt(at, "/assets");

      expect(link).not.toHaveAttribute("aria-current");
      expect(link.className).not.toContain("is-active");
    },
  );

  it("marks nothing current on an unrelated route", () => {
    expect(renderAt("/admin/users", "/assets")).not.toHaveAttribute(
      "aria-current",
    );
  });
});
