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

`cancel` waits until you press Cancel. `timeout`, `error`, and `oversize` fail the question and do not change the note. **Continue** asks again with the saved messages after a failure, a cancellation, or a discarded proposal.

The token lives in component memory. It is not written to `localStorage` or `sessionStorage`. There is no provider API key in the browser. `STOME_PROVIDER=api-key` only selects a disabled stub; it does not make a network call.

```bash
STOME_APP_ORIGIN=http://localhost:8081 STOME_COMPANION_PORT=8787 npm run companion
```

## What is real, and what is a stub

| Piece | Where it lives | Status |
| --- | --- | --- |
| Saved notes | `stome.db` via Expo SQLite, scaffold table `notes` | Existing app path, unchanged |
| Sessions, messages, operation ids | separate Expo SQLite file `stome-harness.db` | Harness-owned |
| Confirmed AI answer | `harness_stub_annotations` in `stome-harness.db` | Stub until #36 |
| Room / chunk / annotation tables | not created | Owned by #35 |
| Model calls | deterministic mock in the companion | No live provider |

Until #35 exists, a chunk is a scaffold note:

- room id: `scaffold-notes` (the only room this screen can select)
- chunk id: `note:<notes.id>`
- anchor text: the note body
- expected revision: the note's `updated_at`

The app re-reads that note at confirm time. A companion payload is not a write permission. Confirmation builds this request and the stub stores it:

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

## Session states

`idle → running → completed | failed | cancelled`

`completed`, `failed`, and `cancelled` can return to `running` only through **Continue**. A completed session with an unconfirmed proposal must be confirmed or discarded first. A session still `running` when the harness database opens is marked `failed` with `interrupted`. A result that arrives after cancel, or after that restart, is discarded.

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
- Requires the configured `Origin` and a pairing token that expires (default two hours).
- Rejects a non-loopback socket and a `Host` that is not `127.0.0.1` or `localhost` on its port.
- Responses do not contain the pairing token or `STOME_PROVIDER_API_KEY`.

Browser requests need the page origin to match. Expo web SQLite needs these headers on the HTML document, not only on the bundle:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: credentialless`

`metro.config.js` sets them on Metro responses. `npm run web:sqlite` also sets them on the document. A Chrome run at `http://localhost:8081` reported `crossOriginIsolated === true`. The document response carried `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless`. The pairing token was not in `localStorage` or `sessionStorage`, and the token field was empty after reload.

On that origin, Expo SQLite stored both databases in the origin private file system directory `expo-sqlite`. The file headers identified `/stome.db` (scaffold notes) and `/stome-harness.db` (sessions, messages, operation ids, and stub annotations). The app path uses this real `expo-sqlite` web driver. `npm run check:harness` uses Node's `node:sqlite` and is not a substitute for that browser run. iOS and Android were not run.

## Checks

`npm run check` already used by `.github/workflows/checks.yml` now includes `npm run check:harness`. That job still does not boot Expo web. Browser evidence is separate and uses the real `expo-sqlite` driver.
