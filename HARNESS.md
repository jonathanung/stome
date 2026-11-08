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
| Confirmed AI note edit | `chunks.content` in `stome.db` | `chunk.update`, `source: 'ai'`, `confirmed: true`. The proposal stores the body it read and that revision. Confirm sends that revision, not a newer read. Cancel, discard, refusal, and a stale revision leave the saved text unchanged. Replay does not write again |
| Legacy demo rows | `stome-harness.db` | Removed by the v3 harness migration. A `note:*` selection still fails confirm and is never copied into `annotations` |
| Model calls | deterministic mock by default; a live Anthropic, OpenAI, or xAI model when the companion starts with `STOME_PROVIDER=anthropic`, `openai`, or `xai` | The key stays in the companion process. `npm run check` and CI always use the mock. See [Live mode](#live-mode) |

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

`createCommit` writes the annotation, checks the revision, and records `applied_ops` in one transaction. Room saves and a confirm share one queue for that database, so a human note or highlight waits until the pin transaction finishes. A failed pin rolls back only its own transaction. The session flag is a separate write in `stome-harness.db`. A retry reads `applied_ops` before it checks the chunk again. If that operation id already committed an annotation, the session flag is repaired and nothing is inserted, even when the chunk was edited or deleted afterward. A new operation id still rejects a stale or missing chunk and writes nothing. The proposal and its operation id are stored in the same session update. A completed proposal that has no operation id gets one stable id on the next open. There is exactly one commit path: `confirmFoundationQuestion` calls `createCommit` (FND.2), and the harness stores only sessions, messages, and operation ids.

## Live mode

The companion can answer with a real model from Anthropic (Claude), OpenAI (ChatGPT), or xAI (Grok). It is opt-in, and every question costs money. Pick one vendor per companion process:

```bash
ANTHROPIC_API_KEY=... STOME_PROVIDER=anthropic npm run companion   # Claude
OPENAI_API_KEY=...    STOME_PROVIDER=openai    npm run companion   # ChatGPT
XAI_API_KEY=...       STOME_PROVIDER=xai       npm run companion   # Grok
```

| `STOME_PROVIDER` | Key | Default `STOME_MODEL` | `STOME_EFFORT` | SDK and API |
| --- | --- | --- | --- | --- |
| unset or anything else | none | mock | n/a | deterministic mock |
| `anthropic` (legacy alias `api-key`) | `ANTHROPIC_API_KEY` or an `ant auth login` profile | `claude-opus-5-5` | `low` … `max`, default `medium`, sent as `output_config.effort` | `@anthropic-ai/sdk`, Messages API |
| `openai` | `OPENAI_API_KEY` | `gpt-6-astra` | `none` … `max`, default `medium`, sent as `reasoning.effort` | `openai`, Responses API |
| `xai` | `XAI_API_KEY` | `grok-4.7` | not sent unless set | `openai` SDK at `https://api.x.ai/v1`, Responses API |

`STOME_MODEL` overrides the model id for any vendor (for example `gpt-6.1-sol` or `grok-build-0.1`).

- The key lives only in the companion process. The app never sees it: it holds the pairing token, and `GET /v1/status` reports `{provider, model, live, tools}` and nothing secret. The startup log names the provider and model and says whether the key env var is set, never its value.
- With no key the first question fails with a `provider_error` naming the missing variable. The companion does not crash.
- The providers live under `companion/providers/` so Metro never bundles an SDK. `shared.ts` holds the vendor-neutral half: one stable system prompt and one JSON schema per tool, quote anchoring, and the tool dispatch. `anthropic.ts` and `openai.ts` (OpenAI and xAI) each make one structured-output call and map their SDK errors.
- Structured outputs: Anthropic uses `output_config.format`; OpenAI and xAI use `text.format` with `type: 'json_schema'` and `strict: true`. No sampling parameters and no forced tool use. Anthropic also turns on the server-side refusal fallback beta; OpenAI requests send `store: false`. A refusal, content filter, or truncated answer becomes a normalized error.
- Retries are capped at 1 so they cannot outlast the 30 s limit. Cancel and the limit abort the HTTP call.
- Note, board, and import text is wrapped in `<content>` delimiters and the model is told it is data, not instructions. Output still goes through the same parsers and scope checks as the mock, and nothing is written without a human confirm.
- `notes.proposeAnnotation` asks the model for a verbatim quote and computes `anchorStart`/`anchorEnd` with `indexOf`. If the quote is not found, the first sentence (or the whole chunk, if short) is anchored.
- `npm run check` and CI use the mock and fake clients in `scripts/check-live-provider.test.ts` and `scripts/check-openai-provider.test.ts`. No test calls the network.

### Subscription sign-in (ChatGPT and Grok plans)

Instead of an API key, the companion can use your ChatGPT Plus/Pro or Grok subscription:

```bash
npm run companion:login -- openai      # "Sign in with ChatGPT" in the browser
npm run companion:login -- xai         # Grok sign-in in the browser
npm run companion:login -- status      # who is signed in (never prints tokens)
npm run companion:login -- logout openai
STOME_PROVIDER=openai npm run companion   # or STOME_PROVIDER=xai
```

- An API key always wins: with `OPENAI_API_KEY` / `XAI_API_KEY` set, the companion uses the platform API and its billing. Unset it to use the subscription. The startup banner says which one is active.
- Tokens are stored in `~/.stome/auth.json` (file 0600, directory 0700; override with `STOME_AUTH_FILE`), refresh automatically about 2 minutes before expiry, and rotated refresh tokens are saved. Only the companion reads the file; the app never sees a token, and `/v1/status` reports none.
- **ChatGPT:** questions go to the ChatGPT backend (`chatgpt.com/backend-api/codex`, Responses API, streamed, `store: false`) with your access token and `ChatGPT-Account-Id`, billed to the plan. Only the Codex model set is served; the default is `gpt-5.5` (override with `STOME_MODEL`). That backend does not document Structured Outputs, so the JSON schema goes in the instructions and the shared parsers still reject anything malformed.
- **Grok:** the OAuth token is used as the bearer for the same `api.x.ai` Responses API, with the same strict JSON schema output as key mode.
- The sign-in reuses the vendors' public desktop CLI registrations (the Codex CLI's for OpenAI, the Grok CLI's for xAI), the same approach Strike and opencode take. Their loopback redirects are fixed: `localhost:1455` for ChatGPT and `127.0.0.1:56121` for Grok, so close the Codex or Grok CLI if one is holding that port. This is not an officially supported third-party integration: either vendor can change or block it, and using a subscription this way is subject to their terms.
- Tests: `scripts/check-subscription-auth.test.ts` covers PKCE, authorize URLs, token exchange and refresh with a fake token server, the store's file modes, and the ChatGPT request shape. No test signs in or calls a vendor.

## Session states

`idle → running → completed | failed | cancelled`

`completed`, `failed`, and `cancelled` can return to `running` only through **Continue**. A completed session with an unconfirmed proposal must be confirmed or discarded first. Confirming one proposal does not consume the next one: the confirmation flag applies to the current proposal, and the next turn clears it. The previous operation id still replays from `applied_ops` and `harness_operations`. A session still `running` when the harness database opens is marked `failed` with `interrupted`. A result that arrives after cancel, or after that restart, is discarded. If a saved chunk is missing when a run tries to finish, the run is marked `failed` instead of staying `running`.

## Tool and provider

The registry contains only `notes.proposeAnnotation` and `notes.proposeChunkEdit`. There is no plugin loader, shell tool, or filesystem tool. `notes.proposeChunkEdit` proposes a whole-body replacement for one selected chunk. The mock keeps the original text and appends `Mock edit (<chunk id>; messages=<prior count>): <prompt>`. The proposal stores that previous body and the chunk revision it read. Confirm writes `chunk.update` with `source: 'ai'` and `expectedRevision` set to the stored revision. A newer read is not substituted. Cancel, discard, a refused confirm, and a stale or missing chunk leave the saved text unchanged and add no AI row. Replaying the operation id does not write again. If the commit landed and the session record failed, the next confirm reads `applied_ops` before it checks the chunk, then repairs the session even if the chunk was edited or deleted afterward.

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

- Binds `127.0.0.1` only. It does not open a LAN port. An iPad cannot run `npm run companion`.
- Requires a pairing token that expires (default two hours). The deadline is computed once at process start. A later request does not extend it. `STOME_PAIRING_TTL_MS` must be a positive finite number of milliseconds.
- Rejects a non-loopback socket and a `Host` that is not `127.0.0.1` or `localhost` on its port.
- Accepts the configured `Origin` (default `http://localhost:8081`). It also accepts that web port on `http://127.0.0.1`, `http://localhost`, and `http://[::1]`, and `https` on those loopback names or a canonical private IPv4 address (`10/8`, `172.16/12`, `192.168/16`, `169.254/16`). `STOME_WEB_PORT` adds another port. Cleartext `http://192.168…` is rejected. Non-canonical addresses (leading zeros, decimal IPs) are rejected.
- On the laptop, the app sends the selected text and the token only after the companion URL is `http` on `127.0.0.1`, `localhost`, or literal IPv6 loopback, with no user or password in the URL. `http://[::1]` is accepted. An IPv4-mapped address such as `::ffff:127.0.0.1` is rejected before `fetch`.
- On a tablet, open `npm run web:lan` in Safari (`https://<laptop-lan-ip>:8081`) after trusting `.expo/web-cert/cert.pem`. The companion address must be that same https origin. The page proxies `/v1/status` and `/v1/tool` to `127.0.0.1:8787`. `http://127.0.0.1:8787` is the tablet itself and is refused. An https page is not allowed to call the companion's http port (mixed content). The proxy still requires the pairing token and does not serve those routes without it.
- Responses do not contain the pairing token or a provider key. The proxy does not log the token.
- While a confirmation is in progress, Ask, Continue, Cancel, and Discard stay disabled. Cancel is only enabled while a question is running.

Browser requests need the page origin to match. Expo web SQLite needs these headers on the HTML document, not only on the bundle:

- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: credentialless`

`metro.config.js` sets them on Metro responses. `npm run web:sqlite` also sets them on the document. A Chrome run at `http://localhost:8081` reported `crossOriginIsolated === true`. The document response carried `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless`. The pairing token was not in `localStorage` or `sessionStorage`, and the token field was empty after reload.

On that origin, Expo SQLite stored both databases in the origin private file system directory `expo-sqlite`. The file headers identified `/stome.db` (rooms, chunks, and foundation annotations) and `/stome-harness.db` (sessions, messages, and operation ids). The app path uses this real `expo-sqlite` web driver. `npm run check:harness` uses Node's `node:sqlite` for the session rules. The production queue itself is covered there by the same serializer the Expo adapter uses, one owner per connection, with the transaction callback on a direct executor. That Node run is still not a substitute for the browser `expo-sqlite` driver. iOS and Android were not run.

## Checks

`npm run check` already used by `.github/workflows/checks.yml` now includes `npm run check:harness`. That job still does not boot Expo web. Browser evidence is separate and uses the real `expo-sqlite` driver.
