---
name: sync-invariants
description: Use when working on offline-first sync, the local SQLite schema, Drizzle migrations, repositories in app/src/data/, the change_log, cursors, conflict resolution, tombstones, or anything touching how data moves between a device and the API. Also use when adding a field to a synchronized record or computing streaks and progress.
---

# Sync invariants

`docs/ARCHITECTURE.md` has the full design. These are the rules that, when
broken, cause silent and permanent data loss — the failure mode nobody notices
until a user complains that a week of logs vanished.

## The two bugs already fixed here

Both were inherited from a previous design and deliberately corrected. Do not
reintroduce them.

**1. Derived state on a synchronized record.** Streak state used to live on the
goal identity, which resolves by last-write-wins. Two devices logging the same
day clobber each other and one increment disappears.

> Streaks and progress are **computed from logs**, never stored, never synced.
> Two devices holding the same logs agree by construction.

If you are about to add a count, a total, a percentage, or a "current streak"
column to a synced table — stop. It belongs in a pure function over logs.

**2. Timestamps as a sync cursor.** A wall-clock cursor drops any record whose
transaction commits after a later-timestamped one, permanently.

> The cursor is a **monotonic server sequence**, and nothing else.

## The gap-sequence trap

`BIGSERIAL` allocates before commit. A reader can observe sequence 5 and 7 while
6 is still in flight; advancing the cursor past 7 loses row 6 forever.

> A pull must stop at the lowest in-flight transaction
> (`pg_snapshot_xmin(pg_current_snapshot())`) and never return rows at or beyond
> it.

"Use a sequence" alone does not fix the timestamp bug. It is sequence **plus a
visibility bound**.

## Client-side rules

- **Every write marks the record dirty in the same transaction that writes it.**
  A write that lands un-dirtied never syncs.
- **Deletes are tombstones** — set `deleted_at`, mark dirty. Never `DELETE`.
- **The cursor advances only inside the transaction that applies the pull.**
  Clear dirty flags, mark rejections, apply pulled records, and store the cursor
  — one transaction, all or nothing.
- **If that transaction fails the cursor must not move**, so the same changes
  come back next cycle.
- **Applying the same response twice must be a no-op.**
- **Dirty flags clear only for IDs the server actually acknowledged.**
- **One cycle at a time.** A second trigger joins the in-flight one; it does not
  race it.
- **IDs are client-generated UUIDs**, so a record has identity before it has
  ever reached the server.

## Rejections

A locally-accepted write the server refuses must **keep its local copy**, get
marked with a reason, and surface to the user. Never silently discard. Nothing
disappears behind the user's back.

## Conflict policy

| Entity              | Rule                                                                 |
| ------------------- | -------------------------------------------------------------------- |
| Goal configurations | Append-only, deduplicated by ID. No conflict possible.               |
| Logs                | Additive by ID. Same-ID edits resolve by `updated_at`.               |
| Goal identities     | LWW on `updated_at`, user-authored fields only.                      |
| Ties                | Break by `client_id` so devices converge without another round trip. |

Editing a goal's target **appends a configuration version**; it never mutates an
existing one. Logs reference the stable identity, never a configuration. To
interpret a historical log, resolve the newest non-deleted configuration whose
`effective_from` is not later than the log time.

## Every synchronizable table has

| Column                      | Purpose                          |
| --------------------------- | -------------------------------- |
| `id`                        | Client-generated UUID            |
| `created_at` / `updated_at` | Ordering and conflict resolution |
| `deleted_at`                | Tombstone                        |
| `dirty`                     | Client-only: needs pushing       |
| `rejected_reason`           | Client-only: server refused it   |

Adding a table without all five is a bug.

## Layering

```
screen → feature hook → repository → Drizzle → SQLite
```

Screens never touch SQL. Repositories never touch HTTP. The **sync engine is
the only place** local record types and wire types meet.

## Verifying

```sh
npm run app:typecheck && npm run api:test
```

The tests that actually matter for sync work:

- Kill the apply transaction mid-way; assert the cursor did **not** advance.
- Apply the same response twice; assert identical state.
- Hold an uncommitted sequence, commit a later one; assert the pull does not
  return the later row.
- Compute a streak across a configuration change; assert both sides of the
  boundary are right.

If you changed sync behaviour and did not add or run one of these, say so.
