# AM-08 — App shell, theming, and the responsive register

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans`
> to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for
> tracking.

**Goal:** Give the app a persistent shell with working light/dark theming, a
semantic status-colour family, and a register that survives a phone screen.

**Architecture:** A `(app)` route group owns one shell layout (left rail +
app bar); every existing authenticated page moves under it and sheds its
hand-rolled `<main>` wrapper and link row. `next-themes` sits in the **root**
layout so `/signin` is themed too. The register renders a `<table>` and a card
list from one server component, choosing between them with Tailwind
breakpoints, never with a media-query hook.

**Tech Stack:** Next.js 15 App Router (dynamic SSR), Tailwind v4 (CSS-first),
shadcn/ui hand-written primitives, `next-themes`, `lucide-react`, Vitest +
Testing Library, real-Postgres integration tests.

**Spec:** `docs/DESIGN-SYSTEM.md`. **Tier:** 2 (no auth surface, no PII
surface, no deletion path — the Tier 3 floor does not apply).

## Global Constraints

- `await requireRole(...)` stays the FIRST statement of every mutating server
  action and route handler. The shell layout's `requireRole` is **additional**,
  never a replacement — a layout is not an authorisation boundary.
- No `process.env` reads at module top level. `pnpm build` must succeed with
  zero env populated; CI proves it every run.
- Person-field selects may only be written in `personSelectFor(role)`
  (`src/lib/person-visibility.ts`). This plan adds **no** new Person select.
- `STAFF_RO` sees no person data: the holder query must remain **not run** for
  that role. Hiding a column with CSS is never the mechanism.
- Tailwind v4 arbitrary values use `rounded-(--radius-md)` — the
  `rounded-[--radius-md]` form is silently dropped by the browser with no
  compiler or lint signal (LEARNINGS §Frontend).
- Tailwind v4 has **no** `max-w-screen-*` utilities; `max-w-screen-2xl` compiles
  to nothing.
- No shadcn CLI. Primitives are hand-written (LEARNINGS §Next.js).
- Every test file must typecheck: `pnpm typecheck` runs on every task that
  writes one (LEARNINGS §Testing).
- Every regression guard gets its **own** red-proof against its **own** window.
  "Prove it red once" for a neighbouring guard does not count — this failure
  class has now recurred three times in this project (LEARNINGS §Testing).

---

### Task 1: Theming — `next-themes`, icons, and the toggle

**Files:**

- Modify: `package.json` (deps)
- Modify: `src/app/layout.tsx`
- Create: `src/components/theme-provider.tsx`
- Create: `src/components/theme-toggle.tsx`
- Test: `src/components/theme-toggle.test.tsx`

**Interfaces:**

- Produces: `<ThemeProvider>` (client, wraps children); `<ThemeToggle />`
  (client, no props) — Task 3's app bar renders `<ThemeToggle />`.

- [ ] **Step 1: Install dependencies**

```bash
pnpm add next-themes lucide-react
```

- [ ] **Step 2: Create the provider**

`src/components/theme-provider.tsx`:

```tsx
"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

