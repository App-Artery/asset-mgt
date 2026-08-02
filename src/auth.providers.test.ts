// @vitest-environment node
//
// A tripwire, not a feature test (issue #11, advisor condition 3).
//
// `/admin/users` renders `User.emailVerified` as "last successful magic-link
// sign-in". That reading is only true because the magic link is the ONLY way
// into this app: `@auth/core` writes that column from the
// `account.type === "email"` branch of handleLoginOrRegister and nowhere else.
// Add an OAuth or a WebAuthn provider and the column keeps its old values
// forever while those users sign in daily — the admin screen would report
// "Never signed in" about the most active person in the building, and nothing
// would fail.
//
// So the provider COUNT is what is pinned. There is no clever assertion that
// catches the semantic drift itself; the only reliable signal is "the shape of
// the front door changed", and the test's job is to put a human back in front
// of the comment in src/app/(app)/admin/users/page.tsx before they ship it.
import { beforeAll, describe, expect, it, vi } from "vitest";

// Only the NextAuth CONSTRUCTOR is stubbed, and only because importing it
// pulls `next/server` into a bare vitest run. `authOptions` is this repo's own
// function and runs for real — providers included, built by the real
// `next-auth/providers/resend` factory. Nothing about the assertion below is
// mocked.
vi.mock("next-auth", () => ({ default: () => ({}) }));

describe("auth provider surface", () => {
  beforeAll(() => {
    // authOptions() reads through env() and constructs the Prisma adapter.
    // Nothing here connects — the client is lazy — so a syntactically valid
    // dummy URL is enough, and using one keeps this file from ever pointing at
    // a real database.
    process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/unused";
    process.env.AUTH_SECRET = "test-secret";
    process.env.AUTH_RESEND_KEY = "test-key";
    process.env.AUTH_EMAIL_FROM = "test@example.com";
  });

  it("has exactly one provider, and it is the Resend magic link", async () => {
    const { authOptions } = await import("@/auth");

    const providers = authOptions().providers;
    const ids = providers.map((provider) =>
      typeof provider === "function" ? provider().id : provider.id,
    );

    // If this went red because you added a provider: read the `emailVerified`
    // comment in src/app/(app)/admin/users/page.tsx first. That column's
    // meaning is what you are changing, and it needs a decision, not a bumped
    // number.
    expect(ids).toEqual(["resend"]);
  });
});
