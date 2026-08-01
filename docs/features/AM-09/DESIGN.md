# AM-09 — Production-grade UI pass

- **Date:** 2026-08-01
- **Tier:** T3 (deletion-path UI: the Retire and Deactivate confirmations)
- **Branch:** `feat/am-09-ui-pass`
- **Mockups:** the AM-09 UI pass artifact — interactive prototypes of every
  surface below, built against the same 402-asset dataset the dev database
  holds.
- **Deferred out of scope:** [#7](https://github.com/App-Artery/asset-mgt/issues/7)
  register search, [#8](https://github.com/App-Artery/asset-mgt/issues/8)
  pagination.

---

## 1. The diagnosis

Measured on the running app against 402 seeded assets. Each of these is
defensible alone; together they are one habit — **every control that might be
needed is showing, all the time.** The page is built as a form that happens to
contain data, rather than data that can be acted on.

| Surface                | Measured                                                                                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Register               | 402 rows on load — 15,965px of scroll, 10,481 DOM nodes. No sort. Filtering is three selects and a submit button. Default order is `createdAt desc`, which puts a retired UPS first. |
| Asset page             | 1,856px single column on a 1,440px screen. Two lifecycle forms and a ten-field edit form, all permanently expanded. Six of eleven fields render as `—`.                              |
| Users                  | A destructive button on every row. Role changes need a per-row Apply. Roles read `ADMIN_IT`, `STAFF_RO`.                                                                             |
| Categories &amp; sites | 22 always-open text inputs, each pre-filled with the name shown immediately to its left, for a rename done twice a year. The counts — the useful data — are inert text.              |

Vocabulary leaks the database everywhere: status says "In repair" while
condition, role and event type shout their enums in the next column.

## 2. Scope

Presentation only. **No query is changed, no authorisation surface moves, no
migration.** The role-conditional holder fetch in the register stays exactly as
written, including the deliberate absence of a `canSeeHolders ?` in the row
mapping.

In:

1. Label maps for `AssetCondition`, `Role`, `AssetEventType`.
2. Register: proportional status bar as the filter, sortable columns, sticky
   header, RETIRED rows recede.
3. Asset page: custody card, details behind an Edit toggle, history as a
   timeline, lifecycle forms into a menu + focused dialogs.
4. Users: humanised roles, `Deactivate` behind a row menu and a confirm dialog.
5. Categories &amp; sites: two columns, counts link to the filtered register,
   rename retreats to a per-row action.

Out: search (#7), pagination (#8), "Last signed in" (needs a column that does
not exist — sessions are JWT, so there are no session rows to read), and the
split-view detail pane, which is a later story once assign/return volume
justifies it.

## 3. The five rules

Every change below is an application of one of these.

1. **Data first, controls one step away.** A page opens showing what is true.
   Editing is a mode; adding is a dialog; renaming appears on the row you point
   at. Nothing that mutates is expanded by default.
2. **Red is for confirming, never for offering.** Destructive colour appears
   only on the confirm button inside a dialog that explains the consequence.
3. **One vocabulary.** Every enum gets a human label in exactly one place, the
   way `STATUS_LABELS` already does for status. Sentence case, same word in the
   table as in the form as in the message.
4. **Nothing is deleted, so show things receding.** Retired assets, deactivated
   users and unused categories keep their row at muted ink. The register's whole
   thesis, expressed as a text colour.
5. **Every count is a link.** "112 laptops" routes to the register filtered to
   exactly that set.

## 4. Surface specs

### 4.1 Vocabulary (`src/lib/asset-lifecycle.ts`, `src/lib/roles.ts`)

`CONDITION_LABELS` joins `STATUS_LABELS` in `asset-lifecycle.ts` — client-safe,
type-only Prisma import. `ROLE_LABELS` goes in a new client-safe `src/lib/roles.ts`
rather than into `authz.ts`, which is `server-only`. `EVENT_TYPE_LABELS` sits
beside the asset history that consumes it.

Each is typed `Record<Enum, string>`, so a new enum member fails the build
rather than rendering raw.

**The trap this closes.** `CONDITION_OPTIONS` (`asset-form.tsx`) and
`ROLE_OPTIONS` (`add-user-form.tsx`) are hand-maintained string tuples, not
derived from the Prisma enums — a second source of truth that diverges silently.
Set-equality tests pin each tuple to its label map's keys (LEARNINGS §Process:
"vocabulary changes need a codebase audit"; a one-line set-equality test
prevents the next divergence).

### 4.2 Register (`src/app/(app)/assets/page.tsx`)

- **The estate bar.** The three-select-plus-submit filter row loses its status
  select; status becomes a proportional band above labelled chips carrying the
  counts. Same `?status=` param, still a plain GET, still a server component —
  each chip is a link, not a client control. Category and site stay as selects.
- **Sort** via `?sort=&dir=`, headers as links. Default becomes `tag asc`;
  `createdAt desc` answers no question an operator asks.
- **Sticky header**, and RETIRED rows drop to muted ink — including their
  condition, which must not stay amber on dead kit.
- Condition renders through `CONDITION_LABELS`.

**Boundary schema.** `filterSchema` gains `sort` and `dir` as enums. Zod
`.object()` strips unknown keys silently, so a param added to the UI and the
where-builder but not the schema is dropped with no error. `safeParse` stays —
a malformed shared link renders the default register, never a 500.

**Colour constraint on the bar.** The five `--st-*` tokens are tuned for 6px
dots on labelled chips. Run through the palette validator they fail as adjacent
fills: green↔amber ΔE 4.5 under protanopia, grey↔amber 11.8 for normal vision,
and `ON_ORDER`/`RETIRED` share `--st-inert` by design. So the band carries
**proportion only** — identity lives in the labelled chips beneath it, segments
are separated by a 2px gap, and `ON_ORDER` is differentiated by a 135° hatch
rather than a hue, matching the chip's existing dashed-dot rule. In dark mode the
fills step down to the `--st-*-bg` values (L≈0.32); the bright L≈0.8 tokens
would glow across a full-width band.

### 4.3 Asset page (`src/app/(app)/assets/[id]/`)

Order becomes: breadcrumb → tag + status + primary action → two columns
(custody, details, purchase | history timeline).

- **Custody card.** `Held by` leaves the field grid and becomes the page's
  second element. It is the answer to the question the page exists for, and it
  was field eleven of eleven.
- **Details and Purchase** group the remaining fields; empty optionals read
  `Not recorded`, so a blank is missing data rather than a rendering accident.
- **Edit** is a toggle, not a permanently open form. Every field it has today it
  keeps.
- **History** becomes a timeline: `EVENT_TYPE_LABELS`, relative time visible with
  the exact UTC timestamp on hover — "8 months ago" is what a human checks,
  `2026-08-01 21:21 UTC` is what an auditor needs, in that order.
- **Lifecycle actions** move from always-expanded stacked forms into a primary
  button plus a `More` menu; each form opens in a focused dialog. `EventNoteHint`
  travels with every field that writes `AssetEvent.notes` — unchanged copy,
  unchanged placement relative to its input.

### 4.4 Users (`src/app/(app)/admin/users/`)

Roles render through `ROLE_LABELS` in the table, the picker and the app-bar chip.
`Deactivate` leaves the row and moves into a `⋯` menu behind a confirm dialog;
deactivated users recede and offer `Reactivate`. `Add user` becomes a dialog.

### 4.5 Categories &amp; sites (`src/app/(app)/admin/reference/`)

Two columns instead of two stacked tables. Each row is name, count, magnitude
track; the count links to `/assets?categoryId=…`. Rename becomes a per-row
action revealed on hover and focus — and, because hover is invisible to touch,
present permanently below `md:`. The "renamed, never removed" explanation stays,
demoted to a one-line note under the heading: it is a rule you need at the moment
you go looking for a delete button, which is the moment you reach for the row.

## 5. Destructive confirmations — the T3 element

This is the only part of the pass that is not purely cosmetic, and it is why the
story carries the tier.

**What exists today.** Retire guards with `window.confirm` on submit
(`lifecycle-actions.tsx:237`). Deactivate guards with `window.confirm` **only
when deactivating yourself** (`users-table.tsx:122`) — deactivating anyone else
is one unguarded click. Role self-demotion has its own separate `window.confirm`
(`users-table.tsx:78`).

**What replaces it.** A Radix dialog — the first in the tree; `@radix-ui/react-slot`
is the only Radix dependency today. The dialog carries the explanation, the
reason field where one exists, and the destructive button.

**The failure this must not have.** LEARNINGS §Frontend: "lift-verbatim drops
cross-cutting guards" — extracting a component silently loses behaviours that
were correct in the source but never enumerated as acceptance criteria. The three
existing guards are exactly that kind of behaviour. Each one is enumerated here,
and each gets a test:

| Guard today                          | Must still hold                                       |
| ------------------------------------ | ----------------------------------------------------- |
| Retire always confirms               | Retire cannot submit without an explicit confirm      |
| Self-deactivation confirms           | Distinct copy: you are signing yourself out           |
| Self-demotion from ADMIN_IT confirms | Distinct copy: you lose this screen immediately       |
| Deactivating another user            | **New** — currently unguarded; gains the same confirm |

Server actions are unchanged; `await requireRole(...)` remains the first
statement of each. The dialog is UX. The server guard is the enforcement.

## 6. Verification

Kelvin's standing requirement for this story: **built components must match the
mockups.** So fidelity is a verification step, not a hope.

- **Per surface:** screenshot the built page with Playwright at 1440 and 390,
  light and dark, and compare against the corresponding mockup frame. Differences
  are either fixed or recorded here with a reason.
- **Real-DB integration tests** stay green untouched wherever they assert
  behaviour rather than markup — that is the signal this pass changed
  presentation and nothing else. `page.integration.test.tsx` and
  `me/assignments/page.integration.test.tsx` are the two that matter.
- **New tests:** the set-equality vocabulary tests (§4.1), the four confirmation
  guards (§5), and a register test that sort and status params round-trip
  through the boundary schema.
- **Unchanged and asserted:** the `STAFF_RO` register renders no holder column
  and no `/people/` link.
- Full suite plus env-free build in CI.

## 7. Advisor conditions — NOT OBTAINED, and what was held back because of it

The advisor was engaged at the start of this story and asked four times for a
ruling on §5. It signalled idle four times without returning one. No ruling
exists, so **§5 was not built.**

What that means concretely:

- `Retire` keeps its existing `window.confirm` (`lifecycle-actions.tsx:237`).
- `Deactivate` keeps its existing behaviour, which means deactivating **another
  user is still one unguarded click** — the gap §5 was written to close.
- The lifecycle forms were relocated into the new asset-page layout **unchanged**,
  so no guard was reimplemented and none could be lost in transit.

Everything that shipped is presentation over unchanged queries and unchanged
server actions. `await requireRole(...)` is still the first statement of every
mutating action; `personSelectFor` and `canViewAssignments` are untouched; the
register's role-conditional holder fetch is byte-identical.

**To finish this story someone must either** obtain the ruling and build §5, or
record a decision to proceed on the four enumerated guards in §5 without one.
Until then the unguarded deactivation stands, and it should not be forgotten
because the rest of the pass landed.

## 8. What shipped

| §   | Change                                   | State                                  |
| --- | ---------------------------------------- | -------------------------------------- |
| 4.1 | Vocabulary + one source of truth         | shipped                                |
| 4.2 | Register: estate bar, sort, sticky       | shipped                                |
| 4.3 | Asset page: custody, timeline, edit mode | shipped, minus the dialogs (§5)        |
| 4.4 | Users: role labels                       | shipped; `Deactivate` dialog held (§5) |
| 4.5 | Categories &amp; sites                   | shipped                                |
| 5   | Destructive confirmations                | **not built — no advisor ruling**      |
| —   | Search, pagination                       | deferred: #7, #8                       |
| —   | "Last signed in"                         | deferred: needs a column               |

Verification actually performed: full suite (280 tests) green against real
Postgres; typecheck; lint; production build; every surface screenshotted at 1440
and 390 against its mockup frame. Three new guards were proven red against their
own window — and two of them failed that proof on the first attempt and were
rewritten, which is the third recurrence in this project of "the guard I proved
is not the guard I meant" (LEARNINGS §Testing).