/**
 * Thin client boundary around next-themes.
 *
 * It wraps {children} without consuming them, so server components passed
 * through it stay server components — the root layout remains a server
 * component and force-dynamic rendering is unaffected.
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  );
}
```

- [ ] **Step 3: Wire it into the root layout**

In `src/app/layout.tsx`, add `suppressHydrationWarning` to `<html>` and wrap
the body's children. Keep `export const dynamic = "force-dynamic"` exactly as
it is.

```tsx
<html lang="en" suppressHydrationWarning>
  <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
    <ThemeProvider>{children}</ThemeProvider>
  </body>
</html>
```

Add above the component, so the reason survives the next reader:

```tsx
// suppressHydrationWarning is REQUIRED, not cosmetic: next-themes' inline
// script sets the `class` attribute before React hydrates, so <html> always
// mismatches. It suppresses that element's own attributes one level deep and
// does NOT mask mismatches anywhere below it.
```

- [ ] **Step 4: Write the failing test**

`src/components/theme-toggle.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const setTheme = vi.fn();

// next-themes reads matchMedia and localStorage; mock the hook rather than the
// storage layer so the test asserts OUR component, not the library.
vi.mock("next-themes", () => ({
  useTheme: () => ({ theme: "system", setTheme, resolvedTheme: "light" }),
}));

import { ThemeToggle } from "@/components/theme-toggle";

describe("ThemeToggle", () => {
  it("offers all three theme choices, so a user can return to System", async () => {
    render(<ThemeToggle />);

    const select = screen.getByRole("combobox", { name: /theme/i });
    const values = Array.from(
      select.querySelectorAll("option"),
      (option) => option.value,
    );

    expect(values).toEqual(["light", "dark", "system"]);
  });

  it("applies the chosen theme", async () => {
    render(<ThemeToggle />);

    await userEvent.selectOptions(
      screen.getByRole("combobox", { name: /theme/i }),
      "dark",
    );

    expect(setTheme).toHaveBeenCalledWith("dark");
  });
});
```

- [ ] **Step 5: Run it and watch it fail**

```bash
pnpm vitest run src/components/theme-toggle.test.tsx
```

Expected: FAIL — `Failed to resolve import "@/components/theme-toggle"`.

- [ ] **Step 6: Implement the toggle**

`src/components/theme-toggle.tsx`. A native `<select>`, matching
`src/components/ui/select.tsx`'s existing reasoning: three options need no
Radix portal, and it stays keyboard-accessible for free.

```tsx
"use client";

import { useTheme } from "next-themes";

import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";

/**
 * Three states, not a two-way switch: a user who picked "System" must be able
 * to get back to it, which a boolean toggle makes impossible.
 *
 * `theme` is undefined until next-themes mounts and measures. Do NOT seed a
 * useState initialiser from it — the initialiser never re-runs and would pin
 * the SSR sentinel (LEARNINGS §Frontend). The select is driven directly.
 */
export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex items-center gap-2">
      <Label htmlFor="theme-select" className="sr-only">
        Theme
      </Label>
      <Select
        id="theme-select"
        value={theme ?? "system"}
        onChange={(event) => setTheme(event.target.value)}
        className="h-8"
      >
        <option value="light">Light</option>
        <option value="dark">Dark</option>
        <option value="system">System</option>
      </Select>
    </div>
  );
}
```

- [ ] **Step 7: Run tests and typecheck**

```bash
pnpm vitest run src/components/theme-toggle.test.tsx && pnpm typecheck
```

Expected: PASS, and `tsc` clean.

- [ ] **Step 8: Prove the env-free build still works**

```bash
env -i PATH="$PATH" HOME="$HOME" pnpm build
```

Expected: build succeeds with no env populated. This is the standing proof
that the client boundary did not drag env into module scope.

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-lock.yaml src/app/layout.tsx src/components/theme-provider.tsx src/components/theme-toggle.tsx src/components/theme-toggle.test.tsx
git commit -m "feat(am-08): wire next-themes and a three-state theme toggle"
```

---

### Task 2: Status tokens and the `StatusChip`

**Files:**

- Modify: `src/app/globals.css`
- Create: `src/components/ui/status-chip.tsx`
- Test: `src/components/ui/status-chip.test.tsx`

**Interfaces:**

- Consumes: nothing from Task 1.
- Produces: `<StatusChip status={AssetStatus} />` — Task 4 renders it in both
  the table and the card list.

- [ ] **Step 1: Add the token family to `globals.css`**

Inside the existing `@theme inline` block, add:

```css
--color-st-stock: var(--st-stock);
--color-st-stock-bg: var(--st-stock-bg);
--color-st-assigned: var(--st-assigned);
--color-st-assigned-bg: var(--st-assigned-bg);
--color-st-repair: var(--st-repair);
--color-st-repair-bg: var(--st-repair-bg);
--color-st-inert: var(--st-inert);
--color-st-inert-bg: var(--st-inert-bg);
```

In `:root`:

```css
/* Semantic status colours. shadcn's neutral base ships none, and the
     register has five statuses operators scan all day. Weight follows
     operational attention: repair pulls the eye, retired lets go of it.
     ON_ORDER and RETIRED share the inert pair and are told apart by the
     chip's dot treatment, not by hue. */
--st-stock: oklch(0.48 0.12 155);
--st-stock-bg: oklch(0.95 0.035 155);
--st-assigned: oklch(0.48 0.14 255);
--st-assigned-bg: oklch(0.95 0.03 255);
--st-repair: oklch(0.52 0.12 70);
--st-repair-bg: oklch(0.95 0.05 80);
--st-inert: oklch(0.55 0 0);
--st-inert-bg: oklch(0.97 0 0);
```

