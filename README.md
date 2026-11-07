# Stome

Minimal Expo app for local study notes. Notes are stored in SQLite on the device. This scaffold has no accounts, server, or document import.

The starting screen uses plain local styles so a separate theme can replace them.

## Run

```bash
npm install
npx expo start
```

- `npm run web` starts the Expo web dev server. `metro.config.js` adds the COOP and COEP headers on bundled requests. In this SDK the HTML document from `expo start --web` does not include those headers, so browser SQLite needs a host that sends them on the document too.
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

GitHub Actions runs those same commands on pull requests and on pushes to `main`. The schema script can print Node's experimental SQLite warning; the command passes when its assertions pass.

`npm run check:schema` is not the Expo SQLite driver on iOS or Android. This workflow does not boot a simulator, sign a build, or call a network API. Design-theme tests stay out of this check until that package is in the tree with its own lockfile-backed command.
