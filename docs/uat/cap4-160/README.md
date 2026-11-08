# CAP.4 (#160) browser UAT — global Quick Capture removed

Real-browser UAT for the removal of the global Quick Capture feature.

| | |
| --- | --- |
| Issue | #160 (CAP.4), closes #138 and #114 as obsolete |
| Source | commit `7572dba` on `chore/remove-quick-capture`, branched from `origin/main` `b40c499` |
| App | Expo web dev server (`npm run web:sqlite` → `scripts/serve-web.mjs`), Metro dev bundle |
| Browser | Google Chrome 156.0.8078.80, non-headless window, real mouse/keyboard input |
| URL | `http://127.0.0.1:8091/` |
| Runner | `cap4-uat.mjs` (puppeteer-core from `/tmp/stome-browser`, not a repo dependency) |
| Viewports | 390×844 and 1280×900, each in dark and light (`prefers-color-scheme`) |
| Recorded | 2026-11-07, four lanes, one recording per lane |
| Result | 110/110 assertions passed, 0 failures (`cap4-uat.json`, `cap4-uat.log`) |

This is browser UAT, not a unit test. The runner drove the real UI: created a room,
opened it, typed a note, pressed **Add note**, reloaded the page, and visited every
listed route. Screenshots and recordings come from that run; they are not from an
earlier build.

## Scenarios

| ID | Scenario | Evidence |
| --- | --- | --- |
| S1 | Rooms home shows no floating "Capture" pill, no `quick-capture*` testID | `screenshots/*-rooms-home.png` |
| S2 | Desktop sidebar has no "Quick capture" row and no `Alt+N` hint | `screenshots/desktop-*-rooms-home.png` |
| S3 | Phone tab bar keeps today / rooms / recent / search with no centre `+` (`tab-capture` absent) | `screenshots/phone-*-rooms-home.png` |
| S4 | `Alt+N` and `Ctrl+Alt+N` do nothing: no overlay, no route change, body text unchanged | `screenshots/*-after-shortcuts.png` |
| S5 | In-room "Add note" saves a chunk and it persists across reload | `screenshots/*-room-after-add-note.png`, `screenshots/*-room-after-reload.png` |
| S6 | Today shows no capture chrome (and keeps "Capture a note" → `/notes`) | `screenshots/*-today.png` |
| S7 | Recent / Search shows no capture chrome | `screenshots/*-recent.png` |
| S8 | Import shows no capture chrome | `screenshots/*-import.png` |
| S9 | Companion shows no capture chrome | `screenshots/*-companion.png` |

## Recordings

One recording per lane, each covering the lane from the initial `about:blank`
navigation through the final Companion screen.

| Lane | Recording | Recording metadata |
| --- | --- | --- |
| 390×844 dark | `cap4-phone-390x844-dark.webm` | `cap4-phone-390x844-dark.recording.json` |
| 1280×900 dark | `cap4-desktop-1280x900-dark.webm` | `cap4-desktop-1280x900-dark.recording.json` |
| 390×844 light | `cap4-phone-390x844-light.webm` | `cap4-phone-390x844-light.recording.json` |
| 1280×900 light | `cap4-desktop-1280x900-light.webm` | `cap4-desktop-1280x900-light.recording.json` |

## Recording limitations (stated, not hidden)

- The recordings are **sampled at roughly 4 fps**, not screen-refresh video. They are
  CDP screenshots of the exact bound page target, taken while the runner drove real
  input. Frame durations preserve real wall-clock spacing, so a capture gap plays as a
  held frame instead of speeding the video up.
- A few frames per desktop lane timed out during navigation (`firstCaptureError` in the
  recording metadata). Those moments are held frames, not missing interactions; the
  assertions and screenshots are the authoritative evidence.
- Each recording records its `targetId`, `startUrl` and `endUrl`, so the artifact can be
  tied to the tab that was driven.
- Chrome rendered at devicePixelRatio 2, so the video frames are 780×1688 and
  2560×1800 for the 390×844 and 1280×900 viewports.

## Not covered

- Native iOS/Android. This is web-only UAT; the change is pure JS deletion and the
  native bundle was not exercised.
- The React dev-only console warning about `accessibilityElementsHidden` /
  `importantForAccessibility` on the tab-bar SVG is pre-existing on `origin/main`
  (unchanged `RoomsGlyph`), not introduced here. It appears as the red dev toast in the
  phone screenshots.
