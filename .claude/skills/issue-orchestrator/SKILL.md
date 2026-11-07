---
name: issue-orchestrator
description: Drive daily's open GitHub issues to merge — read wave/depends/blocks/conflicts headers and the epic hierarchy, build the ready set, dispatch issue-handler agents in parallel worktrees, never parallelize conflicting issues. Use when asked to orchestrate issues, farm or drain the backlog, run the issue board, or coordinate several agents on issues.
---

# Orchestrate the issue board

You coordinate **many** issues. You do **not** write feature code in the primary
checkout. Each shippable unit is owned by an `issue-handler` in its own
worktree.

## Source of truth

```sh
gh issue list --repo jonathanung/daily --state open --limit 200
gh pr list --repo jonathanung/daily --state open
git fetch origin main && git worktree list
```

Start from the **roadmap index issue** — it maps every committed feature to its
epic and records the dependency order. It is faster than reconstructing the
graph from 60 issue bodies.

## Reading the board

This repo is organised as **epics with native sub-issues**. Schedule the
**sub-issues** — an epic is a container and carries no implementable work.

```sh
gh issue list --repo jonathanung/daily --label epic --state open \
  --json number,title --jq '.[] | "#\(.number) \(.title)"'

gh api repos/jonathanung/daily/issues/<epic>/sub_issues \
  --jq '.[] | "#\(.number) \(.title)"'
```

Every issue body starts with:

```text
wave: N
depends: none | #a, #b
blocks: none | #c, #d
conflicts: none | #e, #f
priority: P0 | P1 | P2 | bugs-first | feature
```

| Field       | Meaning                                                |
| ----------- | ------------------------------------------------------ |
| `wave`      | Lower first. Wave 0 is the baseline.                   |
| `depends`   | Every one must be **closed** before start.             |
| `conflicts` | Never in parallel.                                     |
| `blocks`    | Scheduling hint — prefer issues that unlock more.      |
| `priority`  | `bugs-first`/`P0` before `feature`/`P2` inside a wave. |

Missing headers → treat as `wave: 99`, `depends: none`, `conflicts: none`.
**Comment once asking for headers rather than guessing a large parallel graph.**

## Ready set

An issue is ready when **all** hold:

- state is `OPEN`
- every `depends` issue is `CLOSED`
- no `conflicts` issue is in flight (open PR, or an active worktree branch)
- its `wave` is the lowest eligible, or the user pinned it
- no open PR already fixes it — attach to that PR instead of duplicating

## Conflict rules

**The conflict graph beats the parallelism cap.** Default cap is 3; take fewer
slots when hotspots overlap.

Serialize when issues touch the same hotspot, even without an explicit header:

| Hotspot                          | Why                                                                |
| -------------------------------- | ------------------------------------------------------------------ |
| `app/src/ui/tokens/*`            | Every component reads these. A bad merge silently breaks contrast. |
| `app/src/ui/components/index.ts` | The barrel — every new component edits it.                         |
| `app/src/app/components/*`       | The workbench — every UI issue adds a section.                     |
| `api/migrations/*`               | **Always one at a time.** Ordered migrations cannot merge.         |
| `app/src/data/sync/*`            | Concurrent edits are how sync invariants get lost.                 |

A cluster of issues that all conflict with each other → **one worktree, one
handler** for the whole cluster.

## Priority order

1. **Wave 0 / `bugs-first` / `P0`** until none remain open.
2. Lowest open wave with `depends` satisfied.
3. Inside a wave: bugs first, then whatever unlocks the most `blocks`, then
   lowest issue number.

Three issues in this repo are load-bearing far beyond their size, and starting
dependents before them means rewriting the dependents. Prefer them when ready:

- **Goal direction** — every metric, streak, chart colour, and ranking reads it.
- **The metrics engine** — every dashboard screen needs the same numbers, and
  computed per screen they will disagree.
- **The social relationship model** — everything social is blocked on it.

## Dispatch

For each ready issue, up to the cap:

1. Spawn an agent and tell it to load **`issue-handler`** with the issue number.
2. The handler owns worktree → implement → tier gate → PR → review → CI →
   merge → cleanup.
3. Track: issue → branch → PR URL → status
   (`queued` / `in_progress` / `review` / `merged` / `blocked`).

Do not implement production code yourself as the orchestrator.

## Loop

```text
1. refresh issues, PRs, worktrees, origin/main
2. build ready set
3. fill free slots by priority order
4. nudge in-flight PRs; re-dispatch a stalled handler
5. on merge: mark done, unlock dependents
6. on block: comment on the issue, mark blocked, free the slot
7. exit when nothing open, user stops, or only blocked remain
```

### Stalls

| Symptom                         | Action                                                    |
| ------------------------------- | --------------------------------------------------------- |
| CI red beyond a reasonable wait | Assign a handler to that PR                               |
| Review loop past 5 passes       | Stop and ask; do not merge                                |
| Merge conflict with main        | Handler merges `origin/main` in its worktree              |
| Needs a product decision        | Comment on the issue, stop that lane, keep others running |

## Reporting

Lead with board state, not prose:

```text
wave 0:    3 merged · 1 in flight · 0 blocked
ready:     #45 #62
in flight: #40 → <pr url> (review)
blocked:   #52 (needs #43)
next:      #45 — unlocks #46 #47 #48
```

**Never claim green without `gh pr checks`.** Report what you verified, and say
plainly what is still running.

## Hard rules

1. Schedule sub-issues, not epics.
2. Bugs and `P0` before features when both are ready.
3. Never parallelize `conflicts`, and never two migration issues at once.
4. Never duplicate an existing open PR.
5. Handlers own the merge gate. The orchestrator does not merge over failing
   checks or an unmet review bar.
6. Never force-push `main`. Never commit secrets.
7. Stop and ask when `gh` auth fails, when the user must choose between
   conflicting product directions, or when only blocked issues remain.

## What this is not

- Not a substitute for `issue-handler` on a single issue — use the handler.
- Not a licence to max out parallel agents when the conflict graph forbids it.
- Not an implementer of work that has no issue. File one first with
  `issue-create` or `epic-decompose`.
