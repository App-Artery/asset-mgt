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

const BODY = (
  <>
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
  </>
);

/**
 * Two helpers rather than one taking a Partial: `sticky` and
 * `containerClassName` are a prop UNION now, and a spread of a partial cannot
 * satisfy a union — which is the union doing its job.
 */
function renderTable() {
  return render(
    <ResponsiveTable
      cards={<p>cards</p>}
      tableTestId="thing-table"
      cardsTestId="thing-cards"
    >
      {BODY}
    </ResponsiveTable>,
  );
}

function renderStickyTable() {
  return render(
    <ResponsiveTable
      cards={<p>cards</p>}
      tableTestId="thing-table"
      cardsTestId="thing-cards"
      sticky
      containerClassName={SCROLL_PANE}
    >
      {BODY}
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
    renderStickyTable();
    const table = screen.getByRole("table");
    // Targeted at thead th only: a sticky <td> would freeze the first column.
    expect(table.className).toContain("[&_thead_th]:sticky");
    expect(table.className).toContain("[&_thead_th]:bg-background");
  });

  it("will not typecheck sticky without a height to stick within", () => {
    // The pairing is enforced by the prop union, not by this assertion —
    // `sticky` alone is a compile error, so the guard is `pnpm typecheck` and
    // this records why. @ts-expect-error FAILS THE BUILD if the union is ever
    // loosened back to two independent optionals, which is what makes it a
    // real guard rather than a comment.
    const invalid = (
      // @ts-expect-error sticky requires containerClassName
      <ResponsiveTable cards={null} tableTestId="t" cardsTestId="c" sticky>
        <TableBody />
      </ResponsiveTable>
    );
    expect(invalid).toBeTruthy();
  });

  it("passes the scroll pane through to the container", () => {
    const { container } = renderStickyTable();
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
