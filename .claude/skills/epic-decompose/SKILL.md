---
name: epic-decompose
description: Turn a feature area into a GitHub epic with linked native sub-issues on daily — epic body with outcome and product decisions, sub-issues with acceptance criteria and blockers, correct gh sub_issues API calls, blocks fields resolved. Use when asked to plan a feature area, break work into epics, decompose a milestone, or file a batch of related issues.
---

# Decompose a feature area into an epic

An epic carries the **reasoning**; its sub-issues carry the **acceptance
criteria**. Someone picking up a sub-issue should be able to read the epic and
understand why the constraints exist.

For a single scoped issue, load `issue-create` instead.

## The shape

```
EPIC: <feature area>          labels: epic, <domain>, P0|P1|P2
 ├── AREA.1: <first slice>    labels: <domain>, P0|P1|P2
 ├── AREA.2: ...
 └── AREA.3: ...
```

Prefix sub-issues with a short area code (`SYNC.`, `GOAL.`, `INSIGHT.`) so they
sort and read as a set. Number them in dependency order.

## Epic body

```text
wave: 0
depends: none | #a
blocks: TBD                  ← fill in once children exist
conflicts: none
priority: feature

## Outcome
What is true for a user when this is done. One paragraph, no hedging.

## Why this epic
Why it is its own epic rather than a sub-issue of something else. If it exists
because a naive implementation has a specific failure mode, say so here — that
is the most useful paragraph in the document.

## Product decisions
Numbered. The calls that constrain every child. Each should be a decision
someone could otherwise reasonably make differently.

## Non-goals
The adjacent things this is explicitly not. Be specific; vague non-goals do not
prevent scope creep.

## Verification
The scenario that proves the epic, not each issue.
```

**The "Why this epic" section earns its place by naming the trap.** Good
examples from this repo: group streaks are their own epic because N members'
logs arrive out of order and the obvious stored-counter implementation is the
last-write-wins bug; leaderboards are their own epic because "load everyone's
totals and sort" leaks the moment someone leaves.

## Sub-issue body

Same headers as `issue-create`, plus `Parent: #<epic>`, plus a `## Blockers`
section whenever a real dependency exists. Name the blocking issue and say what
it gates — a bare `depends:` header is easy to miss.

Sub-issues that ship UI must carry the UI conformance checklist. Copy it from
an existing one; do not paraphrase it, since a weakened copy is worse than none.

## Creating them

`gh issue create` prints a **URL**, not a number, and the sub-issues endpoint
wants an **id**, not a number. Both have caused silent failures here. Use these
helpers rather than inlining the calls:

```sh
R=jonathanung/daily

epic() { # title, labels, body -> prints number
  local url; url=$(gh issue create --repo "$R" --title "$1" --label "$2" --body "$3")
  echo "${url##*/}"
}

sub() { # parent, title, labels, body
  local p="$1"; shift
  local url n
  url=$(gh issue create --repo "$R" --title "$1" --label "$2" --body "$3")
  n="${url##*/}"
  # -F sends an integer. -f sends a string and the API rejects it *silently* —
  # the issue is created, the link is not, and nothing tells you.
  gh api -X POST "repos/$R/issues/$p/sub_issues" \
    -F sub_issue_id="$(gh api "repos/$R/issues/$n" --jq .id)" >/dev/null
  echo "  #$n  $1"
}
```

`sub_issue_id` is the issue's **`.id`** (the database id), not its number.
Passing the number links the wrong issue or fails.

## After creating

1. **Fill in `blocks:` on the epic** with the real child numbers. Leaving `TBD`
   there is the most common thing forgotten in this repo.

   ```sh
   gh api "repos/$R/issues/$E" --jq .body \
     | sed "s|^blocks: TBD$|blocks: #A, #B, #C|" \
     | gh issue edit "$E" --repo "$R" --body-file - >/dev/null
   ```

2. **Verify every child is actually linked.** The silent-failure mode above
   means you cannot assume it worked:

   ```sh
   gh api "repos/$R/issues/$E/sub_issues" --jq '.[] | "#\(.number) \(.title)"'
   ```

3. **Update the roadmap index issue** so the new epic appears in the coverage
   table. An epic missing from the index is invisible.

## Hard rules

1. Every sub-issue is linked with the `sub_issues` API and verified afterwards.
2. No epic ships with `blocks: TBD`.
3. Acceptance criteria live on sub-issues; reasoning lives on the epic. Do not
   duplicate — they will drift.
4. Non-goals are mandatory on the epic. Most scope creep enters through an
   adjacent feature nobody wrote down as excluded.
5. Name real blockers explicitly. An issue that cannot start should say so.
6. Do not create an epic for work that is one issue.
