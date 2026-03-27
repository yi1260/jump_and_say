# Round 3 Bubble Pop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a new "Bubble Pop" game mode where 3 semi-transparent bubbles containing word cards fall slowly from the top. The player moves freely horizontally and jumps to hit the correct bubble based on a TTS prompt.

**Architecture:** We will create a new `Round3BubblePopMode` implementing `GameplayModePlugin`. We will add a `BUBBLE_POP` `GameplayModeId` and a new `BubbleSystem` to manage the lifecycle, physics, and rendering of the falling bubbles. We'll modify `PlayerControlSystem.ts` or add `Round3PlayerControlSystem.ts` to support continuous horizontal tracking based on `bodyX` instead of the 3-lane system, and we will disable the top boundary collision.

**Tech Stack:** Phaser 3 (Arcade Physics, Particles, Graphics), TypeScript.

---

### Task 1: Define Mode Types and Constants

**Files:**
- Modify: `game/modes/core/types.ts`
- Modify: `game/runtime/ModeRegistry.ts` (if it exists)

- [ ] **Step 1: Add new `GameplayModeId`**
  Modify `GameplayModeId` type in `game/modes/core/types.ts` to include `'BUBBLE_POP'`. Add `'round3-bubble-pop'` to `ResponsiveLayoutStrategyId`.
- [ ] **Step 2: Add host methods for Round 3 in `GameplayModeHost`**
  Add `setupRound3ThemeData(theme: Theme): void;` and `handleRound3PlayerHitBubble(player: unknown, bubble: unknown): void;` (or similar) to `GameplayModeHost` interface in `game/modes/core/types.ts`.
- [ ] **Step 3: Update `ModeRegistry.ts`**
  Import and register `Round3BubblePopMode` (which we will create next) in `game/runtime/ModeRegistry.ts` if a registry exists there.
- [ ] **Step 4: Commit**
  ```bash
  git add game/modes/core/types.ts game/runtime/ModeRegistry.ts
  git commit -m "feat: add BUBBLE_POP mode types and registry"
  ```

### Task 2: Create Round3BubblePopMode Plugin

**Files:**
- Create: `game/modes/round3/Round3BubblePopMode.ts`
- Create: `game/modes/round3/Round3BubblePopFlow.ts`

- [ ] **Step 1: Implement the plugin class**
  Create `Round3BubblePopMode` class implementing `GameplayModePlugin` in `game/modes/round3/Round3BubblePopMode.ts`. Similar to `Round2QuizMode.ts`, but setting mode id to `BUBBLE_POP` (or `ROUND3_BUBBLE_POP`) and layout strategy to `'round3-bubble-pop'`.
- [ ] **Step 2: Create basic Flow class**
  Create `Round3BubblePopFlow.ts` to manage the game logic (TTS prompt, spawning 3 bubbles, handling correct/wrong hits, scheduling next round).
- [ ] **Step 3: Commit**
  ```bash
  git add game/modes/round3/
  git commit -m "feat: create Bubble Pop mode plugin and flow classes"
  ```

### Task 3: Continuous Horizontal Player Movement

**Files:**
- Modify: `game/systems/PlayerControlSystem.ts` (or `game/scenes/MainScene.ts`)

- [ ] **Step 1: Update Player Controller to support continuous movement**
  Modify `PlayerControlSystem.ts` so that when `scene.isBubblePopMode()` (or checking the current mode ID), instead of calculating `targetLaneIndex` and `targetX` via lanes, it directly maps `motionController.smoothedState.bodyX` linearly to the viewport width.
  ```typescript
  // Example pseudo-code
  if (scene.currentModeId === 'BUBBLE_POP') {
     const continuousX = effectiveState.bodyX * scene.stableViewportWidth;
     scene.player.x = Phaser.Math.Linear(scene.player.x, continuousX, 0.3);
  } else {
     // fallback to lane index logic
  }
  ```
