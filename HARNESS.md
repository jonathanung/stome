# Stome hackathon harness

This is the laptop-local TypeScript harness for issue #32 (decisions 6–11) and child issues #48–#51. It is not the Foundation schema (#35) and it is not the Foundation commit (#36).

## Quick start

```bash
npm ci
npm run companion
```

The companion prints a pairing token and listens on `http://127.0.0.1:8787`. Leave that process open.

```bash
npm run web:sqlite
```

Open the app at `http://localhost:8081` (the companion's default allowed origin). That command proxies Expo, which listens on port 8082, and adds the document headers below. Create a room, add a note chunk, tick **Include** on that chunk, paste the token into **Pairing token**, leave the scenario on `success`, choose **Ask**, then **Confirm and save**. Reload the page. The AI answer is on the chunk. The chunk text and revision are unchanged.

`cancel` waits until you press Cancel. `timeout`, `error`, and `oversize` fail the question and do not change the note. **Continue** asks again with the saved messages after a confirmed answer, a failure, a cancellation, or a discarded proposal. Each new proposal is confirmed on its own. An old operation id still returns the original save.

The token lives in component memory. It is not written to `localStorage` or `sessionStorage`. There is no provider API key in the browser. `STOME_PROVIDER=api-key` only selects a disabled stub; it does not make a network call.

```bash
STOME_APP_ORIGIN=http://localhost:8081 STOME_COMPANION_PORT=8787 npm run companion
```

## What is real, and what is a stub

| Piece | Where it lives | Status |
| --- | --- | --- |
| Saved chunks | `stome.db` rooms and chunks | Written by the room screen and import, through `createCommit` |
| Sessions, messages, operation ids | separate Expo SQLite file `stome-harness.db` | Harness-owned. The operation id is stored on the session before `createCommit` |
| Confirmed AI answer | `annotations` in `stome.db` | `source: 'ai'`, `confirmed: true`. `expectedRevision` is the revision stored on the proposal when it was created. A newer chunk revision rejects the confirm. Replay of that operation id does not insert again |
| Older demo pins | `harness_stub_annotations` | Left in place. A `note:*` selection fails confirm and is not copied |
| Model calls | deterministic mock in the companion | No live provider |

A companion payload is not a write permission. Confirmation re-reads the chunk, then calls `createCommit`:

```ts
{
  opId: string,
  kind: 'annotation.create',
  source: 'ai',
  confirmed: true,
  expectedRevision: number, // proposal.chunkRevision, not a newer read
  payload: {
    chunkId,
    type: 'ai_answer',
    anchor: { start, end },
    payload: { answer, proposalId },
  },
}
```

`createCommit` writes the annotation, checks the revision, and records `applied_ops` in one transaction. Room saves and a confirm share one queue for that database, so a human note or highlight waits until the pin transaction finishes. A failed pin rolls back only its own transaction. The session flag is a separate write in `stome-harness.db`. A retry reads `applied_ops` before it checks the chunk again. If that operation id already committed an annotation, the session flag is repaired and nothing is inserted, even when the chunk was edited or deleted afterward. A new operation id still rejects a stale or missing chunk and writes nothing. The proposal and its operation id are stored in the same session update. A completed proposal that has no operation id gets one stable id on the next open. `commitStubAnnotation` is not used for this save.

## Session states

`idle → running → completed | failed | cancelled`

`completed`, `failed`, and `cancelled` can return to `running` only through **Continue**. A completed session with an unconfirmed proposal must be confirmed or discarded first. Confirming one proposal does not consume the next one: the confirmation flag applies to the current proposal, and the next turn clears it. The previous operation id still replays from `applied_ops` and `harness_operations`. A session still `running` when the harness database opens is marked `failed` with `interrupted`. A result that arrives after cancel, or after that restart, is discarded. If a saved chunk is missing when a run tries to finish, the run is marked `failed` instead of staying `running`.

## Tool and provider

The registry contains only `notes.proposeAnnotation`. There is no plugin loader, shell tool, or filesystem tool.

Mock scenarios, all deterministic:

| Scenario | Result |
| --- | --- |
| `success` | `Mock answer (<sorted chunk ids>; messages=<prior count>): <prompt>` anchored to the first 12 characters, or the whole body if it is shorter |
| `timeout` | normalized `timeout` immediately (the real limit below still aborts a hung call) |
| `error` | normalized `provider_error` |
| `cancel` | waits until the abort signal |
| `oversize` | output longer than the limit, rejected |

Limits: request text 8,000 characters (prompt + selected note bodies + saved messages), output 2,000 characters, time 30 seconds. The raw companion body limit is 10,000 bytes.

## Companion

- Binds `127.0.0.1` only.
- Requires the configured `Origin` and a pairing token that expires (default two hours). The deadline is computed once at process start. A later request does not extend it. `STOME_PAIRING_TTL_MS` must be a positive finite number of milliseconds.
- Rejects a non-loopback socket and a `Host` that is not `127.0.0.1` or `localhost` on its port.
- The app sends the selected text and the token only after the companion URL is `http` on `127.0.0.1`, `localhost`, or literal IPv6 loopback, with no user or password in the URL. `http://[::1]` is accepted: the hostname still includes the brackets, and the check reads the address inside them. An IPv4-mapped address such as `::ffff:127.0.0.1` is rejected before `fetch`. The companion process still listens on `127.0.0.1` only.
- Responses do not contain the pairing token or `STOME_PROVIDER_API_KEY`.
- While a confirmation is in progress, Ask, Continue, Cancel, and Discard stay disabled. Cancel is only enabled while a question is running.

Browser requests need the page origin to match. Expo web SQLite needs these headers on the HTML document, not only on the bundle:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: credentialless`

`metro.config.js` sets them on Metro responses. `npm run web:sqlite` also sets them on the document. A Chrome run at `http://localhost:8081` reported `crossOriginIsolated === true`. The document response carried `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless`. The pairing token was not in `localStorage` or `sessionStorage`, and the token field was empty after reload.

On that origin, Expo SQLite stored both databases in the origin private file system directory `expo-sqlite`. The file headers identified `/stome.db` (scaffold notes) and `/stome-harness.db` (sessions, messages, operation ids, and stub annotations). The app path uses this real `expo-sqlite` web driver. `npm run check:harness` uses Node's `node:sqlite` for the session rules. The production queue itself is covered there by the same serializer the Expo adapter uses, one owner per connection, with the transaction callback on a direct executor. That Node run is still not a substitute for the browser `expo-sqlite` driver. iOS and Android were not run.

## Checks

`npm run check` already used by `.github/workflows/checks.yml` now includes `npm run check:harness`. That job still does not boot Expo web. Browser evidence is separate and uses the real `expo-sqlite` driver.
