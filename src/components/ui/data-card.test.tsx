import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  DataCard,
  DataCardHeadline,
  DataCardList,
  DataCardMeta,
} from "./data-card";

describe("DataCardList", () => {
  it("is a labelled list, so a screen reader announces what it is", () => {
    render(
      <DataCardList label="Asset register">
        <DataCard>one</DataCard>
      </DataCardList>,
    );
    const list = screen.getByRole("list", { name: "Asset register" });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
  });

  it("does NOT hide itself at md — ResponsiveTable owns the breakpoint", () => {
    render(
      <DataCardList label="Asset register">
        <DataCard>one</DataCard>
      </DataCardList>,
    );
    // Two owners of one breakpoint is how the two shapes drift apart.
    expect(screen.getByRole("list").className).not.toContain("md:hidden");
  });
});

describe("DataCard", () => {
  it("wraps the whole card in a link when given an href", () => {
    render(
      <DataCardList label="x">
        <DataCard href="/assets/abc">AST-0412</DataCard>
      </DataCardList>,
    );
    expect(screen.getByRole("link", { name: "AST-0412" })).toHaveAttribute(
      "href",
      "/assets/abc",
    );
  });

  it("renders a plain card when there is nowhere to go", () => {
    render(
      <DataCardList label="x">
        <DataCard>AST-0412</DataCard>
      </DataCardList>,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("DataCardMeta", () => {
  it("drops empty parts instead of printing stray separators", () => {
    render(<DataCardMeta parts={["Nairobi", null, undefined, "Laptop"]} />);
    // "Nairobi · Laptop", never "Nairobi ·  · Laptop".
    expect(screen.getByTestId("data-card-meta").textContent).toBe(
      "Nairobi · Laptop",
    );
  });

  it("separates element parts too, so a <time> can sit in the meta line", () => {
    render(
      <DataCardMeta parts={[<time key="t">2 days ago</time>, "Nairobi"]} />,
    );
    expect(screen.getByTestId("data-card-meta").textContent).toBe(
      "2 days ago · Nairobi",
    );
  });

  it("renders nothing at all when every part is empty", () => {
    render(<DataCardMeta parts={[null, undefined, ""]} />);
    expect(screen.queryByTestId("data-card-meta")).toBeNull();
  });
});

describe("DataCardHeadline", () => {
  it("renders its children", () => {
    render(
      <DataCardHeadline>
        <span>AST-0412</span>
      </DataCardHeadline>,
    );
    expect(screen.getByText("AST-0412")).toBeInTheDocument();
  });
});
