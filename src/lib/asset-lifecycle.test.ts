// The lifecycle contract, restated independently of the implementation: the
// full 5×5 transition matrix (every from × every to, self-transitions
// included), the tag rule, and the typed guard error. Pure module, no DB.
import { AssetCondition, AssetStatus } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  ASSET_TRANSITIONS,
  IllegalTransitionError,
  assertTransition,
  canTransition,
  conditionNotesRequiredFor,
  tagRequiredFor,
} from "@/lib/asset-lifecycle";

const ALL_STATUSES = [
  AssetStatus.ON_ORDER,
  AssetStatus.IN_STOCK,
  AssetStatus.ASSIGNED,
  AssetStatus.IN_REPAIR,
  AssetStatus.RETIRED,
] as const;

const ALL_CONDITIONS = [
  AssetCondition.NEW,
  AssetCondition.GOOD,
  AssetCondition.FAIR,
  AssetCondition.POOR,
  AssetCondition.DEFECTIVE,
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

/**
 * DESIGN §4.4: prose is demanded only where it carries information — kit going
 * to repair, or coming back POOR or DEFECTIVE.
 *
 * WHY THIS BLOCK EXISTS: mutation testing (issue #12) found that the entire
 * body of `conditionNotesRequiredFor` could be replaced with `return undefined`
 * and the suite stayed green — all eleven survivors in this module were in this
 * one function. The repair clause is independently re-checked inside
 * `transitionAssetStatusTx` against the locked status, which is what kept the
 * integration tests green while this predicate said nothing; the POOR and
 * DEFECTIVE clauses have no such second enforcer and were defended by nothing
 * at all.
 *
 * The full 5×5 matrix, longhand, for the same reason the transition table above
 * is longhand: it is the spec, not a restatement of the implementation.
 */
describe("conditionNotesRequiredFor — full status × condition matrix", () => {
  function expected(status: AssetStatus, condition: AssetCondition): boolean {
    return (
      status === AssetStatus.IN_REPAIR ||
      condition === AssetCondition.POOR ||
      condition === AssetCondition.DEFECTIVE
    );
  }

  for (const status of ALL_STATUSES) {
    for (const condition of ALL_CONDITIONS) {
      const required = expected(status, condition);
      it(`${status} + ${condition} ${required ? "requires" : "does not require"} a note`, () => {
        expect(conditionNotesRequiredFor(status, condition)).toBe(required);
      });
    }
  }

  it("demands a note for every repair-bound return, whatever the condition", () => {
    for (const condition of ALL_CONDITIONS) {
      expect(conditionNotesRequiredFor(AssetStatus.IN_REPAIR, condition)).toBe(
        true,
      );
    }
  });

  it("demands a note for POOR and DEFECTIVE even when the kit goes back on the shelf", () => {
    // The clause with no second enforcer anywhere: if this predicate stops
    // returning true here, a DEFECTIVE laptop is filed back into stock with no
    // explanation and nothing else in the system objects.
    expect(
      conditionNotesRequiredFor(AssetStatus.IN_STOCK, AssetCondition.POOR),
    ).toBe(true);
    expect(
      conditionNotesRequiredFor(AssetStatus.IN_STOCK, AssetCondition.DEFECTIVE),
    ).toBe(true);
  });

  it("does not demand one for a routine GOOD return", () => {
    // The other half of the rule, and the reason it is not "always require a
    // note": forcing prose on every routine return trains operators to type
    // "ok" and destroys the signal.
    expect(
      conditionNotesRequiredFor(AssetStatus.IN_STOCK, AssetCondition.GOOD),
    ).toBe(false);
    expect(
      conditionNotesRequiredFor(AssetStatus.IN_STOCK, AssetCondition.NEW),
    ).toBe(false);
    expect(
      conditionNotesRequiredFor(AssetStatus.IN_STOCK, AssetCondition.FAIR),
    ).toBe(false);
  });
});
