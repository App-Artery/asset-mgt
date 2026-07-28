import "@testing-library/jest-dom/vitest";

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
