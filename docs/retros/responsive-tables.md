# Retro — Responsive tables (one shape per width, one vocabulary above)

- **Merged:** PR #25 — 2026-08-03, squashed as `98d202d`. 26 files, +1749/−557. CI green before merge and after; `main` green.
- **Tier:** 2. Not security-touching, and the whole basis of that call was one constraint: no Prisma `select`/`where`, no role gate and no `personSelectFor` call changed anywhere on the branch. Checked as an executable step (a grep over `main...HEAD`), not asserted, and verified independently by the reviewer.
- **Path:** brainstorm → spec → 9-task plan → implement in the main thread → `reviewer` (APPROVE WITH NITS, 9 findings, all fixed) → browser validation at 390/1440 → 3 more fixes → merge.

## What shipped

Every table in the app now renders a `<table>` at `md:` and a stacked card list below, from one query and one mapped array. Four of the five had no phone shape at all; only `/assets` did (AM-06).

`ResponsiveTable` owns the breakpoint pair in one file and takes a **required `cards` prop**, so a table added later cannot ship without a phone shape — it will not typecheck. `sticky` and `containerClassName` are a prop union for the same reason: `sticky` alone was a silent no-op, and is now a compile error. Card bodies come from new `DataCard*` primitives; the three assignment tables collapse into one `AssignmentCardList`.

Riding along: `StatusChip` everywhere status is shown, one `AssetTagLink`, one `Timestamp` (replacing three byte-identical local `formatTimestamp` copies), one `SectionHeading`, and sticky headers on the two unbounded tables.

## What surprised us

1. **The plan's code was not verified code, and it took two goes to remember that.** The plan's first test queried `getByTestId("table-container")` when the primitive marks that div with `data-slot`. Caught in seconds. Later the plan's `renderTable(Partial<Props>)` helper stopped compiling the moment `sticky`/`containerClassName` became a union — which was the union working as designed, but it still meant editing a helper the plan had specified as final. A plan is a specification of intent; every code block in it is a draft.

2. **A `//` comment in JSX children became rendered page text.** Written between a `<p>` and a component inside a fragment, prettier reflowed it into visible content — `// Unbounded and sitting below other content, so it gets a scroll //` would have shipped to the screen. `react/jsx-no-comment-textnodes` caught it at pre-commit, which is the system working; what is worth remembering is that the reasoning was sound (`//` IS valid in an expression position) and simply wrong about which position the comment was in.

3. **`pnpm lint | tail -2` masked eslint's exit code for several commits.** A pipeline returns the status of its _last_ command, so `pnpm lint | tail && pnpm typecheck && git commit` proceeded through a failing lint. It only surfaced because the pre-commit hook independently caught the JSX comment above and reverted the commit. Every "verified clean" claim made through a pipe in this delivery was worth exactly nothing.

4. **The reviewer found a parity guard that could not fail — the seventh recurrence of that shape here.** `expect(html.split(email).length - 1).toBeGreaterThanOrEqual(2)` was green with the card list deleted entirely, because the table alone supplies two occurrences (the Email cell and the role select's `aria-label`), and `ResponsiveTable` renders the cards wrapper unconditionally so the testid assertion was green with an empty list too. Fixed to `toBe(4)` and red-proven. The guard was written by the same person, in the same hour, as the code it defends — exactly the shape LEARNINGS §Testing already describes.

5. **Adding a second render shape silently narrowed six existing tests.** `rowFor(html, email)` slices from the first match to the next `</tr>`. That was "the row, not the page" when there was one shape; with a card list added it became "the table, and only the table" — so the card's copy of `SignInCell` could be deleted or wired to the wrong field with all six sign-in tests staying green. Nothing in the diff to `rowFor` would have shown this, because there was no diff to `rowFor`.

6. **Two "one component" claims were false at the moment they were written.** `Timestamp` shipped with **zero** production call sites for its relative variant — all 11 uses passed `exact`, so half the component was reachable only from its own test, and the three hand-rolled `<time>` blocks it existed to replace were still there. `SectionHeading` left **six** copies of its own class string, five of them on `/assets/[id]` — the page that defines the treatment was the one page not consuming the primitive. Both were written in a spec that said "`/assets/[id]` already uses it", which was true of the _treatment_ and false of the _component_.

7. **Driving the app in a real browser found three defects that 465 passing tests could not.** jsdom applies no CSS, so the suite could only ever prove both shapes exist in the markup — never that exactly one is painted. One overflow was ours (timestamps wrapping mid-value, stranding a bare "UTC"); two predated the branch and made the page scroll sideways on a phone, which is the exact complaint the work existed to fix. The `/people/[id]` one is the instructive one: **nothing was positioned off-screen** — every element's `right` was ≤ 390 — and only `document.scrollWidth` reporting 395 gave it away.

8. **The local test database has accumulated 26,251 users and wedged the browser.** `/admin/users` has no pagination, so it renders every user, now in two shapes. Irrelevant at production scale (dozens) and entirely a fixture-accumulation artefact — but it cost a browser restart and a dev-server restart to diagnose, and the first instinct ("my change made this slow") was wrong.

## What we'd do differently

- **Never pipe a verification command into anything.** `set -o pipefail`, or just run it bare and read the exit code. Three commits claimed a clean lint that had not been checked.
- **When adding a second render shape, audit the test helpers that scope by position.** Any `indexOf`/slice-to-next-delimiter helper silently narrows to whichever shape renders first.
- **Finish a consolidation by grepping for the treatment, not the component name.** `grep -c 'text-xs font-medium tracking-wide uppercase'` is the check that would have caught six survivors; `grep SectionHeading` reports success.
- **Budget a real-browser pass for any responsive or layout work, and measure `document.scrollWidth`, not element rects.** The rects were all in-bounds on the page that overflowed.
- **The new parity guards are not in mutation scope.** `stryker.config.mjs` covers five guard-bearing modules; `ResponsiveTable` and the per-page parity assertions are not among them. That is the mechanised answer to finding 4 and it does not currently cover the thing finding 4 happened to.
