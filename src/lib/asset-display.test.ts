import { describe, expect, it } from "vitest";
import {
  assetDisplayName,
  UNNAMED_ASSET,
  type AssetNameFields,
} from "@/lib/asset-display";

/** A fully-blank asset; each test fills in only what it is about. */
const blank: AssetNameFields = {
  make: null,
  model: null,
  description: null,
  tag: null,
};

describe("assetDisplayName", () => {
  it("prefers make and model together", () => {
    expect(
      assetDisplayName({
        ...blank,
        make: "HP",
        model: "EliteBook 840",
        description: "a description that must lose",
        tag: "KE001771",
      }),
    ).toBe("HP EliteBook 840");
  });

  // The partial-pair case. Pushing this down to `description` would discard a
  // make the operator typed deliberately.
  it("uses a lone make without rendering the missing model", () => {
    expect(assetDisplayName({ ...blank, make: "HP", tag: "KE001771" })).toBe(
      "HP",
    );
  });

  it("uses a lone model", () => {
    expect(
      assetDisplayName({ ...blank, model: "EliteBook 840", tag: "KE001771" }),
    ).toBe("EliteBook 840");
  });

  // THE IMPORT CASE, and the reason this module exists: the client's real rows
  // have neither make nor model. Before AM-04 every render site did
  // `{make} {model}` and this row would have been labelled with nothing.
  it("falls back to description when make and model are both absent", () => {
    expect(
      assetDisplayName({
        ...blank,
        description: "HP USB-C G5 Essential Docking Station",
        tag: "KE001771",
      }),
    ).toBe("HP USB-C G5 Essential Docking Station");
  });

  it("falls back to tag when there is no description either", () => {
    expect(assetDisplayName({ ...blank, tag: "KE001771" })).toBe("KE001771");
  });

  // Reachable: the am02 CHECK exempts ON_ORDER and RETIRED from needing a tag,
  // so an ordered-but-undelivered asset can have no name at all.
  it("falls back to a placeholder when the asset has no name at all", () => {
    expect(assetDisplayName(blank)).toBe(UNNAMED_ASSET);
  });

  // Whitespace-only fields come from the hand-typed form, not the import —
  // the import normalises to null before writing.
  it("treats whitespace-only fields as absent at every level", () => {
    expect(
      assetDisplayName({
        make: "   ",
        model: "\t",
        description: "  ",
        tag: " KE001771 ",
      }),
    ).toBe("KE001771");
  });

  it("trims the values it returns", () => {
    expect(assetDisplayName({ ...blank, make: "  HP  ", model: " 840 " })).toBe(
      "HP 840",
    );
  });

  // Callers render this directly with no fallback of their own, which is only
  // safe if it is never empty — otherwise the precedence drifts back out into
  // the seven call sites this module exists to replace.
  it("never returns an empty string, for any combination of blanks", () => {
    const values = [null, "", "   ", "x"];
    for (const make of values) {
      for (const model of values) {
        for (const description of values) {
          for (const tag of values) {
            expect(
              assetDisplayName({ make, model, description, tag }).length,
            ).toBeGreaterThan(0);
          }
        }
      }
    }
  });
});
