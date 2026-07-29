import "@testing-library/jest-dom/vitest";

// Vitest loads .env into process.env, and this repo's gitignored .env holds the
// PRODUCTION DATABASE_URL (ops convenience from provisioning — AM-01 retro §5).
// So every test file starts life pointed at production, and a test that reaches
// getDb() before overriding DATABASE_URL itself would write to the live
// register. env() caches on first call, which makes it worse: one module
// touching env() early pins the production URL for the whole file.
//
// Point DATABASE_URL at the test database before any test code runs, so
// forgetting the per-file override is harmless instead of catastrophic. Files
// that set it themselves are unaffected. Without TEST_DATABASE_URL the
// integration suites skip anyway (describe.skipIf), and leaving the value alone
// keeps that skip behaviour honest.
if (process.env.TEST_DATABASE_URL) {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
}

// Radix/shadcn components need ResizeObserver, which jsdom does not provide
// (LEARNINGS §Testing).
class ResizeObserverStub implements ResizeObserver {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = ResizeObserverStub;
}
