# AM-03 Implementation Plan — Assignment and Returns

**Tier: T3.** Design and advisor ruling: [`DESIGN.md`](./DESIGN.md) (APPROVE WITH CONDITIONS,
18 conditions). Kelvin approved the design on 2026-07-30, taking both recommended options:

- **`STAFF_RO` sees no person data at all** outside their own `/me/assignments` (DESIGN §2.1).
- **Assign/return is `ADMIN_IT` + `PROCUREMENT`**, consistent with every other write action
  (DESIGN §2.2).

Branch: `feat/am-03`. **A second advisor security review on the diff is required before
merge**, as AM-01 had.

## Sequencing

Tasks 1–4 are a hard chain — each needs the previous one's types. Tasks 5, 6 and 7 are
independent workstreams dispatched as parallel `engineer` subagents on the same branch with
sequenced commits. Task 7 (docs) touches no code and is dispatched early, alongside task 3.
One conventional commit per task.

```
1 schema ──> 2 write layer ──> 3 actions ──> ┌─ 5 asset UI
                                             ├─ 6 person views
                    (dispatched with 3) ─────┴─ 7 docs
```

> ⚠️ `.env` holds the **production** `DATABASE_URL` and the Prisma CLI autoloads it (AM-01
> retro §5, LEARNINGS §Prisma). **Every** local DB command in this story explicitly overrides
> `DATABASE_URL` to the Docker Postgres URL. No bare `pnpm db:migrate`.

---

### 1. Schema + migration — `am03_assignment` (main thread)

`prisma/schema.prisma`:

- `AssetEvent.assignmentId String?` + relation to `Assignment`, `onDelete: Restrict`
  (consistent with `actorId`). Reverse relation `Assignment.events AssetEvent[]`.
- `@@index([personId, returnedAt])` on `Assignment` — the per-person view's query
  ("everything X currently holds") and AM-07's search both filter on exactly this pair.

Hand-written into the generated migration SQL, with a preserved comment block explaining why
(Prisma expresses neither):

```sql
CREATE UNIQUE INDEX "Assignment_one_open_per_asset"
  ON "Assignment"("assetId") WHERE "returnedAt" IS NULL;

ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_returned_after_checkout"
  CHECK ("returnedAt" IS NULL OR "returnedAt" >= "checkedOutAt");
```

The **partial** predicate is load-bearing — a plain `UNIQUE("assetId")` makes every asset
permanently unassignable after its first return, and passes the naive test. Conditions 1, 7, 14.

### 2. Write layer — `src/lib/asset-admin.ts` + `src/lib/person-visibility.ts` (main thread)

The crown jewels; highest concurrency risk in the codebase.

**Refactor (condition 2):** extract `transitionAssetStatusTx(tx, input)` holding lock →
guard → tag check → update → event. `transitionAssetStatus(db, input, testHooks)` becomes a
thin `$transaction` wrapper with an unchanged public signature. **No function accepts
`PrismaClient | TransactionClient`** — an implicit transaction boundary at the call site is
how a caller ends up silently outside one. The core takes the **event type as a parameter**
(default `STATUS_CHANGED`), without which the refactor mechanically emits two events.

**New:**

- `assignAsset(db, { assetId, personId, notes, actorId })` — own `$transaction`:
  `lockAsset` **first**, reject if the person's linked `User` is deactivated, create the
  `Assignment`, call the core with `toStatus: ASSIGNED` and event type `ASSIGNED` carrying
  `assignmentId`.
- `returnAsset(db, { assetId, toStatus, condition, conditionNotes, actorId })` where
  `toStatus ∈ {IN_STOCK, IN_REPAIR}` — `lockAsset` first, close the open assignment via
  `updateMany({ where: { id, returnedAt: null } })` asserting `count === 1` (condition 13),
  then the core with event type `RETURNED`.
- **Every transition out of `ASSIGNED` closes the open assignment in the same transaction**
  (condition 5) — so `sendToRepair` and `retireAsset` on an assigned asset close it and emit
  a single `RETURNED` event. Implemented once inside the tx core, not per-caller.
- **Import seam (binding carry-forward, DESIGN §8):** the assignment insert is structured so
  AM-04 can create an open `Assignment` with a historical `checkedOutAt` **without passing
  through the lifecycle guard**. Do not rebuild AM-02's `INITIAL_ASSET_STATUSES` trap.

**Lock ordering is uniform and absolute (condition 3):** every path that writes an
`Assignment` takes the Asset row lock **first**. Asset→Assignment in one path and
Assignment→Asset in another is a deadlock cycle; under Neon those are intermittent production
failures.

`src/lib/person-visibility.ts` — `personSelectFor(role)`, **the only place in the codebase a
`Person` select is written** (condition 8), implementing DESIGN §5.2: name for all roles
(`STAFF_RO` own only), `employeeRef` for the three privileged roles, `email` for `ADMIN_IT`
alone. Enforced in the Prisma `select`, never in JSX.

**Tests — `src/lib/asset-admin.integration.test.ts` (condition 6).** Reuse the barrier seam
at line 280. Four concurrency tests, in this order:

1. **Designated lock proof: concurrent `assignAsset` + `sendToRepair`.** No index
   involvement, so nothing masks a missing lock. **Report empirically red with `FOR UPDATE`
   deleted — a claim is not a report.**
2. **Concurrent double-assign** → loser fails with **`IllegalTransitionError`, never P2002**.
   ⚠️ "one of them failed" stays green with the lock removed because the index catches it —
   AM-01's race-passing-on-luck, with the index as the mask.
3. **Index at the DB layer, app bypassed** (raw SQL second open assignment → 23505) **plus
   its twin: after a return, a second assignment succeeds.** Without the twin a non-partial
   unique passes.
