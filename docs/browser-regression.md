# Browser regression smoke

One Chrome pass against the current Expo web app, tracked by issue #93. `npm run check` and GitHub Actions do not run it. A green Node check is not browser coverage. The script does not boot a simulator, sign a build, or call a live model.

The script starts the mock companion and `scripts/serve-web.mjs`, then stops both. Puppeteer is loaded from outside this repo so `package.json` and `package-lock.json` stay unchanged. That is the same idea as `scripts/browser-harness.mjs`.

## Command

Use Node `22.23.4`. From the repo root, after `npm ci`:

```bash
mkdir -p /tmp/stome-browser
cd /tmp/stome-browser
npm init -y
npm install puppeteer-core
cd /path/to/stome
node scripts/browser-regression.mjs
```

Chrome defaults to `/usr/bin/google-chrome`. Override it with `CHROME_PATH`. The page origin is `http://localhost:8081/`, which is the companion's allowed origin. Screenshots and `report.json` go to `/opt/cursor/artifacts/browser-regression/`.

Set `STOME_REGRESSION_NO_SPAWN=1` and `STOME_PAIRING_TOKEN` only when the companion and document host are already running. The script generates the token otherwise. It never prints the token. Screenshots hide the pairing-token field.

## What a pass checks

Assertions use the room name, note text, and mock wording for this run. They do not expect a fixed room, chunk, or operation id.

- The document is cross-origin isolated and carries the SQLite headers.
- Create stays disabled until the room has a name.
- Creating a room and a note, then reloading, keeps both. The room is still on the list after another reload.
- Asking with an empty token does not write an answer.
- A mock ask shows a proposal without saving it. Confirm pins an AI answer, the note refreshes immediately, and reload still shows that answer. The token field is empty and the token is not in web storage.
- Mock timeout and provider error leave the saved note and the pinned answer unchanged.
- Cancelling a proposed note edit ends on "You cancelled this question." and does not write `Mock edit`.
- A successful edit proposal leaves the saved chunk unchanged until Confirm. The saved leaf outside the harness and the proposal card equals the complete proposal-before text. After Confirm, and again after reload, that same leaf equals the complete proposal-after text captured from the card. A selection preview inside the harness does not satisfy this check.
- A direct SQL `UPDATE` on the open Expo SQLite connection, then Confirm, is rejected with "The chunk changed after the proposal." Reload must show the proposal card again. Confirming that restored card is rejected again, and the saved leaf stays the later text. This is not a human edit. The room screen has no chunk editor. Issues #38 and #39, owned by emmyfong, cover that editor and autosave. This smoke does not patch them. Until a usable editor is on the screen, this step is not a human flow.
- The run fails if the page reported any unexpected error.
- Today, opened from the home screen, shows "Nothing due today" for a new note that has no review mark. Refresh and reload keep that empty state. There is no control on the room screen that writes a review mark, so this pass does not invent a due row.

## Spawn and identity

Spawn mode refuses to start when port 8081, 8082, or 8787 is already taken. It does not kill that listener. Readiness requires the spawned child to still be alive, the child's own "Document host" log, status 200, the SQLite document headers, and an Expo root marker. Any other HTML page is not treated as this checkout.

`SIGINT` and `SIGTERM` run one cleanup. Before that handler returns, it kills the Chrome process this script launched and the process groups it spawned (`serve-web.mjs`, including its Expo child, and `companion/server.ts`). It checks `/proc/<pid>/cmdline` and does not signal any other listener. A second signal does not start a second cleanup. A normal exit still asks those groups to stop, then kills them if they stay up.

The report's `checkoutSha` is this working tree. `productHead` is `git merge-base HEAD origin/main`. In spawn mode `server.mode` is `spawn` and `server.servedFromCheckout` is true. With `STOME_REGRESSION_NO_SPAWN=1`, `server.mode` is `external`, `servedFromCheckout` is false, and `servedSha` is null. That run does not claim the external server is the checkout. A spawn error or a child that exits before ready fails the run instead of accepting another page on the port.

## What this smoke does not patch

#85 owns the HarnessPanel cancel-copy and stale-reject refresh fixes. This script does not change `HarnessPanel`. A rejected confirm can leave the previous note body on the card until reload. The stale step is a direct SQL `UPDATE` on the open Expo SQLite connection. It is not a human edit. #80 owns the editor. Until that editor is usable, this step is not a human flow.

`npm run check` does not open Chrome. A green check is not browser coverage. iOS, Android, and a live model are not run.

## What a pass does not prove

iOS and Android were not run. `npm run check` is the Node suite only. `scripts/browser-harness.mjs` still drives the original notes screen. This smoke drives study rooms and the empty Today list.