In `.dark` — hand-tuned, not inverted: lightness rises and chroma drops so a
chip sits on `oklch(0.145 0 0)` without glowing.

```css
--st-stock: oklch(0.8 0.14 155);
--st-stock-bg: oklch(0.32 0.05 155);
--st-assigned: oklch(0.8 0.12 255);
--st-assigned-bg: oklch(0.32 0.05 255);
--st-repair: oklch(0.83 0.13 80);
--st-repair-bg: oklch(0.33 0.05 70);
--st-inert: oklch(0.68 0 0);
--st-inert-bg: oklch(0.26 0 0);
```

- [ ] **Step 2: Write the failing test**

`src/components/ui/status-chip.test.tsx`. The third case is the real guard —
it defends against the tailwind-merge trap in LEARNINGS §Frontend, where a
semantic colour token in a `cn()` call is silently eaten by a later `text-*`
utility because tailwind-merge cannot tell a custom colour from a font size.

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusChip } from "@/components/ui/status-chip";

describe("StatusChip", () => {
  it("renders the human label, never the enum", () => {
    render(<StatusChip status="IN_REPAIR" />);

    expect(screen.getByText("In repair")).toBeInTheDocument();
    expect(screen.queryByText("IN_REPAIR")).not.toBeInTheDocument();
  });

  it("distinguishes on-order from retired without relying on hue", () => {
    const { rerender } = render(<StatusChip status="ON_ORDER" />);
    const onOrder = screen.getByTestId("status-chip").className;

    rerender(<StatusChip status="RETIRED" />);
    const retired = screen.getByTestId("status-chip").className;

    // Both use the inert pair, so colour alone cannot tell them apart.
    expect(onOrder).not.toEqual(retired);
  });

  it("keeps its colour when a caller passes a text utility", () => {
    render(<StatusChip status="IN_REPAIR" className="text-xs" />);

    const chip = screen.getByTestId("status-chip");
    // tailwind-merge classifies unknown `text-*` values by shape; if it ever
    // reads text-st-repair as a font-size, `text-xs` silently wins and the
    // chip renders in the body colour. Both must survive the merge.
    expect(chip.className).toContain("text-st-repair");
    expect(chip.className).toContain("text-xs");
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

```bash
pnpm vitest run src/components/ui/status-chip.test.tsx
```

Expected: FAIL — `Failed to resolve import "@/components/ui/status-chip"`.

- [ ] **Step 4: Implement the chip**

`src/components/ui/status-chip.tsx`:

```tsx
import type { AssetStatus } from "@prisma/client";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";
import { STATUS_LABELS } from "@/lib/asset-lifecycle";

/**
 * The status vocabulary as colour. Built with cva rather than a status->class
 * map merged into cn(), because a per-entity colour map spread into the same
 * cn() call is exactly how a semantic token gets eaten by a later text-*
 * utility (LEARNINGS §Frontend).
 *
 * ON_ORDER and RETIRED share the inert pair deliberately — neither wants
 * attention — and are told apart by the dot: hollow-dashed for "not here yet",
 * hollow-solid for "terminal". Colour is never the only signal; every chip
 * also carries its text label.
 *
 * The type import is a type only, so this module stays client-safe, matching
 * asset-lifecycle.ts.
 */
const chipVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap [&>span]:size-1.5 [&>span]:rounded-full",
  {
    variants: {
      tone: {
        stock: "bg-st-stock-bg text-st-stock [&>span]:bg-current",
        assigned: "bg-st-assigned-bg text-st-assigned [&>span]:bg-current",
        repair: "bg-st-repair-bg text-st-repair [&>span]:bg-current",
        order:
          "bg-st-inert-bg text-st-inert ring-1 ring-border ring-inset [&>span]:border [&>span]:border-dashed [&>span]:border-current",
        retired:
          "bg-st-inert-bg text-st-inert [&>span]:border [&>span]:border-current",
      },
    },
    defaultVariants: { tone: "retired" },
  },
);

const STATUS_TONES: Record<
  AssetStatus,
  NonNullable<VariantProps<typeof chipVariants>["tone"]>
> = {
  IN_STOCK: "stock",
  ASSIGNED: "assigned",
  IN_REPAIR: "repair",
  ON_ORDER: "order",
  RETIRED: "retired",
};

export function StatusChip({
  status,
  className,
}: {
  status: AssetStatus;
  className?: string;
}) {
  return (
    <span
      data-testid="status-chip"
      className={cn(chipVariants({ tone: STATUS_TONES[status] }), className)}
    >
      <span aria-hidden="true" />
      {STATUS_LABELS[status]}
    </span>
  );
}
```

- [ ] **Step 5: Run tests and typecheck**

```bash
pnpm vitest run src/components/ui/status-chip.test.tsx && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 6: Red-prove the tailwind-merge guard**

This guard has its own window and needs its own proof — a green suite is not
evidence. Temporarily change the chip's `cn(...)` call to put `className`
FIRST:

```tsx
className={cn(className, chipVariants({ tone: STATUS_TONES[status] }))}
```

Run the third test. If it still passes, the assertion is not defending the
ordering it claims to; strengthen it until it goes red, then restore the
correct order and confirm green. Record the outcome in the commit body.

- [ ] **Step 7: Commit**

```bash
git add src/app/globals.css src/components/ui/status-chip.tsx src/components/ui/status-chip.test.tsx
git commit -m "feat(am-08): add semantic status tokens and StatusChip"
```

---

### Task 3: The `(app)` shell

**Files:**

- Create: `src/app/(app)/layout.tsx`
- Create: `src/components/app-rail.tsx`
- Create: `src/components/app-bar.tsx`
- Move: `src/app/assets/` → `src/app/(app)/assets/`
- Move: `src/app/me/` → `src/app/(app)/me/`
- Move: `src/app/people/` → `src/app/(app)/people/`
- Move: `src/app/admin/` → `src/app/(app)/admin/`
- Move + rewrite: `src/app/page.tsx` → `src/app/(app)/page.tsx`
- Rewrite: `src/app/page.integration.test.tsx` →
  `src/app/(app)/layout.integration.test.tsx`

**Interfaces:**

- Consumes: `<ThemeToggle />` (Task 1).
- Produces: the shell. Task 4 assumes pages no longer render their own
  `<main>` wrapper or link row.

- [ ] **Step 1: Move the routes**

```bash
mkdir -p "src/app/(app)"
git mv src/app/assets "src/app/(app)/assets"
git mv src/app/me "src/app/(app)/me"
git mv src/app/people "src/app/(app)/people"
git mv src/app/admin "src/app/(app)/admin"
git mv src/app/page.tsx "src/app/(app)/page.tsx"
git mv src/app/page.integration.test.tsx "src/app/(app)/layout.integration.test.tsx"
```

Route groups do not appear in URLs, so every path is unchanged and
`src/middleware.ts`'s matcher needs no edit. `src/app/signin/` deliberately
stays outside the group — a signed-out user gets no navigation.

- [ ] **Step 2: Verify no route-group collision**

`src/app/page.tsx` and `src/app/(app)/page.tsx` would BOTH resolve to `/` and
break the build (LEARNINGS §Next.js). The `git mv` above leaves only one.
Confirm:

```bash
ls src/app/page.tsx 2>&1   # expected: No such file or directory
```

- [ ] **Step 3: Build the rail**

`src/components/app-rail.tsx`:

```tsx
import Link from "next/link";
import type { Role } from "@prisma/client";
import { Boxes, LayoutList, Settings2, UserPlus } from "lucide-react";

/**
 * Role-gating here is COSMETIC. It omits doors that would slam — a page's own
 * requireRole is what actually stops anyone. Never let a nav decision be the
 * only thing standing between a role and a route.
 *
 * There is deliberately NO People entry: see the note below the code block.
 */
export function AppRail({ role }: { role: Role }) {
  const showAdmin = role === "ADMIN_IT";

  return (
    <nav
      aria-label="Main"
      className="hidden w-56 shrink-0 flex-col gap-6 border-r p-3 md:flex"
    >
      <div className="flex flex-col gap-0.5">
        <RailLink href="/assets" icon={<Boxes />} label="Register" />
        <RailLink
          href="/me/assignments"
          icon={<LayoutList />}
          label="My assignments"
        />
      </div>

      {showAdmin ? (
        <div className="flex flex-col gap-0.5">
          <span className="text-muted-foreground px-2 pb-1 font-mono text-[0.65rem] tracking-widest uppercase">
            Admin
          </span>
          <RailLink href="/admin/users" icon={<UserPlus />} label="Users" />
          <RailLink
            href="/admin/reference"
            icon={<Settings2 />}
            label="Categories & sites"
          />
        </div>
      ) : null}
    </nav>
  );
}

function RailLink({
  href,
  icon,
  label,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="hover:bg-muted flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm [&_svg]:size-4 [&_svg]:opacity-70"
    >
      {icon}
      {label}
    </Link>
  );
}
```

> **Resolved: no People rail entry.** `/people` has no index route — only
> `/people/[id]`, reached by clicking a holder's name inside the asset detail
> page's `canViewAssignments` branch. Adding an index would mean a new query
> listing `Person` rows, which is a **new PII surface** and would need a
> `personSelectFor(role)` call, a DPA note review, and a Tier 3 advisor
> review — turning a presentation story into a privacy story. AM-08 stays
> Tier 2 and people stay reachable exactly as they are today. If a People
> index is wanted, it is its own story.

- [ ] **Step 4: Build the app bar**

`src/components/app-bar.tsx`:

```tsx
import type { Role } from "@prisma/client";

import { signOut } from "@/auth";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/theme-toggle";

export function AppBar({ name, role }: { name: string; role: Role }) {
  return (
    <header className="flex items-center gap-3 border-b px-4 py-2">
      {/* Search lands in AM-07. The slot exists now so the shell's shape is
          settled; AM-07 inherits the AssetEvent.notes constraint from
          CLAUDE.md and must not surface notes to STAFF_RO. */}
      <div className="text-muted-foreground hidden flex-1 text-sm sm:block">
        Asset Register
      </div>
      <div className="ml-auto flex items-center gap-3">
        <ThemeToggle />
        <span className="hidden text-sm sm:inline">{name}</span>
        <span className="text-muted-foreground rounded border px-1.5 py-0.5 font-mono text-[0.65rem]">
          {role}
        </span>
        <form
          action={async () => {
            "use server";
            // Sign-out mutates the caller's own cookie, not data — the one
            // action that deliberately has no requireRole (any authenticated
            // role may sign out). Lifted verbatim from the old home page.
            await signOut({ redirectTo: "/signin" });
          }}
        >
          <Button type="submit" variant="outline" size="sm">
            Sign out
          </Button>
        </form>
      </div>
    </header>
  );
}
```

- [ ] **Step 5: Write the shell layout**

`src/app/(app)/layout.tsx`:

```tsx
import { requireRole } from "@/lib/authz";
import { getDb } from "@/lib/db";
import { AppBar } from "@/components/app-bar";
import { AppRail } from "@/components/app-rail";

/**
 * The shell — chrome only.
 *
 * Its requireRole covers all four roles and exists to decide which nav items
 * to draw. It is NOT an authorisation boundary and does not protect the pages
 * beneath it: every page and every server action keeps its own requireRole,
 * exactly as before. Deleting a page's requireRole because "the layout checks"
 * is the failure this comment exists to prevent.
 *
 * It does, however, inherit requireRole's deactivation kill-switch, which is
 * what preserves the AM-01 advisor condition after the old home page's
 * hand-rolled check went away — see layout.integration.test.tsx.
 */
export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { userId, role } = await requireRole(
    "ADMIN_IT",
    "PROCUREMENT",
    "FINANCE",
    "STAFF_RO",
  );

  const user = await getDb().user.findUnique({
    where: { id: userId },
    select: { name: true, email: true },
  });

  return (
    <div className="flex min-h-screen">
      <AppRail role={role} />
      <div className="flex min-w-0 flex-1 flex-col">
        <AppBar name={user?.name ?? user?.email ?? "Account"} role={role} />
        <main className="flex flex-1 flex-col gap-6 p-4 pb-20 md:pb-6">
          {children}
        </main>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Reduce the home page to a redirect**

`src/app/(app)/page.tsx` — the register is the home page now; the link hub the
shell replaced has no reason to exist.

```tsx
import { redirect } from "next/navigation";

/**
 * The shell layout above has already run requireRole (which redirects an
 * unauthenticated or deactivated user), so this file needs no guard of its
 * own — it renders nothing and reads nothing.
 */
export default function HomePage() {
  redirect("/assets");
}
```

- [ ] **Step 7: Strip the per-page wrappers**

In each moved page, delete the `<main className="mx-auto ... max-w-5xl ...">`
wrapper and the ad-hoc row of `Home` / nav links, returning a fragment or a
plain `<div>` instead. The shell now owns `<main>`, padding, and width.
Preserve every `requireRole`, every query, and every role-conditional branch
verbatim — extraction is exactly where cross-cutting guards get silently
dropped (LEARNINGS §Frontend). Keep the "Add asset" action link, which is a
page action, not navigation.

Files: `(app)/assets/page.tsx`, `(app)/assets/[id]/page.tsx`,
`(app)/assets/new/page.tsx`, `(app)/me/assignments/page.tsx`,
`(app)/people/[id]/page.tsx`, `(app)/admin/users/page.tsx`,
`(app)/admin/reference/page.tsx`.

- [ ] **Step 8: Retarget the deactivation-gate test**

The advisor condition this test defends did not disappear — it moved from the
home page's hand-rolled check to the shell's `requireRole`. Rewrite
`src/app/(app)/layout.integration.test.tsx` to render the layout instead of the
home page, keeping the existing real-DB harness (`describe.skipIf`,
`migrate deploy`, mocked `@/auth`) exactly as it is. Replace the import and the
subject:

```tsx
import AppLayout from "@/app/(app)/layout";
```

and assert that a user whose `deactivatedAt` is set does not get the shell —
`requireRole` throws `AuthorizationError` for a deactivated user:

```tsx
it("denies a deactivated user holding a valid JWT", async () => {
  mockAuth.mockResolvedValue({ user: { id: deactivatedUserId } });

  await expect(AppLayout({ children: null })).rejects.toThrow(
    AuthorizationError,
  );
});
```

- [ ] **Step 9: Red-prove the deactivation guard in its new home**

Its window changed, so the old proof no longer covers it. Temporarily remove
`user.deactivatedAt !== null` from the condition in `src/lib/authz.ts` and run
the test.

```bash
pnpm vitest run "src/app/(app)/layout.integration.test.tsx"
```

Expected: FAIL. Restore the line and confirm PASS. If it stays green with the
line removed, the test is not reaching the guard and must be rewritten before
this task is done.

- [ ] **Step 10: Full verification**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

All four must pass. The pre-existing integration tests for the register and
`/me/assignments` must be green **without modification** — that is the signal
the shell changed presentation and nothing else.

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "feat(am-08): add the (app) shell with role-gated navigation"
```

---

### Task 4: The register on a phone

**Files:**

- Modify: `src/app/(app)/assets/page.tsx`
- Create: `src/app/(app)/assets/asset-card-list.tsx`
- Modify: `src/components/ui/table.tsx`
- Test: `src/app/(app)/assets/page.integration.test.tsx` (extend)

**Interfaces:**

- Consumes: `<StatusChip>` (Task 2), the shell (Task 3).
- Produces: nothing later tasks depend on.

- [ ] **Step 1: Hide the table below `md`**

In `src/components/ui/table.tsx`, the wrapper keeps `overflow-x-auto` for
desktop. Add the breakpoint at the register's call site, not in the primitive
— other tables (admin users, event history) may want different behaviour.

- [ ] **Step 2: Write the failing test**

Extend `src/app/(app)/assets/page.integration.test.tsx`. The second case is the
guard that matters: the card list is a **second** render path for holder data,
and a role-conditional that was correct in the table can be missing from the
cards.

```tsx
it("renders both shapes from one fetch for a privileged viewer", async () => {
  mockAuth.mockResolvedValue({ user: { id: adminUserId } });

  const page = await AssetsPage({ searchParams: Promise.resolve({}) });
  render(page);

  // Both exist in the DOM; Tailwind breakpoints choose. jsdom has no layout,
  // so asserting visibility here would assert nothing (LEARNINGS §Testing).
  expect(screen.getByTestId("asset-table")).toBeInTheDocument();
  expect(screen.getByTestId("asset-card-list")).toBeInTheDocument();
});

it("shows no holder in EITHER shape for STAFF_RO", async () => {
  mockAuth.mockResolvedValue({ user: { id: staffUserId } });

  const page = await AssetsPage({ searchParams: Promise.resolve({}) });
  render(page);

  expect(screen.queryByText("Held by")).not.toBeInTheDocument();
  expect(screen.queryByText(holderName)).not.toBeInTheDocument();
  expect(document.querySelectorAll('a[href^="/people/"]')).toHaveLength(0);
});
```

- [ ] **Step 3: Run and watch it fail**

```bash
pnpm vitest run "src/app/(app)/assets/page.integration.test.tsx"
```

Expected: FAIL — no `asset-card-list` testid.

- [ ] **Step 4: Extract the card list**

`src/app/(app)/assets/asset-card-list.tsx`. It takes the SAME rows the table
renders and the same `canSeeHolders` flag — one fetch, two shapes. It must
never fetch anything itself.

```tsx
import Link from "next/link";
import type { AssetStatus } from "@prisma/client";

import { StatusChip } from "@/components/ui/status-chip";

export type AssetRow = {
  id: string;
  tag: string | null;
  make: string;
  model: string;
  status: AssetStatus;
  categoryName: string;
  siteName: string | null;
  holder: { id: string; name: string } | null;
};

/**
 * The phone shape of the register (AM-06). Same rows as the table, chosen by
 * breakpoint — never by a media-query hook, which would make this a client
 * component and re-fetch nothing usefully.
 *
 * `holder` is null for STAFF_RO because the page never fetched it. This
 * component renders what it is given; it is not where the privacy rule lives.
 */
export function AssetCardList({ assets }: { assets: AssetRow[] }) {
  return (
    <ul data-testid="asset-card-list" className="flex flex-col gap-2 md:hidden">
      {assets.map((asset) => (
        <li key={asset.id} className="rounded-lg border p-3">
          <Link href={`/assets/${asset.id}`} className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              {/* The tag is the headline: looking one up is the entire reason
                  someone opens this away from a desk. */}
              {asset.tag ? (
                <span className="font-mono text-sm font-medium tabular-nums">
                  {asset.tag}
                </span>
              ) : (
                <span className="text-muted-foreground rounded border border-dashed px-1.5 font-mono text-xs">
                  no tag
                </span>
              )}
              <StatusChip status={asset.status} />
            </div>
            <span className="text-sm">
              {asset.make} {asset.model}
            </span>
            <span className="text-muted-foreground text-xs">
              {[asset.holder?.name, asset.siteName, asset.categoryName]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 5: Wire it into the register**

In `src/app/(app)/assets/page.tsx`: keep the existing query and the
`canSeeHolders` branch exactly as they are — **do not touch the holder fetch**.
Map the rows once into `AssetRow[]`, then render the table wrapped in
`<div className="hidden md:block">` with `data-testid="asset-table"`, followed
by `<AssetCardList assets={rows} />`. Swap the table's status cell to
`<StatusChip status={asset.status} />` and set the tag cell to
`font-mono tabular-nums`.

- [ ] **Step 6: Run tests and typecheck**

```bash
pnpm vitest run "src/app/(app)/assets/page.integration.test.tsx" && pnpm typecheck
```

Expected: PASS.

- [ ] **Step 7: Red-prove the STAFF_RO card guard**

Its own window, its own proof. Temporarily hard-code `holder` into the row
mapping regardless of `canSeeHolders`:

```tsx
holder: holderByAsset.get(asset.id) ?? null,  // drop the canSeeHolders check
```

Run the STAFF_RO test. Expected: FAIL on the holder name assertion. Restore
and confirm PASS. If it stays green, the fixture has no assigned asset visible
to that viewer and the test is vacuous — fix the fixture first.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(am-08): render the register as cards below md"
```

---

### Task 5: Bottom tab bar

**Files:**

- Create: `src/components/app-tabbar.tsx`
- Modify: `src/app/(app)/layout.tsx`
- Test: `src/components/app-tabbar.test.tsx`

**Interfaces:**

- Consumes: the shell (Task 3).

- [ ] **Step 1: Write the failing test**

```tsx
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AppTabBar } from "@/components/app-tabbar";

describe("AppTabBar", () => {
  it("offers Add to a role that can write", () => {
    render(<AppTabBar role="ADMIN_IT" />);
    expect(screen.getByRole("link", { name: /add/i })).toBeInTheDocument();
  });

  it("omits Add for a read-only role", () => {
    render(<AppTabBar role="STAFF_RO" />);
    expect(screen.queryByRole("link", { name: /add/i })).toBeNull();
  });

  it("still offers the two universal destinations to STAFF_RO", () => {
    render(<AppTabBar role="STAFF_RO" />);
    expect(screen.getByRole("link", { name: /register/i })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /mine/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run and watch it fail**

```bash
pnpm vitest run src/components/app-tabbar.test.tsx
```

Expected: FAIL — unresolved import.

- [ ] **Step 3: Implement**

`src/components/app-tabbar.tsx`. Destinations sit in thumb reach; a hamburger
drawer would bury all of them behind a tap in the hardest corner of the screen
to reach one-handed. Same cosmetic-only role gating as the rail.

Two or three tabs, not four: People is out (no index route — see Task 3), and
Account is out (the app bar already carries the user chip and Sign out, and it
is visible at every width). Adding routes to fill a grid is how dead nav gets
shipped.

```tsx
import Link from "next/link";
import type { Role } from "@prisma/client";
import { Boxes, LayoutList, Plus } from "lucide-react";

export function AppTabBar({ role }: { role: Role }) {
  // Mirrors the register's own canWrite. STAFF_RO and FINANCE cannot create
  // assets, so offering them the door is a dead end, not a security hole —
  // /assets/new's requireRole is what refuses.
  const canWrite = role === "ADMIN_IT" || role === "PROCUREMENT";

  return (
    <nav
      aria-label="Main"
      className={`bg-background fixed inset-x-0 bottom-0 grid border-t md:hidden ${
        canWrite ? "grid-cols-3" : "grid-cols-2"
      }`}
    >
      <Tab href="/assets" icon={<Boxes />} label="Register" />
      <Tab href="/me/assignments" icon={<LayoutList />} label="Mine" />
      {canWrite ? <Tab href="/assets/new" icon={<Plus />} label="Add" /> : null}
    </nav>
  );
}

function Tab({
  href,
  icon,
  label,
}: {
  href: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <Link
      href={href}
      className="text-muted-foreground flex flex-col items-center gap-1 py-2 text-[0.65rem] [&_svg]:size-[17px]"
    >
      {icon}
      {label}
    </Link>
  );
}
```

> **Resolved: three tabs for write roles, two for the rest.** Every
> destination points at a route that already exists and that the viewer is
> allowed to reach.

- [ ] **Step 4: Mount it in the shell**

Add `<AppTabBar role={role} />` at the end of the layout's outer `<div>`. The
layout's `<main>` already carries `pb-20 md:pb-6` so the bar never covers the
last row.

- [ ] **Step 5: Verify**

```bash
pnpm lint && pnpm typecheck && pnpm test && pnpm build
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(am-08): add the mobile bottom tab bar"
```

---

## Deferred, deliberately

- **Global search behaviour** — AM-07. The bar has the slot; the search must
  exclude `AssetEvent.notes` from `STAFF_RO` reach or close that hole first
  (`CLAUDE.md`).
- **Offline indicator** — AM-06. The shell has the layout room; nothing is
  wired.
- **Lifecycle rail on the asset detail page** — drawn in the mockup, worth its
  own task once the shell lands, since it renders `ASSET_TRANSITIONS` and
  changes how `lifecycle-actions.tsx` presents choices.
- **Density toggle** — until someone runs a register large enough to ask.

## Self-review notes

- **Spec coverage:** §2 → Task 1; §3 → Task 1 Step 1; §4 → Task 3; §5 → Tasks
  4 and 5; §6 → Task 2; §7 → Tasks 2 and 4 (mono tags, tabular figures).
- **Both open questions resolved** (Task 3 Step 3, Task 5 Step 3), each by
  declining to add a route rather than by inventing one. The People index in
  particular would have made AM-08 a Tier 3 story: a new `Person` listing is a
  new PII surface, and this story is presentation only.
- **Every nav destination points at an existing route** the viewer may reach.
  No link in this plan 404s or lands on an `AuthorizationError`.
