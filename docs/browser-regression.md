# Browser regression smoke

One Chrome pass against the current Expo web app. It is not part of `npm run check` or GitHub Actions. It does not boot a simulator, sign a build, or call a live model.

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
- A successful edit proposal leaves the saved note unchanged until Confirm. Confirm refreshes the note immediately. Reload shows that edit once.
- A later chunk write, then Confirm, is rejected with "The chunk changed after the proposal." Reload keeps the later text. Confirming the restored proposal rejects it again.

The room screen has no control that edits a chunk body. Highlighting checks the chunk revision and does not bump it, so a person cannot make a pending proposal stale from the screen. The stale step writes the later text through the open Expo SQLite connection, then presses the real Confirm button. That is the product gap, not a second harness.

## Observed on `c830b7fcc4603f70fa72c815cd9f3a61d44c673a`

These are product gaps the smoke does not patch.

- Cancel sets "You cancelled this question. Saved chunks were not changed." The in-flight ask then replaces that with "You cancelled this question." The saved note stays unchanged either way.
- Confirming a stale edit does not refresh the room. The alert says the chunk changed, and the note card keeps the previous body until reload. Reload shows the later text and restores the proposal, which is rejected again.
- The room screen has no chunk editor. Saving a highlight checks the chunk revision and does not bump it, so a person cannot make a pending proposal stale from the screen. The stale step writes through the open Expo SQLite connection, then presses Confirm.

## What a pass does not prove

iOS, Android, and the Node `npm run check` suite are separate. `scripts/browser-harness.mjs` still drives the original notes screen. This smoke drives study rooms.
