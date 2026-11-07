# Stome

Stome stores local study rooms and notes in SQLite. Create, open, rename, and confirm deletion of rooms. Each room shows ordered note chunks with subject tags, optional source links, and highlight annotations. The existing Markdown import and original notes/companion screens remain available from the room list. There are no accounts or sync.

## Run

```bash
npm install
npx expo start
```

- `npm run web` starts the Expo web dev server. `metro.config.js` adds the COOP and COEP headers on bundled requests. In this SDK the HTML document from `expo start --web` does not include those headers.
- `npm run web:sqlite` serves that same dev server through `http://127.0.0.1:8081` and adds `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: credentialless` to the document. Browser SQLite needs those document headers. Expo itself listens on port 8082 in this mode.
- `npm run companion` starts the laptop-local mock AI companion. See `HARNESS.md` for the ask, confirm, and reload path. The companion does not call a live model.
- `npm run ios` and `npm run android` open a simulator or Expo Go when that tooling is installed.

Standard `expo-sqlite` is included in Expo Go. This project does not commit `ios/` or `android/` directories.

## Checks

Use Node `22.23.4` (`.nvmrc`). That release is inside Expo SDK 58's Node `^22.13.0` range, and it still accepts the SQLite and type-stripping flags in the schema script.

```bash
npm ci
npm run check
```

`npm run check` runs:

- `npm run typecheck` — `tsc --noEmit`
- `npm run lint` — `expo lint`
- `npm run check:schema` — note schema and migrations through Node's built-in `node:sqlite`
- `npm run check:harness` — harness sessions, mock provider, confirmation, and companion origin/token checks, also through `node:sqlite`

GitHub Actions runs `npm run check` on pull requests and on pushes to `main`. The harness checks were added to that existing script, not as a second workflow. The schema and harness scripts can print Node's experimental SQLite warning; a command passes when its assertions pass.

`npm run check:schema` and `npm run check:harness` use Node's built-in SQLite. They are not the Expo SQLite driver on iOS, Android, or web. `check:harness` does not replace opening the Expo web app. This workflow does not boot a simulator, sign a build, or call a live model API. Design-theme tests stay out of this check until that package is in the tree with its own lockfile-backed command.
