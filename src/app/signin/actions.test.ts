// @vitest-environment node
//
// Enumeration-proofing at the action seam: every outcome of requestSignIn —
// accepted, rejected by the sign-in policy (AccessDenied), malformed input —
// must return byte-identical state. The policy's DB-backed decisions are
// covered by src/lib/sign-in-policy.integration.test.ts; here the Auth.js
// transport is mocked to drive each outcome.
import { describe, expect, it, vi, type Mock } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  handlers: {},
}));

import { signIn } from "@/auth";
import { requestSignIn } from "@/app/signin/actions";

const mockSignIn = signIn as unknown as Mock;

function formDataWith(email: string): FormData {
  const fd = new FormData();
  fd.set("email", email);
  return fd;
}

describe("requestSignIn uniformity", () => {
  it("returns the same state for accepted and policy-rejected requests", async () => {
    mockSignIn.mockResolvedValueOnce("https://example.com/signin?sent=1");
    const accepted = await requestSignIn(
      { sent: false },
      formDataWith("known@example.com"),
    );

    mockSignIn.mockRejectedValueOnce(new Error("AccessDenied"));
    const rejected = await requestSignIn(
      { sent: false },
      formDataWith("unknown@example.com"),
    );

    expect(accepted).toEqual({ sent: true });
    expect(rejected).toEqual(accepted);
  });

  it("normalises the email before handing it to Auth.js", async () => {
    mockSignIn.mockResolvedValueOnce("ok");
    await requestSignIn(
      { sent: false },
      formDataWith("  Mixed.Case@Example.COM "),
    );
    expect(mockSignIn).toHaveBeenLastCalledWith("resend", {
      email: "mixed.case@example.com",
      redirect: false,
    });
  });

  it("returns the same state for malformed input without calling Auth.js", async () => {
    mockSignIn.mockClear();
    const result = await requestSignIn(
      { sent: false },
      formDataWith("not-an-email"),
    );
    expect(result).toEqual({ sent: true });
    expect(mockSignIn).not.toHaveBeenCalled();
  });
});
