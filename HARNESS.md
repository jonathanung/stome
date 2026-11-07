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

Open the app at `http://localhost:8081` (the companion's default allowed origin). That command proxies Expo, which listens on port 8082, and adds the document headers below. Paste the token into **Pairing token**. Save a note that has body text, tick **Include**, leave the scenario on `success`, choose **Ask**, then **Confirm and save**. Reload the page. The AI answer is still under the note. The note title and body are unchanged.

`cancel` waits until you press Cancel. `timeout`, `error`, and `oversize` fail the question and do not change the note. **Continue** asks again with the saved messages after a confirmed answer, a failure, a cancellation, or a discarded proposal. Each new proposal is confirmed on its own. An old operation id still returns the original save.

The token lives in component memory. It is not written to `localStorage` or `sessionStorage`. There is no provider API key in the browser. `STOME_PROVIDER=api-key` only selects a disabled stub; it does not make a network call.

## Whiteboard assistant (#14)

Open a room's whiteboard in the web app, paste the companion token, and choose Explain, Check, or Quiz. The companion's `/v1/board` route accepts a bounded snapshot of that room's board. Its default board provider returns labeled mock replies. For a live model, start the companion with `STOME_BOARD_PROVIDER=openai` and `STOME_BOARD_API_KEY` (or `OPENAI_API_KEY`) set in the server environment. `STOME_BOARD_MODEL` defaults to `gpt-4o-mini`. The board provider uses the Responses API with a strict JSON schema and `store: false`; the API key stays in the companion process. A reply may propose one new or replacement text item. Dismiss leaves the board unchanged; Accept passes an AI-sourced, confirmed `board.save` operation through the Foundation commit boundary with the revision that was shown when the request started. A stale board is rejected.

The canvas works on web, iOS, and Android. The local companion binds to loopback for same-computer web use. Native devices use the separate `npm run board:service` HTTPS endpoint with a trusted certificate and pairing token. The service binds to loopback by default; configure its host, port, certificate paths, and optional `STOME_BOARD_APP_ORIGIN` for a web frontend. It receives object geometry and text, not an image of the board. It does not accept unrelated note or harness tool routes.

```bash
STOME_APP_ORIGIN=http://localhost:8081 STOME_COMPANION_PORT=8787 npm run companion
```

## What is real, and what is a stub

| Piece | Where it lives | Status |
| --- | --- | --- |
| Saved notes | `stome.db` via Expo SQLite, scaffold table `notes` | Existing write path. FND.1 (#55) added `rooms`, `chunks`, and `annotations` at schema version 2. This harness does not write those tables. |
| Sessions, messages, operation ids | separate Expo SQLite file `stome-harness.db` | Harness-owned |
| Confirmed AI answer | `harness_stub_annotations` in `stome-harness.db` | Stub until #36 |
| Room / chunk / annotation tables | not created | Owned by #35 |
| Model calls | deterministic mock in the companion | No live provider |

Until #35 exists, a chunk is a scaffold note:

- room id: `scaffold-notes` (the only room this screen can select)
- chunk id: `note:<notes.id>`
- anchor text: the note body
- expected revision: the note's `updated_at`

A companion payload is not a write permission. Confirmation reads the scaffold note from `stome.db` immediately before it builds this request, and the stub stores it in `stome-harness.db`:

```ts
{
  opId: string,
  kind: 'annotation.create',
  source: 'ai',
  confirmed: true,
  expectedRevision: number,
  payload: {
    proposalId, roomId, chunkId, noteId,
    type: 'ai_answer', body, anchorStart, anchorEnd
  }
}
```

`src/harness/store.ts` `commitStubAnnotation` is the temporary writer. Replace it with the #36 function. The replacement is tracked in #53. Do not treat `harness_stub_annotations` as the shared annotation schema.

That note read is not atomic with the stub write. The two databases are separate files, so a note edit can still commit after the read and before the stub insert. The revision check uses the `updated_at` from that read. It is not the Foundation confirmation gate, and this harness does not claim that gate exists. Schema version 2 from #55 creates the Foundation tables and leaves them unused here. #53 is where that cross-database limit has to be closed, by writing through the real commit in one database.

## Session states

`idle → running → completed | failed | cancelled`

`completed`, `failed`, and `cancelled` can return to `running` only through **Continue**. A completed session with an unconfirmed proposal must be confirmed or discarded first. Confirming one proposal does not consume the next one: the confirmation flag applies to the current proposal, and the next turn clears it. The previous proposal stays saved because its proposal id already has a stub row, and its operation id still replays from `harness_operations`. A session still `running` when the harness database opens is marked `failed` with `interrupted`. A result that arrives after cancel, or after that restart, is discarded. If a saved note is missing when a run tries to finish, the run is marked `failed` instead of staying `running`.

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
