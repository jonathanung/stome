---
name: issue-handler
description: Own one GitHub issue on daily end-to-end — worktree, implement, tier-gated verification, PR, review pass, CI, merge, cleanup. Use when asked to handle, fix, implement, take, or close an issue, ship a PR from an issue, or drive issue work through to main.
---

# Own one issue, end to end

Shipping is ownership: worktree → implement → verify → PR → review → CI → merge
→ cleanup. **All edits happen in a git worktree, never the primary checkout.**

## Preconditions

- `gh auth status` ok, network up, issue number known.
- **Stop and ask** if: no write access, `gh` missing, or the issue already has
  an open PR you did not create. Attach to it or ask — never duplicate.

A dirty primary checkout is fine. `git worktree add` branches off `origin/main`
and does not touch it. **Do not stash or clean someone else's WIP.**

## 1. Orient

```sh
gh issue view N --repo jonathanung/daily --comments
```

Read the issue's `Parent:` epic if it has one — the epic carries the reasoning
and the constraints that the sub-issue assumes. Note the headers
(`wave` / `depends` / `conflicts` / `priority`).

Read `AGENTS.md`, and `docs/ARCHITECTURE.md` or `docs/UI.md` depending on what
you are touching.

**Confirm `depends` are actually closed.** Starting a blocked issue wastes the
whole run.

## 2. Load the domain skill first

| Touching                                                 | Load              |
| -------------------------------------------------------- | ----------------- |
| Anything visual, tokens, components, screens             | `ui-component`    |
| Sync, local schema, cursors, repositories, streaks       | `sync-invariants` |
| Routers, services, repositories, migrations, projections | `api-endpoint`    |

These carry the invariants that a passing typecheck will not catch. Load them
**before** writing code, not while debugging.

## 3. Worktree

```sh
MAIN_ROOT=$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")
WT_PARENT="$(dirname "$MAIN_ROOT")/daily-worktrees"
BRANCH="feat/<kebab-slug>"        # kind ∈ feat|fix|chore|docs|refactor
mkdir -p "$WT_PARENT"
git fetch origin main

if [ -d "$WT_PARENT/$BRANCH" ] && git worktree list | grep -q "$WT_PARENT/$BRANCH"; then
  cd "$WT_PARENT/$BRANCH"        # resume yours; never delete someone else's
else
  git worktree add -b "$BRANCH" "$WT_PARENT/$BRANCH" origin/main
  cd "$WT_PARENT/$BRANCH"
fi

npm install && npm --prefix app install    # a fresh worktree has no node_modules
```

Before every edit session:

```sh
pwd                                # must be $WT_PARENT/$BRANCH
git rev-parse --abbrev-ref HEAD    # must be $BRANCH
```

Refuse to Write or Edit under the primary checkout for issue work.

## 4. Implement

Smallest correct change. No drive-by refactors — they make review harder and
bury the actual fix.

Assign the **verification tier** now (see `AGENTS.md` → Verification tiers).
Pick by what you touched, not by diff size. A one-line `primitives.ts` change
is Tier C.

## 5. Verify

```sh
npm run check                      # Tier B floor
```

Tier C additionally:

```sh
npm run db:up && npm run api:test                        # real PostgreSQL
cd app && npx expo export --platform ios  --output-dir /tmp/e-ios
cd app && npx expo export --platform web  --output-dir /tmp/e-web
# plus checkPalette() clean if tokens moved
```

**The bundle is the real gate for app changes.** Typecheck passes on plenty of
code Metro then refuses to build — a bad import path, a missing native peer, a
config plugin that does not resolve.

Things you cannot verify from a terminal, and must say so rather than assert:

- **Visual correctness.** Ask the user to check `/components` in both themes.
- **Anything needing a native module** — HealthKit, camera, push. These need a
  development build; Expo Go cannot do them.

## 6. Ship

```sh
git status && git diff
git add <intended paths only>
git commit -m "$(cat <<'EOF'
Concise imperative summary

Why, when the why is not obvious from the diff.

Fixes #N
EOF
)"
git push -u origin HEAD

gh pr create --base main --head "$BRANCH" --title "..." --body "..."
```

Fill in the PR template's checklist sections that apply and delete the rest.
**UI changes need screenshots in both themes** — a screenshot in one theme is
historically how a dark-mode contrast bug ships.

## 7. Review pass

Required for Tier B and C. Optional for A.

| Tier | Passes                       | Merge bar                                                        |
| ---- | ---------------------------- | ---------------------------------------------------------------- |
| A    | 0–1                          | Owner judgment                                                   |
| B    | 1 clean pass on current HEAD | 0 blocking; should-fix fixed or deferred with a reason on the PR |
| C    | 1–2 on current HEAD          | 0 blocking and 0 should-fix                                      |

Dispatch a read-only reviewer subagent, or run the rubric yourself if none is
available — but either way **post findings on the PR via `gh`**. A chat-only
"looks good" does not count.

```sh
PR=$(gh pr view --json number -q .number)
HEAD_SHA=$(gh pr view --json headRefOid -q .headRefOid)
gh pr comment "$PR" --body "## review pass 1 (head \`$HEAD_SHA\`) ..."
```

Rules:

- Post reviewer findings **verbatim**. Never omit or downgrade severity. If you
  disagree, post it anyway and stop-and-ask.
- Handler-authored reviews use `event: COMMENT` only. GitHub rejects
  self-approve, and self-request-changes wedges the merge gate.
- A clean review on an **older SHA does not satisfy the gate** after a new push.
- Cap at 5 passes. Still dirty → stop and ask.

## 8. CI and merge

```sh
gh pr checks --watch
```

| Failure        | Action                                             |
| -------------- | -------------------------------------------------- |
| Branch-related | Fix in worktree, push, re-enter review loop        |
| Flaky or infra | `gh run rerun <id> --failed` ≤2, then stop-and-ask |
| Ambiguous      | One diagnosis, then stop-and-ask                   |

Merge only when: review bar met **on the current head SHA**, CI green on that
same SHA, `mergeable=MERGEABLE`, not draft, local tier gate passed on that
commit.

```sh
gh pr merge --squash
```

## 9. Cleanup

```sh
cd "$MAIN_ROOT" && git fetch origin main
git worktree remove "$WT_PARENT/$BRANCH"
git branch -d "$BRANCH" 2>/dev/null || true
git worktree prune
```

Do not leave the shell inside a deleted worktree. Only delete branches you
created.

## Hard rules

1. Never edit the primary checkout for issue work.
2. Never claim done without the tier gate passing.
3. Never merge with failing checks or unmet review bar on the current SHA.
4. Never weaken or delete a test to get green.
5. Never force-push `main`. Never commit secrets or `.env`.
6. Load the domain skill before writing code, not after it breaks.
7. Smallest correct change. Scope beyond the issue goes in a new issue.
8. **Never claim a visual change looks right.** You cannot see it.
9. Stop and ask on ambiguity rather than guessing at product intent.

## Stop and ask

- `gh` auth or permission failure.
- Acceptance criteria are contradictory, or the issue assumes something the
  code does not do.
- A foreign or unexpectedly dirty worktree.
- Merge conflicts you cannot resolve confidently — prefer `git merge
origin/main` over rebase on a shared branch.
- The change would require breaking one of the architecture invariants in
  `AGENTS.md`. That is a decision, not an implementation detail.
- You want to drop or downgrade a reviewer's blocking finding.
