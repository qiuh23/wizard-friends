# Blender table and candle lighting integration

2026-11-12. Baseline: `4d61b8f950cd2d3c74a0700b6f4ccfa37bfff028` (`main`).
This is an implementation for review, not a completed visual or production acceptance.

## Changes

- `public/assets/wizard-v4/`: the original 16 GLBs, manifest and SHA-256 checksums.
  All delivered bytes are unchanged. Runtime loads ten asset types, about 1.33 MiB,
  rather than all six optional extra props. The two embedded textures are walnut
  (1024×1024) and felt (512×512); no external PNG request is needed.
- `src/rendering/wizard-assets.mjs`: per-table promise cache, actual GLTFLoader,
  atomic installation, exact flame/Orb lookup, fallback/retry and shared-resource
  disposal. Late loads after disposal cannot reattach. Failures log a diagnostic
  and retain the procedural table and original lights. A restored context retries
  a failed load; callers may also explicitly retry `scene.assets.load()`.
- `src/rendering/wizard-lighting.mjs`: supplied candle rig, with two defensive
  adjustments: detached wrappers cannot keep their lights on, and small hero
  layouts also obey the two-point-light mobile budget. Approved lighting-profile
  values are otherwise unchanged. No new animation loop or postprocessing.
- `src/table-scene.js`: keep book/orb/candle wrapper identity, resize transforms,
  gameplay card height `.382`, unlit gameplay faces, original rules and UI.
  Replace all eight specific old lights, remove detached old flame/glow visuals,
  update from the existing scheduler and restore/release on disposal.
- `tests/wizard-assets.test.js`, `tests/wizard-lighting.test.js`: asset integrity,
  actual Three node/material/geometry parsing, atomicity, retry, world transforms,
  mobile budgets, pause/reduced motion, visibility and release regressions.
- `scripts/wizard-assets-review.mjs`: reproducible local browser matrix using
  the real entry, legal six-player fixtures, hero/desktop/portrait/landscape/strip,
  high/low toggles, failure then retry, actual 16-file browser loads and context
  callbacks. Exports screenshots and renderer call/triangle/memory/timing data.
  No test-only globals or fixture hooks ship to production.

## Lighting and placement

Frame Y=-.395, felt Y=.3225, inlay Y=.352; tabletop scaling remains in the
existing resize method. The inlay reuses the original live trump material.
Corner plates remain inside the frame wrapper and hide below 851px, in strip,
or low power. Existing deck, coin group and their picking/layout behavior remain.

Book and orb retain their original wrappers with GLB child offsets -.1625 and
.405. The four candle records retain source order: left 1.15, right .85, left
.70, right 1.35. Candle bottoms are recalibrated to world Y=.36 after layout;
real point lights follow the resolved flame world positions. Normal desktop has
four point lights plus three weak fill lights; portrait/compact/low power and
small hero use two point lights and two fill lights. Default point shadows: zero.

## Verification completed in this cloud executor

- Node 24.22.1; `npm ci --cache /tmp/wizard-npm-cache` passed with lockfile
  unchanged. Default cache installation initially failed because the home cache
  was not writable; no dependency or build guard was bypassed.
- `npm run check`: JavaScript syntax and TypeScript passed.
- `npm test`: final combined run passed 369/369 tests, including the original
  356 regressions and 13 asset/lighting cases.
- `node --test tests/wizard-assets.test.js tests/wizard-lighting.test.js`: 13/13
  passed. Real Three r186 and GLTFLoader parse every delivered asset. Node tests
  stub texture creation and assert embedded PNG signatures; they do not exercise
  WebGL or browser texture uploads. Separate Pillow decoding succeeded for both
  embedded PNGs. This is not a claim of browser asset-load or GPU validation.
- `SITE_EDITION=global npm run build` and `SITE_EDITION=cn npm run build`: passed.
  Vite reports the existing large-scene-chunk warning; GLTFLoader increases the
  dynamically imported scene bundle. No renderer dependency was duplicated.
- `XDG_CONFIG_HOME=/tmp/wizard-wrangler-config WRANGLER_SEND_METRICS=false npm run worker:check`:
  global artifact check and Worker dry-run passed, including all 16 GLBs in the
  built assets. Temporary configuration storage was needed because the default
  home directory was not writable. This command did not deploy.
- A separate read-only code review found a semantic-retry cache issue: an asset
  with a missing Flame stayed cached after failure. The cache now releases and
  invalidates failed sources; missing-node → corrected-source retry is tested.
  Focused tests passed again and the follow-up review found no further issue.

## Browser blocker and remaining acceptance

Headless system Chromium fails at startup with `socket() failed: Operation not
permitted`, including an elevated attempt. The connected cloud browser also
cannot reach this executor's localhost (`ERR_CONNECTION_REFUSED`). No runnable
browser is available here. Accordingly, the original before screenshot, new
in-game screenshots, actual renderer.info/frame-time baseline, browser matrix,
and repeat-entry GPU memory observations have **not** been produced or passed.
The Blender preview was inspected only as an art reference, not as proof of the
integration. No synthetic image is presented as a game screenshot.

On a browser-capable machine, start the existing local services and run:

```sh
npm run dev:relay
npm run dev
GAME_URL=http://127.0.0.1:5173/ npm run test:assets
GAME_URL=http://127.0.0.1:5173/ npm run test:layout
GAME_URL=http://127.0.0.1:5173/ npm run test:cards
GAME_URL=http://127.0.0.1:5173/ npm run test:graphics
GAME_URL=http://127.0.0.1:5173/ npm run test:browser
GAME_URL=http://127.0.0.1:5173/ npm run test:refresh
```

`test:assets` supports `BROWSER_CHANNEL=chromium` or an explicit
`BROWSER_EXECUTABLE`. Its output belongs in `output/playwright/wizard-assets/`.
Review actual card readability, decoration occlusion, card selection/play/collect,
trump display, all 3–6-player layouts, repeated entry/exit, real context loss,
hidden/background pages and real iOS/Android performance. Callback-only context
tests and CPU object disposal are not substitutes for GPU recovery or leak tests.

## Delivery boundary

Separate branch and draft PR only. No merge, manual deployment, domain/account,
secret, game protocol, player data or deployment-workflow changes. Existing main
automatic deployment remains unchanged. A local build is not a production release.
