import {
  AssetCondition,
  AssetEventType,
  AssetStatus,
  Role,
} from "@prisma/client";
import { describe, expect, it } from "vitest";

import { STATUS_LABELS } from "./asset-lifecycle";
import {
  CONDITION_LABELS,
  CONDITION_ORDER,
  EVENT_TYPE_LABELS,
  ROLE_LABELS,
  ROLE_ORDER,
} from "./labels";

/**
 * These are set-equality tests, and that is the entire point (LEARNINGS
 * §Process: "vocabulary changes need a codebase audit … one-line set-equality
 * tests prevent the next divergence").
 *
 * `Record<Enum, string>` already makes `tsc` reject a MISSING key, so the
 * interesting half is the other direction plus the hand-maintained option
 * tuples below, which the type system cannot see at all.
 */
describe("label maps cover their enums", () => {
  it.each([
    ["condition", CONDITION_LABELS, AssetCondition],
    ["role", ROLE_LABELS, Role],
    ["event type", EVENT_TYPE_LABELS, AssetEventType],
    ["status", STATUS_LABELS, AssetStatus],
  ])("%s", (_name, labels, enumObject) => {
    expect(new Set(Object.keys(labels))).toEqual(
      new Set(Object.values(enumObject)),
    );
  });

  it("labels every value with non-empty prose, never the enum itself", () => {
    for (const labels of [
      CONDITION_LABELS,
      ROLE_LABELS,
      EVENT_TYPE_LABELS,
      STATUS_LABELS,
    ]) {
      for (const [value, label] of Object.entries(labels)) {
        expect(label.trim()).not.toBe("");
        // The failure this catches is a new enum member added to the map with
        // its own name pasted in as a placeholder — which type-checks, renders,
        // and looks exactly like the bug this whole module exists to fix.
        expect(label).not.toBe(value);
      }
    }
  });
});

/**
 * The ordered tuples are what the pickers render. `satisfies` already rejects a
 * member that is not in the enum; only a set-equality check catches the other
 * direction — an enum value with no tuple entry, which type-checks perfectly and
 * silently omits an option from its own picker.
 *
 * This is a check that used to be impossible to write: both tuples lived inside
 * `"use client"` form components, so reaching them from a node-environment test
 * meant importing JSX and, transitively, next-auth.
 */
describe("pickers offer every enum value", () => {
  it("offers every condition", () => {
    expect(new Set(CONDITION_ORDER)).toEqual(
      new Set(Object.values(AssetCondition)),
    );
  });

  it("offers every role", () => {
    expect(new Set(ROLE_ORDER)).toEqual(new Set(Object.values(Role)));
  });
});
