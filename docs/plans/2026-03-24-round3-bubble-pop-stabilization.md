# Round 3 Bubble Pop Stabilization Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rebuild Round 3 Bubble Pop into a stable, playable mode with reliable bubble spawning, hit detection, scoring, and round completion.

**Architecture:** Extract the wave-selection logic into a pure TypeScript helper so we can regression-test queue progression without Phaser. Rework the runtime bubble implementation to use physics-enabled image bodies with separate visual overlays, then reconnect `Round3BubblePopFlow` and `MainScene` so wave spawning happens after the scene layout is ready and cleans up correctly across retries, completion, and shutdown.

**Tech Stack:** TypeScript, Phaser 3 Arcade Physics, Node built-in test runner

---

### Task 1: Lock Bubble Wave Logic

**Files:**
- Create: `tests/round3BubblePopLogic.test.ts`
- Create: `game/modes/round3/round3BubblePopLogic.ts`

**Steps:**
1. Write a failing pure-logic regression test for queue shuffling, wave creation, and queue advancement.
2. Run the test with Node's built-in runner and confirm it fails for the expected missing logic.
3. Implement the minimal helper functions to make the test pass.
4. Re-run the test and confirm it passes.

### Task 2: Rebuild Bubble Runtime

**Files:**
- Modify: `game/systems/BubbleSystem.ts`

**Steps:**
1. Replace physics-enabled `Container` bubbles with physics image bodies plus non-physics overlay visuals.
2. Add explicit `spawnWave`, `clearWave`, `syncVisuals`, `popBubble`, and `destroy` lifecycle methods.
3. Keep bubble movement and collision behavior aligned with Arcade Physics world bounds.

### Task 3: Rebuild Round 3 Flow

**Files:**
- Modify: `game/modes/round3/Round3BubblePopFlow.ts`

**Steps:**
1. Initialize total question state and queue progression like the existing round flows.
2. Delay wave spawn until the scene has finished layout setup.
3. Rebuild correct / wrong hit handling, scoring, cooldowns, and round completion.
4. Reuse theme audio playback so the player gets a clear prompt before each wave.

### Task 4: Reconnect Scene Lifecycle

**Files:**
- Modify: `game/scenes/MainScene.ts`
- Modify: `game/modes/round3/Round3BubblePopMode.ts`

**Steps:**
1. Ensure Round 3 keeps its own responsive strategy instead of falling back to Round 2 defaults.
2. Hook Round 3 update, resize, completion, and shutdown paths into the rebuilt bubble flow.
3. Clear bubble state on mode exit, scene shutdown, destroy, and theme completion.

### Task 5: Verify End-to-End

**Files:**
- Verify only

**Steps:**
1. Run the pure logic regression test.
2. Run the production build.
3. Review the final diff to confirm no leftover dead paths remain in Round 3.
