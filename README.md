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
- `npm run typecheck` runs TypeScript.
- `npm run check:schema` applies the note schema with Node's built-in SQLite. That check is not the Expo iOS or Android driver.

Standard `expo-sqlite` is included in Expo Go. This project does not commit `ios/` or `android/` directories.
