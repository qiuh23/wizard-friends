# Player-owned graphics quality

Based on main `cbd81d465f3a76f22382201c36c5236360fa6934`. This change does not alter game rules, network authority, assets, keys, or release workflows.

## Quality and migration

- Missing, malformed or inaccessible `wizard-low-graphics` means high quality on phones and desktops. Existing string `true` remains low; `false` remains high. Main only wrote this key in the explicit settings setter, never while deriving the old mobile default, so there is no automatic value to erase.
- Viewport still controls camera, decoration placement, scale and readable fill/exposure. High quality now retains the rim, crystal and lantern point lights on portrait/compact screens. It uses the same four-point-light budget as desktop (two main candles plus crystal and lantern), four visible candle flames, existing glow geometry, DPR cap 2, and no real-time shadows. Compact layout still hides the book/deck/coins for card space, but no longer hides the high-quality crystal.
- Low mode remains the existing voluntary two-point-light mode. Settings are reversible. A storage failure does not prevent changing the current scene.
- The demand-driven scheduler is unchanged: ambient high ~30 Hz, low ~20 Hz; active card motion high requests the display frame, low ~30 Hz; paused/reduced-motion scenes sleep until invalidated.

## Advisory lifecycle and limits

`SlowFrameAdviser` observes rendered-frame timestamps and the preceding frame's requested delay from the actual shared `FrameScheduler`. These are scheduling/cadence observations, **not GPU time** or a hardware benchmark.

- Eligible only for a ready, high-quality, foreground, focused, unpaused game scene. No additional measurement RAF or permanent polling timer.
- Initial 5-second grace; at least 1.5 seconds after layout/resize or ineligible states; 2 seconds after focus/visibility changes. Gaps over 1 second and invalid/idle/future-work delays reset evidence.
- A late sample exceeds `max(80 ms, previous requested delay × 2.5)`. Normal intentional 33/50 ms spacing, 30 Hz displays and isolated hitches do not qualify.
- Two consecutive windows, each at least 2.5 seconds and 24 samples with at least 70% late samples, are needed. A healthy window breaks the sequence. A pending suggestion has 30 seconds to find a safe opening.
- Show only while waiting for another player during play, not during animation, prediction, trump choice, own turn, pause, reconnect, foresight, or open game panels. Measured cards, seats and controls are treated as obstacles. If no free viewport rectangle exists, defer without consuming the once marker.
- The non-modal notice never moves focus, pauses play, or changes graphics on its own. Only “降低画质” calls the existing `setLow(true)` path. Keep, Close, Escape, leaving the safe state, lost visibility, or ignoring for 12 seconds dismisses it without changing quality.
- On actual display, save `wizard-quality-hint-shown=true` in this origin's localStorage. This survives refresh, reconnect and later games. If storage is unavailable, fall back to once per current page. The normal settings menu always remains available. A manual settings selection suppresses further advice in the current page.

## Verification

- `npm run check`: syntax and strict UI types passed.
- `npm test`: all 415 tests passed. This includes real FrameScheduler replay; real TableScene animate/setLow methods with renderer stubs; sustained versus deliberate cadence; startup/focus/layout guards; persistence and blocked storage; hint keep/close/timeout/navigation/double-click lifecycle; and real Three/GLB loading.
- `SITE_EDITION=global npm run build`, `SITE_EDITION=cn npm run build`: passed; existing large-bundle warning unchanged.
- Global `npm run worker:check`: dry-run passed with an executor-local XDG config directory; no upload/deployment. The first attempt only failed to create the unavailable default home config path.
- Real GLB projection at 320×568, 390×844, 430×932, 667×275, 740×320, 844×390 and 932×430, switching high/low/high: passed. Adding the compact crystal revealed a small right-safe-area overflow; the existing candle boundary fitter now also fits the crystal mesh. Flame/lantern/crystal meshes remain outside the reserved HUD/hand bands. Glows are not treated as solid mesh bounds.
- Keyboard dismissal restores the preceding focus only when focus was inside the hint. No focus is moved merely by showing it.

DOM results are recorded after the final official preview pass.

The available browser has no WebGL1/2. CPU-side real Three/GLB geometry checks and DOM checks do not substitute for mobile GPU or visual 3D acceptance. No claimed actual-device FPS, thermal, or battery improvement. No manual deployment is part of this change; only the existing main release workflows may run after an authorized merge.
