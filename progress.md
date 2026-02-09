Original prompt: MoveNet Lightning 或 MediaPipe Pose Lite 这两个你推荐用哪个? 然后直接帮我改成这种方案吧, 完全替代之前的face的方案

- Plan: Switch motion detection to MediaPipe Pose Lite to preserve existing MediaPipe pipeline and CDN fallback while reducing model complexity.
- Updated dependencies and CDN loader to MediaPipe Pose Lite; swapped caching rules for /mediapipe/pose.
- Rewrote motionController to use Pose landmarks for move/jump detection with adaptive calibration.
- Updated index.html CDN loader to MediaPipe Pose Lite and adjusted PWA caching for /mediapipe/pose.
- Test attempt: dev server starts only with escalated permissions; Playwright client failed because `playwright` package is missing.
- Next: run `npm install` (or install `playwright`) and re-run the Playwright loop.
- Updated live view to draw Pose landmark skeleton overlay, removed face mask UI, and exposed pose landmarks for UI rendering.
- Reduced motion smoothing and lowered internal frame throttle to improve responsiveness.
- Ensured MediaPipe CDN caching accepts opaque responses (status 0) and skipped re-init when Pose is already ready.
- Added explicit Pose asset prewarm into Cache Storage after init to reduce re-entry load time.
- Fixed Pose loader timeout so it only fires when Pose is still not loaded; cancels timer and hides overlay once loaded.
- Added in-session caching for theme preloads and game asset preloads to avoid long loading on repeated entries.
- Added per-asset timing logs with cache detection heuristics for game assets and theme images.
