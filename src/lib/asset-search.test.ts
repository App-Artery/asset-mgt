// The register search predicate as a contract: what an empty term produces,
// what a real term produces, and the security property that the shape does not
// depend on anything but the string. Pure module, no DB.
import { describe, expect, it } from "vitest";
import { assetSearchWhere, normaliseSearchTerm } from "@/lib/asset-search";

describe("normaliseSearchTerm", () => {
  it("collapses interior whitespace runs and trims the ends", () => {
    expect(normaliseSearchTerm("  ThinkPad   X1 ")).toBe("ThinkPad X1");
  });

  it("collapses a whitespace-only term to the empty string", () => {
    expect(normaliseSearchTerm("   ")).toBe("");
    expect(normaliseSearchTerm("\t\n ")).toBe("");
  });

  it("is idempotent, so a caller that already normalised pays nothing", () => {
    const once = normaliseSearchTerm("  Dell   Latitude  5440 ");
    expect(normaliseSearchTerm(once)).toBe(once);
  });
});

describe("assetSearchWhere", () => {
  // The guard this file exists for. `contains: ""` is NOT a no-op predicate:
  // it compiles to `ILIKE '%%'`, and `NULL ILIKE '%%'` is NULL rather than
  // TRUE, so any branch over a nullable column drops rows where that column is
  // null. `tag` and `serial` are both nullable on Asset. Today the non-nullable
  // `make`/`model` branches mask that inside the OR, which makes this a
  // latent bug rather than a live one — narrowing the OR would wake it up.
  // Emitting no predicate at all cannot rot that way.
  it.each([
    ["an empty string", ""],
    ["spaces only", "   "],
    ["tabs and newlines only", "\t\n"],
  ])("returns no predicate for %s", (_label, term) => {
    expect(assetSearchWhere(term)).toEqual({});
  });

  it("does not emit an OR branch over a nullable column for an empty term", () => {
    // Asserted structurally rather than via toEqual({}) alone: this is the
    // failure mode (a nullable column filtered on `contains: ""`), so name it.
    const where = assetSearchWhere("   ");
    expect(where.OR).toBeUndefined();
    expect(JSON.stringify(where)).not.toContain("contains");
  });

  it("searches tag, serial, make, model, description and category name", () => {
    expect(assetSearchWhere("ThinkPad")).toEqual({
      OR: [
        { tag: { contains: "ThinkPad", mode: "insensitive" } },
        { serial: { contains: "ThinkPad", mode: "insensitive" } },
        { make: { contains: "ThinkPad", mode: "insensitive" } },
        { model: { contains: "ThinkPad", mode: "insensitive" } },
        // AM-04: the only name an imported asset has, since the export leaves
        // Brand and Model blank on every row.
        { description: { contains: "ThinkPad", mode: "insensitive" } },
        { category: { name: { contains: "ThinkPad", mode: "insensitive" } } },
      ],
    });
  });

  it("normalises a term it is handed unnormalised", () => {
    // The page normalises at its parse boundary; the helper must not rely on
    // that, or an un-normalised caller gets the silent empty result set.
    expect(assetSearchWhere("  ThinkPad   X1 ")).toEqual(
      assetSearchWhere("ThinkPad X1"),
    );
  });

  // The T3 ruling on issue #7: the predicate is asset-attribute-only, so the
  // clause for a given string is the same object for every reader. There is no
  // role parameter to vary it with, and this asserts the consequence rather
  // than the signature.
  it("mentions no field outside the six asset attributes", () => {
    const serialised = JSON.stringify(assetSearchWhere("grace"));
    for (const forbidden of [
      "person",
      "Person",
      "assignment",
      "Assignment",
      "notes",
      "user",
      "User",
      "email",
      "name'",
    ]) {
      expect(serialised).not.toContain(forbidden);
    }
    // `category.name` is the one legitimate `name`, so assert the count.
    expect(serialised.match(/"name"/g)).toHaveLength(1);
  });
});
