// Component half of the uniformity contract: whatever the action decided,
// the form renders the single SENT_MESSAGE — there is no failure branch to
// render. The action-side uniformity is proven in actions.test.ts.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SENT_MESSAGE, SignInForm } from "@/app/signin/sign-in-form";

// RTL auto-cleanup needs vitest globals, which this config keeps off —
// clean up explicitly or renders stack across tests.
afterEach(cleanup);

function submitWith(email: string) {
  fireEvent.change(screen.getByLabelText("Work email"), {
    target: { value: email },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Email me a sign-in link" }),
  );
}

describe("SignInForm", () => {
  it("renders the email form initially, without any outcome message", () => {
    render(<SignInForm action={vi.fn(async () => ({ sent: true }))} />);
    expect(screen.getByLabelText("Work email")).toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("renders the uniform confirmation after a successful request", async () => {
    render(<SignInForm action={async () => ({ sent: true })} />);
    submitWith("known@example.com");

    expect(await screen.findByRole("status")).toHaveTextContent(SENT_MESSAGE);
    // The form is gone — nothing outcome-specific remains to inspect.
    expect(screen.queryByLabelText("Work email")).not.toBeInTheDocument();
  });

  it("renders the identical confirmation when the server rejected the address", async () => {
    // A rejected/throttled/unknown address still resolves to { sent: true } —
    // the action swallows AccessDenied (see requestSignIn). The rendered
    // outcome must be indistinguishable from success.
    render(<SignInForm action={async () => ({ sent: true })} />);
    submitWith("unknown-or-deactivated@example.com");

    expect(await screen.findByRole("status")).toHaveTextContent(SENT_MESSAGE);
    expect(screen.queryByLabelText("Work email")).not.toBeInTheDocument();
  });
});
