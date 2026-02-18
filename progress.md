Original prompt: 跳跃检测出现了问题,  离的远一点, 尤其屏幕倾斜较大的时候, 跳跃检测非常不灵敏, 使劲跳都无法触发跳跃

## 2026-02-18
- Investigated `services/motionController.ts` jump detection logic.
- Found jump trigger relied on vertical-only (`Y`) displacement/velocity and fixed torso-stability gate (`torsoHeightRatio < 0.25`), which can under-trigger for distant user and tilted camera.
- Implemented adaptive jump detection improvements:
  - Added torso-axis lift projection derived from shoulder line normal to compensate camera tilt.
  - Added distance-aware and tilt-aware sensitivity boost to velocity/displacement thresholds.
  - Made torso stability gate adaptive (`0.25..0.48`) for far/tilted scenarios.
  - Added smoothed body/head X channels for 2D lift computation.
- Applied side-lane sensitivity pass for low-detection edges:
  - Added side compensation derived from lateral body offset (`|bodyCenter.x - 0.5|`).
  - Extended sensitivity boost with side factor (`+ sideCompensation * 0.38`), and relaxed stability gate/slack for edge positions.
  - Added head-velocity-assisted candidate path (body + head multi-signal fusion) to avoid missing jumps when torso signal jitters on sides.
  - Added dynamic required candidate frames (1-frame trigger for far/tilted/edge scenarios when pose coverage is acceptable).
  - Changed unstable-frame behavior from hard reset to decay (`-2`) to reduce missed jumps under brief pose jitter.

## TODO
- Run build and local gameplay verification to ensure no false-positive jump regressions.
- If needed, tune sensitivity constants after real-device feedback.
- Verification:
  - `npm run build` passed.
  - `npm run build` passed after side-lane sensitivity pass.
  - Ran Playwright client with action payload and inspected generated screenshots (temporary artifacts were cleaned up afterward).
  - Browser-driven manual flow reached theme selection, but gameplay start blocked by camera permission timeout in automation environment, so no end-to-end jump trigger validation was possible in CI/headless run.
- Observed console errors in local automation were environment-related (Service Worker on localhost + camera permission timeout), not from the motion controller patch.
- Next manual validation needed on real device with camera:
  - Far distance + high tilt jump should trigger within 1-2 strong jumps.
  - Verify no obvious false-positive jumps while standing still.

## 2026-02-18 (CDN Priority)
- Updated resource priority to CDN-first with same-origin fallback for non-Pose resources:
  - Added `getThemesListPrimaryUrl()` + `getThemesListFallbackUrl()` in `/Users/liushuai/github/jump_and_say/src/config/r2Config.ts`.
  - Switched themes list loading order to CDN first, local fallback in:
    - `/Users/liushuai/github/jump_and_say/services/assetLoader.ts`
    - `/Users/liushuai/github/jump_and_say/gameConfig.ts`
    - `/Users/liushuai/github/jump_and_say/game/scenes/PreloadScene.ts`
    - `/Users/liushuai/github/jump_and_say/game/scenes/MainScene.ts`
- Expanded Phaser loader fallback from `/assets/*` only to all CDN paths, so `/RAZ/*` assets now also try same-origin local fallback on failure.
- Changed font source priority to CDN first, local fallback second in:
  - `/Users/liushuai/github/jump_and_say/index.html`
  - `/Users/liushuai/github/jump_and_say/App.tsx`
- Added runtime fallback for theme cover images in `ThemeCardImage`:
  - If CDN cover fails, it retries with same-origin local path before marking as failed.

- Verification:
  - `npm run build` passed.
  - Ran Playwright client:
    - `node /Users/liushuai/.codex/skills/develop-web-game/scripts/web_game_playwright_client.js --url https://localhost:3000 --actions-file /Users/liushuai/.codex/skills/develop-web-game/references/action_payloads.json --iterations 2 --pause-ms 300 --screenshot-dir output/web-game-cdn-priority`
  - Playwright run captured one 404 console error in automation output; artifacts were cleaned up after verification.

## TODO
- Manually verify on Vercel staging/production:
  - Disable CDN temporarily and confirm fonts, `/assets/*`, and `/RAZ/*` can fall back to same-origin path.
  - Confirm theme list still loads when CDN is unreachable.
- If same-origin `/RAZ/*` is not available on Vercel, add rewrite/proxy or local mirror for `/RAZ/*`.
