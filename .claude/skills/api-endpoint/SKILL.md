---
name: api-endpoint
description: Use when adding or changing anything in the daily FastAPI service — a router, endpoint, service, repository, Pydantic model, SQLAlchemy model, Alembic migration, authentication, or authorization. Also use when building a response that gets shared with another user.
---

# Working in the daily API

`docs/ARCHITECTURE.md` has the full design. This is the working procedure.

## Layering — one direction only

```
router → auth dependency → service → repository → PostgreSQL
```

| Layer           | Owns                                                | Never contains             |
| --------------- | --------------------------------------------------- | -------------------------- |
| `routers/`      | HTTP shape, status codes, serialization             | Business rules, SQL        |
| `services/`     | Use cases, authorization, projections, transactions | SQL, HTTP details          |
| `repositories/` | SQLAlchemy queries                                  | Business rules, HTTP types |

A router with an `if` about domain state belongs in a service. A service with a
`select()` belongs in a repository.

## Authorization

**The authenticated principal is the only source of identity.** A `user_id` in
a request body selects a resource; it never proves the caller may touch it.

```python
# Wrong — the caller chose which user's data to read
goal = await repo.get_goal(body.user_id, body.goal_id)

# Right — identity comes from the token
goal = await repo.get_goal(principal.user_id, body.goal_id)
```

Every mutation verifies ownership. Every social read verifies **current**
membership and share state at read time, never a value cached at write time.

Use the `Annotated` dependency style, not `Depends()` in a default argument —
ruff's B008 flags the latter:

```python
SessionDep = Annotated[AsyncSession, Depends(get_session)]

async def handler(session: SessionDep) -> Response: ...
```

## Privacy by projection

The single highest-consequence rule in this service.

**A shared response is a distinct type built from an allow-list.** Never a
private model with fields filtered out.

```python
# Wrong — one forgotten exclude leaks a journal
return PrivateReport.model_validate(report).model_dump(exclude={"journal"})

# Right — SharedReport has no journal field to leak
return SharedReport(streak=report.streak, goals=allowed_goals)
```

Tests must assert private fields are **absent** from the serialized response.
Asserting expected fields are present does not catch the failure mode, which is
an extra field appearing.

Add a test proving that a new field on the private model does not appear in the
shared one. That is the regression that happens a year later.

## Sessions and transactions

`get_session` yields one session per request and commits at the end. That is the
transaction boundary.

**Services must not open their own sessions.** A read used to decide a write has
to see that write's transaction. Pass the session down.

## Health endpoints

`/health` is **liveness and must not touch the database**. `/health/ready` is
readiness and does. Wiring them backwards turns a brief PostgreSQL blip into a
restart loop across every healthy replica. There is a test guarding this — do
not "helpfully" add a DB check to `/health`.

## Migrations

- Alembic, ordered, **reversible**.
- **Backward compatible with the currently-deployed revision**, so a rollback
  does not meet a schema it cannot read. Expand, then contract, across two
  deploys.
- Migrations run as a deploy step, never from application startup — N replicas
  racing the same migration is the failure that causes.

## Settings

Everything comes from `app/core/config.py`. Nothing reads `os.environ` directly.

`secret_key` has **no default** on purpose. A service that boots with a fallback
signing key is worse than one that refuses to boot. Do not add a default.

## Verifying

```sh
npm run api:lint        # ruff
npm run api:typecheck   # mypy strict
npm run api:test        # pytest
```

Or all of it plus the app:

```sh
npm run check
```

If you changed anything touching the database, run against real PostgreSQL:

```sh
npm run db:up && npm run api:test
```

If you changed the wire shape of a response, note that the generated client
will need regenerating — the drift gate is an open issue, so for now say so
explicitly rather than assuming CI catches it.