- [ ] **Step 2: Remove Top Boundary**
  In the Scene creation or Mode enter phase, set the world bounds collision for the top edge to false: `scene.physics.world.setBoundsCollision(true, true, false, true);`
- [ ] **Step 3: Adjust Player Head Hitbox**
  Adjust the player sprite physics body size and offset so the upper half (head) is the primary collision area, making header hits easier and more forgiving.
- [ ] **Step 4: Commit**
  ```bash
  git add game/systems/PlayerControlSystem.ts
  git commit -m "feat: support continuous player horizontal movement and disable top collision"
  ```

### Task 4: Bubble Rendering & Physics System

**Files:**
- Create: `game/systems/BubbleSystem.ts`

- [ ] **Step 1: Create Bubble System Class**
  Create a new class `BubbleSystem.ts`. It will be responsible for creating a Phaser `Group` of bubbles with Arcade Physics enabled.
- [ ] **Step 2: Configure Bubble Physics**
  When spawning bubbles, give them a circular body `body.setCircle(radius)`, high bounce `body.setBounce(0.8)`, and collide with world bounds (except top). Add self-collision `scene.physics.add.collider(bubbleGroup, bubbleGroup)`.
- [ ] **Step 3: Render Bubble Visuals**
  Create a function to draw the bubble graphics (a transparent circle with a slight white rim/highlight) using `scene.add.graphics()` or an image, and put the word/image card as a child or render texture inside it. Apply a subtle scaling tween to the bubble container to give it a "breathing" or "jelly" effect.
- [ ] **Step 4: Commit**
  ```bash
  git add game/systems/BubbleSystem.ts
  git commit -m "feat: implement bubble system physics and rendering"
  ```

### Task 5: Bubble Hit Logic & Effects

**Files:**
- Modify: `game/systems/BubbleSystem.ts`
- Modify: `game/modes/round3/Round3BubblePopFlow.ts`

- [ ] **Step 1: Implement Player-Bubble Collision Detection**
  Add overlap/collider between `scene.player` and `bubbleGroup`. When the player jumps into a bubble, check if the bubble is the `correct` one based on its data payload.
- [ ] **Step 2: Wrong Answer Effect (Bounce)**
  If wrong, apply an upward/angled velocity and angular velocity to the bubble (e.g., `bubble.body.setVelocity(Phaser.Math.Between(-100, 100), -500); bubble.body.setAngularVelocity(300);`). Play a "Boing" sound.
- [ ] **Step 3: Correct Answer Effect (Pop)**
  If correct, destroy the bubble graphic, emit a particle burst at its coordinates, and scale up the word card (tween it to center screen). Play "Pop" sound and TTS "Excellent! [Word]".
- [ ] **Step 4: Commit**
  ```bash
  git add game/systems/BubbleSystem.ts game/modes/round3/Round3BubblePopFlow.ts
  git commit -m "feat: implement bubble hit collision logic and pop effects"
  ```

### Task 6: Game Loop & Polish

**Files:**
- Modify: `game/modes/round3/Round3BubblePopFlow.ts`

- [ ] **Step 1: Implement Wave Spawning**
  Wait for TTS to announce "Where is the [Word]?". After 1 second, call `BubbleSystem.spawnWave(theme, correctIndex, wrongIndices)`. The bubbles start falling with a slow Y velocity.
- [ ] **Step 2: Handle Bubble Ground Reset**
  If a bubble hits the ground, it should naturally bounce back up due to `setBounce(0.8)`. We just need to ensure the system doesn't delete it or fail the game, so the player can keep trying.
- [ ] **Step 3: Trigger Next Wave**
  After the correct bubble is popped and the 1-2 second reward animation finishes, clear remaining bubbles (`bubble.destroy()`) and trigger the next wave or round completion.
- [ ] **Step 4: Commit**
  ```bash
  git add game/modes/round3/Round3BubblePopFlow.ts
  git commit -m "feat: finalize bubble pop game loop and wave spawning"
  ```
