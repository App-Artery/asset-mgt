// @vitest-environment node
//
// The PII chokepoint, asserted directly rather than through a page.
//
// WHY THIS FILE EXISTS: mutation testing (issue #12) found that changing
// `employeeRef: role !== Role.STAFF_RO` to `employeeRef: true` — fetching a
// staff-read-only viewer the employee reference the docblock's own table denies
// them — killed no test. The page-level integration tests assert on what is
// RENDERED, and CLAUDE.md's rule is that the data must not be FETCHED. Between
// those two sits the select itself, which nothing was checking.
//
// So this file asserts the select object, field by field, for every role. It is
// the shape the query is built from, which is the thing the rule is about.
import { Role } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  PERSON_NAME_SELECT,
  canViewAssignments,
  personSelectFor,
} from "@/lib/person-visibility";

const ALL_ROLES = [
  Role.ADMIN_IT,
  Role.PROCUREMENT,
  Role.FINANCE,
  Role.STAFF_RO,
] as const;

/**
 * The table in person-visibility.ts's docblock, written out longhand as the
 * spec rather than derived from the implementation. Widening any `false` here
 * is a DPA-note review (docs/DPA-TRANSFER-NOTE.md), so it must be impossible to
 * do by accident.
 */
const EXPECTED: Record<
  Role,
  { id: boolean; name: boolean; employeeRef: boolean; email: boolean }
> = {
  ADMIN_IT: { id: true, name: true, employeeRef: true, email: true },
  PROCUREMENT: { id: true, name: true, employeeRef: true, email: false },
  FINANCE: { id: true, name: true, employeeRef: true, email: false },
  STAFF_RO: { id: true, name: true, employeeRef: false, email: false },
};

describe("personSelectFor — the field tiers, per role", () => {
  for (const role of ALL_ROLES) {
    it(`${role} selects exactly the fields it is entitled to`, () => {
      // toEqual, not toMatchObject: an extra key is a new PII field nobody
      // reviewed, and matching loosely would wave it through.
      expect(personSelectFor(role)).toEqual(EXPECTED[role]);
    });
  }

  it("never selects employeeRef for STAFF_RO", () => {
    // Called out separately from the table because this is the specific
    // widening the mutation run proved nothing was catching, and a table is
    // easy to edit without noticing which cell moved.
    expect(personSelectFor(Role.STAFF_RO).employeeRef).toBe(false);
  });

  it("selects email for ADMIN_IT alone", () => {
    for (const role of ALL_ROLES) {
      expect(personSelectFor(role).email).toBe(role === Role.ADMIN_IT);
    }
  });
});

describe("PERSON_NAME_SELECT", () => {
  it("is exactly id and name — no field any role is denied", () => {
    expect(PERSON_NAME_SELECT).toEqual({ id: true, name: true });
  });
});

describe("canViewAssignments", () => {
  it.each(ALL_ROLES)("%s", (role) => {
    expect(canViewAssignments(role)).toBe(role !== Role.STAFF_RO);
  });

  it("is false for STAFF_RO and true for every other role", () => {
    // The positive half matters as much as the negative one: a mutant that
    // returns false for everybody would satisfy "STAFF_RO cannot see holders"
    // while breaking the app for the three roles that can.
    expect(canViewAssignments(Role.STAFF_RO)).toBe(false);
    expect(canViewAssignments(Role.ADMIN_IT)).toBe(true);
    expect(canViewAssignments(Role.PROCUREMENT)).toBe(true);
    expect(canViewAssignments(Role.FINANCE)).toBe(true);
  });
});
