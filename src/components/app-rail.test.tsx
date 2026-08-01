import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// NavLink reads usePathname for its active state, which needs a router context
// jsdom has none of. Stubbed per file rather than globally in vitest.setup:
// a global stub would silently satisfy any future component that genuinely
// needs routing, and hide the omission.
vi.mock("next/navigation", () => ({
  usePathname: () => "/assets",
}));

import { AppRail } from "@/components/app-rail";

describe("AppRail", () => {
  it.each(["ADMIN_IT", "PROCUREMENT", "FINANCE", "STAFF_RO"] as const)(
    "offers the two universal destinations to %s",
    (role) => {
      render(<AppRail role={role} />);

      expect(
        screen.getByRole("link", { name: "Register" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("link", { name: "My assignments" }),
      ).toBeInTheDocument();
    },
  );

  it("shows the admin group only to ADMIN_IT", () => {
    render(<AppRail role="ADMIN_IT" />);

    expect(screen.getByRole("link", { name: "Users" })).toBeInTheDocument();
  });

  it.each(["PROCUREMENT", "FINANCE", "STAFF_RO"] as const)(
    "hides the admin group from %s",
    (role) => {
      render(<AppRail role={role} />);

      expect(screen.queryByRole("link", { name: "Users" })).toBeNull();
    },
  );

  // No People entry anywhere: /people has no index route, and adding one would
  // be a new Person listing — a new PII surface. A rail link to a 404 is the
  // regression this catches.
  it("offers no People destination to any role", () => {
    render(<AppRail role="ADMIN_IT" />);

    expect(screen.queryByRole("link", { name: /people/i })).toBeNull();
  });

  // The accessible name must contain a real ampersand, not a literal "&amp;".
  // Asserting on the ACCESSIBLE NAME rather than the source is the whole point:
  // it is what a screen reader announces and what a user reads.
  it("renders a real ampersand in the reference-data label", () => {
    render(<AppRail role="ADMIN_IT" />);

    expect(
      screen.getByRole("link", { name: "Categories & sites" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/&amp;/)).toBeNull();
  });
});
