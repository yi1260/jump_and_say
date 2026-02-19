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

## 2026-02-19 (ZCOOL UI subset)
- Added ZCOOL UI subset optimization for first-screen Chinese text:
  - Generated subset font: `/Users/liushuai/github/jump_and_say/public/assets/fonts/Zcool/zcool-kuaile-ui-subset.woff2` (~54KB).
  - Source character list saved at: `/Users/liushuai/github/jump_and_say/public/assets/fonts/Zcool/ui_zh_chars.txt` (306 glyphs).
- Updated font stack and faces to use subset-first strategy:
  - New face `ZCOOL KuaiLe UI` points to subset file.
  - Existing full `ZCOOL KuaiLe` kept as fallback for missing glyphs.
  - Updated stacks in:
    - `/Users/liushuai/github/jump_and_say/index.html`
    - `/Users/liushuai/github/jump_and_say/App.tsx`
    - `/Users/liushuai/github/jump_and_say/game/scenes/MainScene.ts`
- Added maintenance script:
  - `/Users/liushuai/github/jump_and_say/scripts/build-zcool-ui-subset.sh`
  - Rebuilds `ui_zh_chars.txt` and subset WOFF2 from current UI files.
- Verification:
  - `npm run build` passed after subset integration.

## 2026-02-19 (Jump robustness + in-app guidance)
- Reworked jump detection in `/Users/liushuai/github/jump_and_say/services/motionController.ts` to be more robust for distance/angle variance:
  - Replaced pure-Y jump signal with torso-axis projected lift (`bodyLift/headLift`) using vector from hip center to shoulder center.
  - Added smoothed X channels for body/head (`smoothedBodyX`, `smoothedHeadX`) and axis velocity fusion.
  - Added adaptive sensitivity based on distance (`smoothedTorsoHeight`), side offset (`|bodyCenter.x-0.5|`), and shoulder tilt.
  - Relaxed fixed torso-stability gate to adaptive jitter gate (`maxTorsoJitter`) and changed unstable-frame behavior to decay candidate frames instead of hard reset.
  - Added head-assisted candidate path to reduce misses when torso keypoints jitter.
- Added user-facing motion guidance:
  - New `MotionGuidance` type in `/Users/liushuai/github/jump_and_say/types.ts`.
  - Added `getJumpGuidance()` in motion controller with real pose-driven guidance codes/messages (`ready/no_pose/move_closer/move_back/center_body/reduce_tilt`).
  - Wired guidance into `/Users/liushuai/github/jump_and_say/App.tsx` and rendered message under the camera HUD in realtime.
- Verification:
  - `npm run build` passed.
  - Ran Playwright skill client against `https://localhost:3001` and inspected screenshot output (`output/web-game-jump-robust-3001/shot-0.png`) and console errors (`errors-0.json`).
  - Automation screenshot remained at early blank scene; end-to-end camera/jump behavior still requires real-device camera validation.

## TODO
- Real-device validation required (phone/iPad with real camera):
  - Far distance + tilted camera should trigger jump within 1-2 strong jumps.
  - Verify standing still does not produce false positives.
  - Verify guidance text transitions correctly when intentionally too far/too close/off-center/tilted.
- If false positives appear, tune in `services/motionController.ts`:
  - `sensitivityBoost` weights
  - `thresholdScale` lower bound
  - `requiredCandidateFrames` fast-trigger condition

## 2026-02-19 (Pose abort freeze fix + main guidance voice)
- Addressed repeated `Pose send error RuntimeError` / `Aborted(native code called abort())` handling in `/Users/liushuai/github/jump_and_say/services/motionController.ts`:
  - Added fatal-send detection (`runtimeerror/abort/wasm`) and consecutive error counter.
  - Added automatic pose runtime recovery after threshold errors:
    - close broken pose instance
    - clear `this.pose`
    - re-run `init()`
    - continue frame loop instead of returning permanently when pose is temporarily null.
  - Throttled fatal error logging to reduce console flood and UI jank.
- Updated guidance UI/UX in `/Users/liushuai/github/jump_and_say/App.tsx`:
  - Removed tiny guidance text from camera preview card.
  - Added large top-center main-screen guidance banner for non-menu phases.
  - Added speech synthesis broadcast for warning guidance with throttling (code-change or 5s interval) and audio unlock attempt.
  - Added speech cleanup/cancel during camera teardown and unmount.
- Verification:
  - `npm run build` passed.
- Pending manual validation on iPad Safari:
  - Confirm abort loop self-recovers within a few seconds without freezing.
  - Confirm main banner readability.
  - Confirm speech playback volume/voice quality and no over-frequent repeats.

## 2026-02-19 (Remove all user guidance + jump robustness focus)
- Removed all user-facing distance/angle guidance text and speech output:
  - Deleted `MotionGuidance` type from `/Users/liushuai/github/jump_and_say/types.ts`.
  - Removed guidance state/render/speech logic from `/Users/liushuai/github/jump_and_say/App.tsx`.
  - Removed guidance generation API and related text payloads from `/Users/liushuai/github/jump_and_say/services/motionController.ts`.
