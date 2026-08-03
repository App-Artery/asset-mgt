import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  ResponsiveTable,
  SCROLL_PANE,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./table";

function renderTable(
  props: Partial<Parameters<typeof ResponsiveTable>[0]> = {},
) {
  return render(
    <ResponsiveTable
      cards={<p>cards</p>}
      tableTestId="thing-table"
      cardsTestId="thing-cards"
      {...props}
    >
      <TableHeader>
        <TableRow>
          <TableHead>Tag</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>AST-0412</TableCell>
        </TableRow>
      </TableBody>
    </ResponsiveTable>,
  );
}

describe("ResponsiveTable", () => {
  it("renders both shapes, each behind its own half of one breakpoint", () => {
    renderTable();
    // jsdom has no layout, so this asserts the CLASSES, not visibility. What
    // is actually being defended is that the two halves are complementary:
    // a table hidden below md and cards hidden at md and above.
    expect(screen.getByTestId("thing-table").className).toContain(
      "hidden md:block",
    );
    expect(screen.getByTestId("thing-cards").className).toContain("md:hidden");
  });

  it("puts the caller's cards inside the mobile half", () => {
    renderTable();
    expect(screen.getByTestId("thing-cards").textContent).toBe("cards");
  });

  it("leaves the header unstuck by default", () => {
    renderTable();
    expect(screen.getByRole("table").className).not.toContain("sticky");
  });

  it("sticks the header to its scroll container when asked", () => {
    renderTable({ sticky: true, containerClassName: SCROLL_PANE });
    const table = screen.getByRole("table");
    // Targeted at thead th only: a sticky <td> would freeze the first column.
    expect(table.className).toContain("[&_thead_th]:sticky");
    expect(table.className).toContain("[&_thead_th]:bg-background");
  });

  it("bounds the container height, without which sticky is a silent no-op", () => {
    const { container } = renderTable({
      sticky: true,
      containerClassName: SCROLL_PANE,
    });
    // The wrapper is overflow-x-auto, which CSS computes to `auto` on BOTH
    // axes — so the header anchors to this div, and a div with no bounded
    // height never scrolls for it to stick within.
    //
    // Queried by the data-slot the existing Table already carries rather than
    // a testid added for the test's benefit.
    expect(
      container.querySelector('[data-slot="table-container"]')?.className,
    ).toContain("max-h-[32rem]");
  });
});
