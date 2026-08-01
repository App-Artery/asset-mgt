import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// NavLink reads usePathname for its active state, which needs a router context
// jsdom has none of. Stubbed per file rather than globally in vitest.setup:
// a global stub would silently satisfy any future component that genuinely
// needs routing, and hide the omission.
vi.mock("next/navigation", () => ({
  usePathname: () => "/assets",
}));

import { AppTabBar } from "@/components/app-tabbar";

describe("AppTabBar", () => {
  it("offers Add to a role that can write", () => {
    render(<AppTabBar role="ADMIN_IT" />);

    expect(screen.getByRole("link", { name: /add/i })).toBeInTheDocument();
  });

  // FINANCE reads the register but cannot create assets, so the tab would be a
  // dead end. /assets/new's own requireRole is what refuses — this only keeps
  // the UI from offering a door that slams.
  it.each(["FINANCE", "STAFF_RO"] as const)("omits Add for %s", (role) => {
    render(<AppTabBar role={role} />);

    expect(screen.queryByRole("link", { name: /add/i })).toBeNull();
  });

  it("still offers the two universal destinations to STAFF_RO", () => {
    render(<AppTabBar role="STAFF_RO" />);

    expect(screen.getByRole("link", { name: /register/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /mine/i })).toBeInTheDocument();
  });
});