4. **Concurrent double-return** → exactly one succeeds, exactly one `RETURNED` event,
   `returnedAt`/`conditionNotes` still hold the **first** return's values.

Plus: reconciliation query returns zero rows both directions; deactivated-`User` person
rejected; no-`User` person assignable; retiring an assigned asset emits exactly one
`RETURNED` event (condition 4); `ASSIGNED`/`RETURNED` events carry `assignmentId`.

### 3. Server actions — `src/app/assets/actions.ts`, `src/lib/asset-errors.ts` (main thread)

`await requireRole("ADMIN_IT", "PROCUREMENT")` as the **first statement** of `assignAsset` and
`returnAsset`, no exceptions. Zod boundary schemas follow the existing file: `.preprocess`
before validation, `""` → `null`. Condition mandatory on return; `conditionNotes` mandatory
for repair-bound returns and for `POOR`/`DEFECTIVE`, optional otherwise (DESIGN §4.4).

`mapAssetError` gains the open-assignment unique violation → friendly message. Match on the
**constraint name**, never SQLSTATE — the client's tags are numeric and Prisma echoes values
into messages, the exact trap documented in `asset-errors.ts`.

`revalidatePath` covers `/people/[id]` and `/me/assignments` alongside `/assets` and
`/assets/[id]` (condition 18) — and runs **outside** the transaction (condition 17).

Role-matrix integration tests in `src/app/assets/actions.integration.test.ts`.

### 4. Verification gate before fan-out (main thread)

`pnpm lint`, `pnpm typecheck`, `pnpm test` with `TEST_DATABASE_URL` set. The UI tasks build on
these types; dispatching them over a broken core wastes both.

### 5. Asset UI — parallel `engineer`

- `src/app/assets/[id]/page.tsx`: current holder + assign/return forms for write roles;
  holder history for the three privileged roles. **Assignment and person data is not
  fetched at all for a `STAFF_RO` viewer** — role-conditional at the query, not in JSX
  (condition 9).
- **Close the actor-email leak** at lines 81 and 192 (condition 11): `email` selected for
  `ADMIN_IT` only; for `STAFF_RO` the actor is not selected and the "Who" column renders a
  neutral label. Status history stays visible to staff; no person appears on it.
- Register holder column for privileged roles only, same query-level rule.
- Assign/return client forms alongside `lifecycle-actions.tsx`; person picker over existing
  `Person` rows showing name + `employeeRef`.
- Test asserts **the query result** contains no person data for `STAFF_RO`, not the rendered
  HTML.

### 6. Person views — parallel `engineer`

- `/me/assignments` — all four roles; person derived server-side from
  `session.user.id → User.personId`. **Reads no person identifier from params, searchParams,
  or form data** (condition 10). `personId === null` is an empty state, not a 500.
- `/people/[id]` — `requireRole("ADMIN_IT", "PROCUREMENT", "FINANCE")`; everything the person
  currently holds plus past assignments; deactivated marker (condition 12). Fields via
  `personSelectFor`.
- Home page links, role-conditional.

### 7. Docs — parallel `engineer` (dispatched early, with task 3)

- `CLAUDE.md` (condition 15): the `Assignment` mutability rule verbatim from DESIGN §3.4, the
  one-event-per-action rule, `STAFF_RO`-sees-no-person-data, no-PII-in-`AssetEvent.notes`.
- `docs/DPA-TRANSFER-NOTE.md` (condition 16): one line recording the role-based visibility
  tiers as the technical measure implementing the minimisation claim. Stored fields do not
  change — no new transfer — but the note's own "review if scope changes" clause is triggered
  by the display change.
- README: the reconciliation query as a runbook query (DESIGN §3.2).

---

## Verification

**T3 — full local suite**, not just targeted. Commands each with an explicit `DATABASE_URL`
override: `pnpm lint`, `pnpm typecheck`, `pnpm test` with `TEST_DATABASE_URL` set, and
`pnpm build` with **zero env populated** (the env-chokepoint invariant CI proves every run).

**Falsifiability gate (condition 6, LEARNINGS §Testing):** the designated lock proof must be
reported red-with-`FOR UPDATE`-deleted **empirically**, with the output. AM-01's headline
lesson was a race test that passed with the lock removed; AM-02's was a constraint proven red
for `NULL` but not for `''`. Both were "the guard I wrote isn't the invariant I meant".

**End-to-end smoke** against local Docker Postgres: seed → sign in as `ADMIN_IT` → assign an
`IN_STOCK` asset → confirm a second assign is rejected → return it `GOOD` to stock → assign
again (proves the partial predicate) → send an assigned asset to repair and confirm one
`RETURNED` event with `ASSIGNED → IN_REPAIR` → check `/people/[id]` and `/me/assignments` →
**sign in as `STAFF_RO` and confirm no holder, no history person data, no actor email**.

**Gates:** `reviewer` subagent on the full diff against the ACs, this plan and the 18
conditions → **advisor security review on the diff** (mandatory, T3) → PR → CI full suite.
Blocking findings route back through the fix path; the same finding blocking twice is an
impasse for Kelvin, not a loop.

**Escalation triggers → stop, tell Kelvin:** a requirement to widen `STAFF_RO` visibility
(DPA note review, not a code change); any need to write personal data into `AssetEvent`; a
Person write surface turning out to be unavoidable for AM-03's ACs.

## Out of scope (named, not forgotten)

Person admin/CRUD (**AM-03-CF-1**) · leaver open-assignment enforcement (**AM-03-CF-2**,
deliberately — blocking deactivation on asset state would be a security regression) ·
pagination on the person view and per-asset history · AM-04 import · AM-05 export · AM-07
search.
