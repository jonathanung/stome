---
name: issue-create
description: File one well-formed GitHub issue on daily — duplicate check, machine-readable wave/depends/blocks/conflicts headers, acceptance criteria, verification tier, explicit approval, then create and assign. Use when asked to file, open, write, or draft an issue, or to turn a bug report or feature request into a tracked ticket.
---

# File one issue

One scoped issue, approved before it is created. For a feature large enough to
need several issues, load `epic-decompose` instead.

## Preconditions

- `gh auth status` succeeds and the repo has a GitHub remote.
- The user has described a problem, change, or outcome.

Stop and ask if auth or write access is missing. Never file under a different
account than `gh api user --jq .login`.

## 1. Check for duplicates

```sh
gh issue list --repo jonathanung/daily --state all --limit 100 --search "<terms> in:title,body"
gh pr list --repo jonathanung/daily --state open --search "<terms>"
```

Also check the roadmap index issue — it maps every committed feature to its
owning epic. If the request is already covered there, say which issue owns it
and stop. **Do not file a duplicate.**

## 2. Draft

Every issue starts with these headers. The orchestrator reads them; an issue
without them cannot be scheduled.

```text
wave: N
depends: none | #a, #b
blocks: none | #c, #d
conflicts: none | #e, #f
priority: P0 | P1 | P2 | bugs-first | feature
```

| Field       | Meaning                                                                     |
| ----------- | --------------------------------------------------------------------------- |
| `wave`      | Lower ships first. Wave 0 is bugs and the baseline everything else sits on. |
| `depends`   | Every listed issue must be **closed** before this can start.                |
| `blocks`    | What this unlocks. A scheduling hint, not a gate.                           |
| `conflicts` | Never run in parallel with these.                                           |
| `priority`  | `bugs-first` beats `feature` inside a wave.                                 |

Then the body:

```text
Parent: #<epic>          ← only if this is a sub-issue

## Problem
What is broken or missing, and why it matters. Not "we should add X."

## Scope
What this issue covers. Bounded.

## Acceptance criteria
- [ ] Observable, checkable statements.

## Blockers
Only when real. Name the issue and what it gates.

## Non-goals
The adjacent thing this is explicitly not.

## Verification
Tier A | B | C, and the specific commands or scenario.
```

### Writing acceptance criteria

Criteria are the whole value of the issue. Each one should be checkable by
someone who was not in the conversation.

- **Say what breaks if it is wrong.** "A retroactive log is visibly marked"
  is fine; "handles retroactive logs" is not.
- **Call out the counterintuitive case explicitly.** These are the ones that
  get implemented backwards — an `at_most` goal with zero logs is _met_; white
  text on a saturated fill _fails_ contrast.
- **Absence tests for anything privacy-shaped.** Asserting expected fields are
  present does not catch the failure mode, which is an extra field appearing.

### Setting `conflicts`

Two issues conflict when they will edit the same file. In this repo the
hotspots are:

| Hotspot                                           | Why                                                                                    |
| ------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `app/src/ui/tokens/primitives.ts` · `semantic.ts` | Every component reads them; two edits collide and a bad merge silently breaks contrast |
| `app/src/ui/components/index.ts`                  | The barrel. Every new component touches it                                             |
| `app/src/app/components/*`                        | The workbench. Every UI issue adds a section                                           |
| `api/migrations/*`                                | **Always serialize.** Ordered migrations cannot merge                                  |
| `app/src/data/sync/*`                             | The sync engine. Concurrent edits here are how invariants get lost                     |
| `docs/UI.md` · `AGENTS.md`                        | Shared prose, frequent conflicts                                                       |

Prefer an explicit `conflicts: #N` over discovering the collision at merge.

## 3. Get approval

Show the user the full title and body. Ask for corrections or explicit
approval. **Do not create the issue until they approve the current draft.**

If material details change after approval, present the revision and ask again.

## 4. Create and assign

```sh
ASSIGNEE=$(gh api user --jq .login)
URL=$(gh issue create --repo jonathanung/daily \
  --title "<approved title>" \
  --body-file <approved-body-file> \
  --label "<labels>" \
  --assignee "$ASSIGNEE")
NUMBER=${URL##*/}          # gh prints a URL, not a number
```

Confirm with `gh issue view "$NUMBER" --json number,url,assignees`. If
assignment fails, report the created issue and stop — do not claim it is
assigned.

If it belongs to an epic, link it as a native sub-issue — see
`epic-decompose` for the exact call, which has a gotcha worth reading.

## Hard rules

1. Never create an issue without explicit approval of its current body.
2. Never duplicate an open issue or PR.
3. Never file without the five headers.
4. One issue per approved request unless the user approves splitting.
5. Assign to `gh api user --jq .login`. Never guess a username.
6. Filing is not starting. Load `issue-handler` only when asked to implement.
