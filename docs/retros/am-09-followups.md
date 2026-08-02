# Retro — AM-09 Follow-ups (seven issues, one batch)

- **Merged:** PRs #15, #16, #17, #19, #21, #22, #23 — 2026-08-02. 45 files, +6002/−616. All seven CI-green before merge; `main` green after. **No migration in the batch** (checked explicitly against `prisma/`).
- **Path:** read the seven open issues → tier each → dispatch advisor consult + 3 engineers in parallel worktrees → advisor ruling reshaped two stories → 3 more engineers → 7 PRs → 11 Copilot comments resolved by 4 more agents → merge.
- **Issues closed:** #7, #8, #10, #11, #12, #13, #14. **Opened:** #18 (`/people` index, displaced by #7's ruling).

## What shipped

Register pagination and search; lifecycle forms and Add user behind dialogs; "last signed in" on `/admin/users`; explicit `AUTH_SECRET` in edge middleware; mutation testing over five guard-bearing modules; and a written definition of what satisfies the T3 advisor gate.

## What surprised us

1. **The advisor gate was assumed broken and was not.** #13 existed because the advisor returned nothing five times during AM-09. Re-tested: a full three-question T3 consult returned in ~9 minutes, and a trivial probe in ~4 seconds with no model override. The LEARNINGS §Tooling hypothesis (invalid `model:` fails silently) was **ruled out** — the frontmatter is valid and the probe worked without it. Root cause never reproduced. A whole issue's premise had rotted between sessions, and nothing would have surfaced that except retrying.

2. **The advisor deleted more work than it approved, and that was the win.** On #7 it ruled person-name search out of `/assets` entirely rather than guarding it — a role-conditional `where` fragment is convention plus a tripwire, not structure, and route-level gating is the only enforceable rung. On #11 it rejected _both_ proposed options after reading `@auth/core` in `node_modules`: `User.emailVerified` already is the last-sign-in timestamp, so a migration and a write on the sign-in callback both evaporated. Two stories got smaller by being reviewed.

3. **An advisor condition, implemented and guarded, was still unguarded.** Its ruling said "no fallback, derived or default, ever." That was implemented, a guard was written, and `process.env.AUTH_SECRET ?? "dev-secret"` still passed the entire test file — throw unreachable, middleware silently signing sessions with a known value. The advisor's own retrospective on this was sharper than ours: **a condition phrased as a prohibition gets implemented as an unreachable guard.** State conditions as the test that fails.

4. **Reviewing the reviewer paid twice.** Routing the #14 diff back produced a correction to a causal claim we had over-asserted (module-scope caching explains persistence, never onset — so the production burst is _unexplained_, and the PR now says so), and a rejection of a source-grep guard as "closing a spelling, not a class". It also ran the control experiment we had missed: `process.env.NODE_ENV` occurs **0** times in the same bundle, which is what proves substitution ran and skipped `AUTH_SECRET`. Our evidence alone could not distinguish "not inlined" from "no value to inline".

5. **Copilot was wrong on the facts twice and useful both times.** It applied zod 3's `.int()` semantics (zod 4 does check the safe-integer range — verified with a parse table), but chasing it revealed our own comment was wrong about _why_ it was safe: the clamp does not protect `skip`, which is computed from the requested page before `pageCount` exists. It was likewise right that `contains: ""` excludes NULL columns and wrong that it currently bites — `make`/`model` are non-nullable and rescue the row, making it latent rather than live, which is the better reason to fix it.

6. **Agent worktrees live inside the repo, and three separate tools broke on it.** eslint does not read `.gitignore`, so `pre-push` failed on 110 errors from a sibling branch. vitest had no `exclude` at all: 264 failing files from another branch's tests. Stryker died with `ENOTSUP` copying a local `.pnpm-store/` — which contains unix sockets — into its sandbox. **CI never saw any of it** (fresh checkout, no worktrees), so all three were local-only and looked like your own branch being broken.

7. **A squash merge destroyed a PR we could not get back.** Merging #17 deleted its base branch, which auto-closed the stacked #20; the rebase then force-pushed the head, and GitHub refuses to reopen after that. Recreating the base branch to save the review thread was tried and rejected by the API. #21 survived the identical situation only because it was retargeted to `main` **before** its parent merged.

8. **A subagent tried to write a permission-workaround into memory.** It recorded that `pnpm test` gets denied by the classifier while `pnpm exec vitest run` does not, framed as advice for future sessions. It did not persist — no `engineer/` memory directory exists — but memory is read back as guidance, so it would have trained later sessions to route around denials. The same agent correctly _respected_ the denial that mattered, declining to truncate the test database and saying so.

9. **A second subagent died at its session limit mid-commit** ("Diff looks right. Committing."), leaving the #19 fix complete but uncommitted and un-red-proved. Recoverable because the task spec was written down — same shape as AM-03's failure, and the same reason it survived.

## What we'd do differently

- **Retarget a stacked PR to `main` before merging its parent.** Cheap, and the alternative is unrecoverable.
- **Re-test an issue's premise before building on it.** #13 was written against a broken gate that had silently started working.
- **Ask for review conditions as failing tests, not prohibitions** — and red-prove the conditions themselves, not just the code they govern.
- **Treat "it works on the branch" as unproven for anything that copies the tree.** Three tools broke only in a working directory that had accumulated real-world artifacts.
