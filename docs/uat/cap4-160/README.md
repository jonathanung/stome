# CAP.4 (#160) browser UAT — global Quick Capture removed

Browser UAT for the removal of the global Quick Capture feature.

| | |
| --- | --- |
| Issue | #160 (CAP.4); #138 and #114 close as obsolete |
| Source | UAT ran on `be446fa` (`chore/remove-quick-capture` rebased onto `origin/main` `9893b7e`); the feature is removed by the first commit on the branch, `9566328` |
| App | Expo web dev server (`npm run web:sqlite` → `scripts/serve-web.mjs`), Metro dev bundle |
| Browser | Google Chrome 156.0.8078.80, non-headless window |
| URL | `http://127.0.0.1:8091/` |
| Runner | `cap4-uat.mjs` (puppeteer-core from `/tmp/stome-browser`, not a repo dependency) |
| Viewports | 390×844 and 1280×900, each in dark and light (`prefers-color-scheme`) |
| Lanes | four, each in its own isolated browser context with its own empty database |
| Recorded | 2026-11-07, one recording per lane |
| Result | 138/138 assertions passed, 0 failures (`cap4-uat.json`, `cap4-uat.log`) |

The runner drove the real UI: created a room, opened it, typed a note, pressed
**Add note**, reloaded the page, visited every listed route, and followed Today's
"Capture a note" link. Screenshots and recordings come from that run, not from an
earlier build.

Input is a mix: primary interactions use real mouse clicks and keyboard typing
(room name, note body, **Add note**, sidebar/tab navigation, "Capture a note").
A few controls (the phone "add note" chrome button, the phone "rooms" tab) are
clicked through the DOM because fixed-position chrome can cover them in an
automated window; every resulting state change is still asserted from the DOM.

## Scenarios

| ID | Scenario | Evidence |
| --- | --- | --- |
| S1 | Rooms home shows no floating "Capture" pill and no `quick-capture*` testID; the list actually loaded | `screenshots/*-rooms-home.png` |
| S2 | Desktop sidebar has no "Quick capture" row and no `Alt+N` hint | `screenshots/desktop-*-rooms-home.png` |
| S3 | Phone tab bar keeps today / rooms / recent / search with no centre `+` (`tab-capture` absent) | `screenshots/phone-*-rooms-home.png` |
| S4 | `Alt+N` and `Ctrl+Alt+N` do nothing: no overlay, no route change, body text unchanged | `screenshots/*-after-shortcuts.png` |
| S5 | In-room "Add note" saves a chunk and it persists across reload | `screenshots/*-room-after-add-note.png`, `screenshots/*-room-after-reload.png` |
| S6 | Today loads ("Nothing due today"), shows no capture chrome, and keeps "Capture a note" | `screenshots/*-today.png` |
| S7 | Today's "Capture a note" still opens `/notes` | `screenshots/*-notes.png` |
| S8 | Recent / Search loads ("Recent notes") with no capture chrome | `screenshots/*-recent.png` |
| S9 | Import loads ("bring your notes") with no capture chrome | `screenshots/*-import.png` |
| S10 | Companion loads ("Pairing") with no capture chrome | `screenshots/*-companion.png` |

Each route check asserts both the absence of capture chrome and a route-specific
anchor, so a blank or failed navigation cannot pass.

## Recordings

One recording per lane, each starting before the first step and ending on Companion.

| Lane | Recording | Recording metadata |
| --- | --- | --- |
| 390×844 dark | `cap4-phone-390x844-dark.webm` | `cap4-phone-390x844-dark.recording.json` |
| 1280×900 dark | `cap4-desktop-1280x900-dark.webm` | `cap4-desktop-1280x900-dark.recording.json` |
| 390×844 light | `cap4-phone-390x844-light.webm` | `cap4-phone-390x844-light.recording.json` |
| 1280×900 light | `cap4-desktop-1280x900-light.webm` | `cap4-desktop-1280x900-light.recording.json` |

## Recording limitations (stated, not hidden)

- The recordings are **sampled at roughly 2–4 fps**, not screen-refresh video. They are
  CDP screenshots of the exact bound page target, taken while the runner drove the UI.
- Chrome sometimes times out a capture during a navigation. Those gaps collapse in the
  encoded video, so a recording is typically shorter than the lane's wall-clock duration
  (about 8 s of video for a 12 s lane). The `frames`, `fps` and `laneSeconds` fields in
  each `*.recording.json` state exactly what was captured. Assertions and screenshots are
  the authoritative evidence; the videos are for a human to skim.
- Each recording records its `targetId`, `startUrl` and `endUrl`, so the artifact can be
  tied to the tab that was driven.
- Chrome rendered at devicePixelRatio 2, so video frames are 780×1688 and 2560×1800 for
  the 390×844 and 1280×900 viewports.

## Not covered

- Native iOS/Android. This is web-only UAT; the change is pure JS deletion and the
  native bundle was not exercised.
- The React dev-only console warning about `accessibilityElementsHidden` /
  `importantForAccessibility` on the tab-bar SVG is pre-existing on `origin/main`
  (unchanged `RoomsGlyph`), not introduced here. It appears as the red dev toast in the
  phone screenshots.