- Jump algorithm was further refactored to prioritize robustness across distance/tilt/side positions:
  - Added torso-length aware normalization (`smoothedTorsoLength`) and axis-confidence blending (torso axis blended with global vertical when pose is unstable).
  - Switched to normalized lift space:
    - body/head axis positions (`smoothedBodyAxisPos`, `smoothedHeadAxisPos`)
    - adaptive baseline tracking (`baselineBodyAxisPos`, `baselineHeadAxisPos`)
    - normalized displacement/velocity (`combinedLiftNorm`, `combinedLiftVelocityNorm`).
  - Added dynamic noise-aware thresholds:
    - velocity/displacement floors adapt to tracking jitter (`smoothedLiftVelocityAbs`, `smoothedLiftNoise`).
  - Added multi-path candidate strategy:
    - strong body candidate
    - head-assisted candidate
    - burst candidate for fast jumps.
  - Added dynamic candidate frame requirement based on tracking noise and sensitivity boost.
  - Updated jump re-arm to use adaptive negative-lift threshold (`rearmLiftThreshold`) instead of fixed threshold.
- Pose runtime fatal error auto-recovery logic remains in place (`abort`/`RuntimeError` path) to reduce freeze loops.
- Verification:
  - `npm run build` passed.

## TODO
- Real-device validation on iPad/phone camera:
  - Near / middle / far distances with same jump action.
  - Camera pitched up/down and slightly rotated left/right.
  - Side standing positions (left edge / right edge of frame).
  - Ensure no obvious false positives while standing still.
- If still misses at far + high tilt, tune only these constants in `/Users/liushuai/github/jump_and_say/services/motionController.ts`:
  - `distanceCompensation` formula
  - `velocityThreshold` / `displacementThreshold` base terms
  - `requiredCandidateFrames` rule and `rearmLiftThreshold`.

## 2026-02-19 (Systematic jump adaptation for top-edge + far/tilt)
- Refined jump detection to explicitly handle two weak cases:
  1. Head close to top frame edge.
  2. Far distance with large camera tilt.
- Core upgrades in `/Users/liushuai/github/jump_and_say/services/motionController.ts`:
  - Added shoulder-axis channels (`smoothedShoulderAxisPos`, `baselineShoulderAxisPos`) and baseline sync on `calibrate()`.
  - Added top-edge context (`boxTopY`) and head reliability decay when head is near frame top.
  - Replaced single-axis projection with multi-axis fusion:
    - torso-up axis
    - shoulder-line normal axis
    - global vertical fallback (down-weighted at high roll).
  - Switched jump signal to weighted fusion of body/head/shoulder lift, with weights adapting to head reliability.
  - Added context-aware robustness boost using distance + tilt + side + pose coverage + top-edge pressure.
  - Added dynamic thresholds and gating:
    - adaptive velocity/displacement thresholds
    - adaptive torso jitter gate and min pose coverage gate
    - adaptive re-arm threshold.
  - Candidate strategy now includes:
    - strong body candidate
    - body+shoulder synchronous candidate
    - head-assisted candidate (only when head is reliable)
    - burst candidate.
- Build verification:
  - `npm run build` passed.

## TODO
- Real-device validation required on iPad:
  - Head near top edge (without stepping back) should still trigger jump within 1-2 clear jumps.
  - Far + strong tilt should still trigger reliably.
  - Standing still should not false-trigger.
- If still under-sensitive in edge cases, tune constants in `services/motionController.ts`:
  - `topEdgeCompensation`, `headReliability` curve
  - `robustnessBoost` weights
  - `velocityThreshold`/`displacementThreshold` lower bounds
  - `requiredCandidateFrames` fast-trigger condition.

## 2026-02-19 (Sensitivity recovery after over-tight thresholds)
- User reported jump became non-sensitive in almost all scenarios.
- Rebalanced detection toward high sensitivity while keeping context adaptation:
  - Added baseline bootstrap/warmup (`baselineInitialized`, `poseWarmupFrames`) to avoid bad initial baseline and over-tight early thresholds.
  - Added shoulder channel to jump signal (`smoothedShoulderAxisPos`, `baselineShoulderAxisPos`) so detection does not rely too heavily on head.
  - Head-near-top-edge compensation now explicitly reduces head influence and shifts weight to body+shoulder channels.
  - Lowered threshold floors significantly and redesigned adaptive scaling (`adaptFactor`) to reduce under-triggering in real usage.
  - Candidate logic changed from strict single-path gating to score-based multi-signal voting + burst fallback.
  - Adaptive 1-frame trigger now engages in hard scenarios (`adaptFactor > 0.45`) for responsiveness.
- Verification:
  - `npm run build` passed.

## TODO
- Immediate device retest requested by user for sensitivity:
  - normal stance (middle distance)
  - head close to top edge
  - far + high tilt
- If still under-sensitive, next tuning targets:
  - `velocityThreshold` base constant `0.58`
  - `displacementThreshold` base constant `0.095`
  - `candidateScore` gate (currently >=2 or burst fallback).
