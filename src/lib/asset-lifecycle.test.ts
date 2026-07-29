// The lifecycle contract, restated independently of the implementation: the
// full 5×5 transition matrix (every from × every to, self-transitions
// included), the tag rule, and the typed guard error. Pure module, no DB.
import { AssetStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  ASSET_TRANSITIONS,
  IllegalTransitionError,
  assertTransition,
  canTransition,
  tagRequiredFor,
} from "@/lib/asset-lifecycle";

const ALL_STATUSES = [
  AssetStatus.ON_ORDER,
  AssetStatus.IN_STOCK,
  AssetStatus.ASSIGNED,
  AssetStatus.IN_REPAIR,
  AssetStatus.RETIRED,
] as const;

// Written out longhand on purpose: this table is the spec, not a restatement
// of ASSET_TRANSITIONS. Editing the map without editing this goes red.
const EXPECTED: Record<AssetStatus, Record<AssetStatus, boolean>> = {
  ON_ORDER: {
    ON_ORDER: false,
    IN_STOCK: true,
    ASSIGNED: false,
    IN_REPAIR: false,
    RETIRED: true,
  },
  IN_STOCK: {
    ON_ORDER: false,
    IN_STOCK: false,
    ASSIGNED: true,
    IN_REPAIR: true,
    RETIRED: true,
  },
  ASSIGNED: {
    ON_ORDER: false,
    IN_STOCK: true,
    ASSIGNED: false,
    IN_REPAIR: true,
    RETIRED: true,
  },
  IN_REPAIR: {
    ON_ORDER: false,
    IN_STOCK: true,
    ASSIGNED: false,
    IN_REPAIR: false,
    RETIRED: true,
  },
  RETIRED: {
    ON_ORDER: false,
    IN_STOCK: false,
    ASSIGNED: false,
    IN_REPAIR: false,
    RETIRED: false,
  },
};

describe("canTransition — full 5×5 matrix", () => {
  for (const from of ALL_STATUSES) {
    for (const to of ALL_STATUSES) {
      const allowed = EXPECTED[from][to];
      it(`${from} -> ${to} is ${allowed ? "allowed" : "rejected"}`, () => {
        expect(canTransition(from, to)).toBe(allowed);
      });
    }
  }

  it("treats every self-transition as illegal, not a no-op", () => {
    for (const status of ALL_STATUSES) {
      expect(canTransition(status, status)).toBe(false);
    }
  });

  it("makes RETIRED terminal — nothing leaves it", () => {
    expect(ASSET_TRANSITIONS.RETIRED).toEqual([]);
  });

  it("keeps IN_STOCK <-> ASSIGNED in the map for AM-03", () => {
    // No AM-02 UI offers these, but AM-03 must add assignment without
    // touching lifecycle logic.
    expect(canTransition(AssetStatus.IN_STOCK, AssetStatus.ASSIGNED)).toBe(
      true,
    );
    expect(canTransition(AssetStatus.ASSIGNED, AssetStatus.IN_STOCK)).toBe(
      true,
    );
  });
});

describe("assertTransition", () => {
  it("returns silently for every legal transition", () => {
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        if (EXPECTED[from][to]) {
          expect(() => assertTransition(from, to)).not.toThrow();
        }
      }
    }
  });

  it("throws IllegalTransitionError carrying from/to for every illegal one", () => {
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        if (EXPECTED[from][to]) continue;
        let thrown: unknown;
        try {
          assertTransition(from, to);
        } catch (error) {
          thrown = error;
        }
        expect(thrown).toBeInstanceOf(IllegalTransitionError);
        const error = thrown as IllegalTransitionError;
        expect(error.name).toBe("IllegalTransitionError");
        expect(error.from).toBe(from);
        expect(error.to).toBe(to);
        expect(error.message).toContain(from);
        expect(error.message).toContain(to);
      }
    }
  });
});

describe("tagRequiredFor", () => {
  // Mirrors the Asset_tag_required_when_tracked CHECK constraint exactly.
  const EXPECTED_TAG_REQUIRED: Record<AssetStatus, boolean> = {
    ON_ORDER: false,
    IN_STOCK: true,
    ASSIGNED: true,
    IN_REPAIR: true,
    RETIRED: false,
  };

  for (const status of ALL_STATUSES) {
    it(`${status} ${EXPECTED_TAG_REQUIRED[status] ? "requires" : "does not require"} a tag`, () => {
      expect(tagRequiredFor(status)).toBe(EXPECTED_TAG_REQUIRED[status]);
    });
  }
});
