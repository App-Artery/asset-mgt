// @vitest-environment node
//
// Enumeration-proofing at the action seam: every outcome of requestSignIn —
// accepted, rejected by the sign-in policy (AccessDenied), malformed input —
// must return byte-identical state. The policy's DB-backed decisions are
// covered by src/lib/sign-in-policy.integration.test.ts; here the Auth.js
// transport is mocked to drive each outcome.
import { afterEach, describe, expect, it, vi, type Mock } from "vitest";

vi.mock("@/auth", () => ({
  auth: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  handlers: {},
}));

import { signIn } from "@/auth";
import { requestSignIn } from "@/app/signin/actions";

const mockSignIn = signIn as unknown as Mock;

// Shape of a real Auth.js AccessDenied: an Error whose `type` is
// "AccessDenied" (raw mode rethrows the AuthError instance).
function accessDeniedError(): Error {
  return Object.assign(new Error("AccessDenied"), { type: "AccessDenied" });
}

function formDataWith(email: string): FormData {
  const fd = new FormData();
  fd.set("email", email);
  return fd;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("requestSignIn uniformity", () => {
  it("returns the same state for accepted and policy-rejected requests", async () => {
    mockSignIn.mockResolvedValueOnce("https://example.com/signin?sent=1");
    const accepted = await requestSignIn(
      { sent: false },
      formDataWith("known@example.com"),
    );

    mockSignIn.mockRejectedValueOnce(accessDeniedError());
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

  it("logs genuine transport failures by name only — never the address", async () => {
    // A Resend outage or bad API key must leave a server-side trace (advisor
    // condition) while the rendered outcome stays identical to success. The
    // log line carries the error class only: no message, no email.
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    mockSignIn.mockRejectedValueOnce(
      Object.assign(new Error("550 rejected for victim@example.com"), {
        name: "ResendApiError",
      }),
    );
    const failed = await requestSignIn(
      { sent: false },
      formDataWith("victim@example.com"),
    );

    expect(failed).toEqual({ sent: true });
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    const logged = consoleSpy.mock.calls[0].join(" ");
    expect(logged).toContain("ResendApiError");
    expect(logged).not.toContain("victim");
    expect(logged).not.toContain("@example.com");
  });

  it("keeps AccessDenied silent — no log line for policy rejections", async () => {
    const consoleSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    mockSignIn.mockRejectedValueOnce(accessDeniedError());
    const rejected = await requestSignIn(
      { sent: false },
      formDataWith("unknown@example.com"),
    );

    expect(rejected).toEqual({ sent: true });
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});
