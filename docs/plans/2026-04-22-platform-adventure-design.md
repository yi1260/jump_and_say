# Platform Adventure Mode — Design Specification

> **Version:** 1.0
> **Date:** 2026-04-22
> **Status:** Draft — Awaiting Review
> **Replaces:** PlatformScene, MarioScene (existing prototypes)

---

## 1. Overview

### 1.1 Vision

Add a side-scrolling platform adventure mode to Jump And Say, replacing the existing keyboard-only PlatformScene/MarioScene prototypes with a **motion-controlled** (MediaPipe Pose) adventure that combines Mario-style running/jumping with English learning through **Learning Gates** (听音识图) and **Flash Card Blocks** (跟读发音).

### 1.2 Target Audience

Children aged 3–6. Zero frustration tolerance: no death, no game-over, bounce-back on enemy contact with minor score penalty.

### 1.3 Core Loop

```
Run freely (motion control) → Hit Flash Card Block (pronunciation) → Continue running → Enter Learning Gate (quiz 3 questions) → Continue running → ... → World exit
```

### 1.4 Design Decisions Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scene strategy | New `AdventureScene` (independent from MainScene) | Isolate from existing Round1/Round2 |
| Mode registration | `GameplayModeId = 'ADVENTURE'` via ModeRegistry | Reuse mode switching mechanism |
| Controls | Pure motion (MediaPipe Pose) | Consistent with Round1/Round2, no keyboard |
| Learning integration | Intermittent gates + flash card blocks | "Run a bit, learn a bit" rhythm |
| Death model | No death — bounce-back + score penalty | Child-friendly, no frustration |
| Shield system | Pronunciation reward → shield → smash enemies | Learning = power, positive feedback |
| Story structure | 5 worlds, linear progression | Simple narrative, clear progress |
| World switching | Same scene, config swap | Avoid multi-scene overhead |

---

## 2. Architecture

### 2.1 Layer Diagram

```
React Application (UI shell)
├── App.tsx (app container)
├── GameCanvas.tsx (Phaser container)
└── UI Components (LoadingScreen, CompletionOverlay, etc.)
│
└── Phaser Game
    ├── PreloadScene (asset preloading)
    ├── MainScene (existing Round1/Round2 stationary mode)
    └── AdventureScene (NEW — platform adventure mode)
        ├── AdventureModePlugin (mode plugin, registered in ModeRegistry)
        ├── AdventureFlow (flow controller, analogous to Round1PronunciationFlow)
        └── Sub-systems
            ├── PlatformPhysicsSystem (gravity, collision, terrain)
            ├── PlatformPlayerControlSystem (motion → character control, refactored from existing)
            ├── EnemySystem (enemy patrol AI, refactored from existing)
            ├── LearningGateSystem (replaces PlatformWordGateSystem)
            ├── FlashCardSystem (flash card pronunciation, reuses PronunciationSystem)
            ├── RewardSystem (reuses existing)
            ├── CameraSystem (side-scrolling camera follow)
            └── WorldConfigSystem (world/level config management)
```

### 2.2 Mode Registry Integration

```typescript
// Extend GameplayModeId
export type GameplayModeId = 'QUIZ' | 'BLIND_BOX_PRONUNCIATION' | 'ADVENTURE';

// ModeRegistry routes:
// 'ADVENTURE' → AdventureModePlugin → AdventureScene
```

### 2.3 System Reuse Matrix

| System | Reuse Strategy |
|--------|---------------|
| RewardSystem | Direct reuse — `playBlockExplosion`, `playQuizCollisionReward` |
| PronunciationSystem | Direct reuse — recording, scoring, confidence levels |
| PlayerControlSystem | Refactor PlatformPlayerControlSystem for motion input |
| CardSystem | Partial reuse — layout logic for gate quiz options |
| SceneUiSystem | Extend — add adventure HUD elements |
| EnemySystem | Refactor from PlatformEnemySystem |

### 2.4 Key Interfaces

```typescript
// AdventureModePlugin implements GameplayModePlugin
interface AdventureModePlugin extends GameplayModePlugin {
  getId(): 'ADVENTURE';
  onActivate(context: ModeContext): Promise<void>;
  onDeactivate(reason: ModeTransitionReason): void;
  onUpdate(time: number, delta: number): void;
  onResize(width: number, height: number): void;
}

// AdventureFlow — state machine controller
interface AdventureFlow {
  getState(): AdventureState;
  transitionTo(state: AdventureState): void;
  handlePlayerHitBlock(player: unknown, block: unknown): void;
  handlePlayerHitEnemy(player: unknown, enemy: unknown): void;
  handlePlayerHitGate(player: unknown, gate: unknown): void;
}
```

---

## 3. Five Worlds Design

### 3.1 World Overview

| # | World | terrainKey | Background | Enemies | Books (Learning Content) | Width |
|---|-------|-----------|------------|---------|--------------------------|-------|
| 1 | 🌿 Grassland | `grass` | `background_fade_trees` | slime_normal, snail, ladybug | Animals, Colors | 6000px |
| 2 | 🏜️ Desert | `sand` | `background_fade_desert` | slime_fire, worm_normal, mouse | Food, Body | 7000px |
| 3 | ❄️ Snow Mountain | `snow` | `background_color_hills` | slime_spike, worm_ring, snail | Actions + 1 new book | 8000px |
| 4 | ⛏️ Underground Cave | `stone` | `background_color_trees` (dark tint) | slime_block, saw, barnacle | 2 new books | 9000px |
| 5 | 💜 Mystic Purple | `purple` | `background_color_desert` (purple tint) | bee, fly, frog | 2 new books + Boss | 10000px |

### 3.2 World 1: Grassland Adventure (Tutorial)

- **Terrain**: Flat and wide, minimal floating platforms, 1 ramp
- **Enemies**: slime_normal ×2 (slow patrol), snail ×1 (very slow)
- **Learning Gates**: 3 gates (3 quiz questions each, drawn from Animals/Colors)
- **Flash Card Blocks**: 3 blocks (pronunciation from same books)
- **Decorations**: bush, fence, hill_top_smile
- **Coins**: Dense guided path, 3–5 per segment
- **Special**: 10-second directional arrow at start ("Go right!")
- **Width**: 6000px

### 3.3 World 2: Desert Mystery

- **Terrain**: Cactus obstacles, more floating platforms, 2 ramps, 1 bridge section
- **Enemies**: slime_fire ×2, worm_normal ×2, mouse ×1 (fast, requires jump dodge)
- **Learning Gates**: 3 gates (Food/Body questions)
- **Flash Card Blocks**: 4 blocks
- **Decorations**: cactus, rock, sand-related
- **Coins**: Medium density, some on floating platforms (encourage jumping)
- **Width**: 7000px

### 3.4 World 3: Snow Mountain Exploration

- **Terrain**: Many ramps (ramp_long/short), multi-level platform structures, slippery feel (optional: character acceleration)
- **Enemies**: slime_spike ×2, snail ×1, worm_ring ×2 (larger body)
- **Learning Gates**: 3 gates (Actions + new content)
- **Flash Card Blocks**: 5 blocks
- **Decorations**: snow, rock, hill
- **Coins**: Scattered on ramps and multi-level platforms
- **Width**: 8000px

### 3.5 World 4: Underground Cave

- **Terrain**: Many vertical walls, ladder sections, torch decorations, dark atmosphere
- **Enemies**: slime_block ×2 (jump patrol), saw ×2 (fixed path), barnacle ×1 (wall-mounted)
- **Learning Gates**: 3 gates
- **Flash Card Blocks**: 5 blocks
- **Decorations**: torch_on_a/b, chain, rock, brick_grey
- **Coins**: Along ladders and platform corners
- **Width**: 9000px

### 3.6 World 5: Mystic Purple (Final)

- **Terrain**: Purple terrain + cloud platforms (floating), many spring launch pads, lava zones
- **Enemies**: bee ×2 (flying patrol), fly ×2 (flying fast), frog ×1 (jump patrol)
- **Learning Gates**: 3 gates
- **Flash Card Blocks**: 6 blocks
- **Decorations**: gem (4 colors), purple_cloud, torch
- **Boss**: Large slime_block at world end — 3 flash card pronunciations to defeat
- **Exit**: sign_exit + flag, triggers completion celebration
- **Width**: 10000px

### 3.7 World Transitions

- Each world completion shows **World Settlement Screen** (star count + learned word review)
- Click continue → brief world transition animation (1–2 seconds), loads next world config + assets
- After all 5 worlds → overall settlement (reuse CompletionOverlay)

### 3.8 Difficulty Curve

```
Grassland → Desert → Snow → Cave → Purple
  Terrain:  Flat    +Bridge  +Ramp  +Ladder  +Cloud+Lava
  Enemies:  Slow    +Medium  +Large  +FixedPath +Flying
  Cards:    3       4        5       5         6
  Gates:    3       3        3       3         3
  Width:    6k      7k       8k      9k        10k
```

---

## 4. Core Gameplay

### 4.1 Motion Control Mapping

Consistent with existing Round1/Round2 motion input:

| Player Action | Body Motion | MediaPipe Signal | Game Effect |
|---------------|-------------|------------------|-------------|
| Move right | Lean right | `bodyX > 0.6` | Character runs right at constant speed |
| Stop / slow | Return to center | `0.4 < bodyX < 0.6` | Character decelerates to stop |
| Move left | Lean left | `bodyX < 0.4` | Character moves left (useful on platforms/ladders) |
| Jump | Quick upward motion | `isJumping = true` | Character jumps (800ms cooldown) |
| Hit / interact | Jump + horizontal direction | Jump collision with block | Triggers flash card / gate interaction |

**Key difference** from Round1/Round2: `bodyX` controls **character horizontal movement speed** (not lane selection). Character has a small default rightward drift (prevents getting stuck), motion input adds directional control.

### 4.2 Character State Machine

```
IDLE → RUN → JUMP → FALL → DUCK → CLIMB → HIT
  │      │      │      │      │      │      │
  └──────┴──────┴──────┴──────┴──────┴──────┘
       All states can return to IDLE
```

| State | Trigger | Assets | Description |
|-------|---------|--------|-------------|
| IDLE | bodyX centered + on ground | `character_beige_idle.svg` | Standing breathing |
| RUN | bodyX offset + on ground | `character_beige_walk_a/b.svg` alternating | Horizontal movement |
| JUMP | isJumping + on ground | `character_beige_jump.svg` | Rising phase |
| FALL | Airborne + descending | `character_beige_jump.svg` | Falling phase (reuse jump) |
| DUCK | bodyX centered + crouch gesture (optional) | `character_beige_duck.svg` | Dodge flying enemies |
| CLIMB | Touch ladder + bodyX aligned | `character_beige_climb_a/b.svg` alternating | Climbing ladder |
| HIT | Touch enemy (no shield) | `character_beige_hit.svg` | Bounce-back, 0.5s invincible |

### 4.3 Camera System

```typescript
// Smooth follow with deadzone
this.cameras.main.startFollow(player, true, 0.08, 0.08);
// Deadzone: player at left 1/3, 2/3 view ahead
this.cameras.main.setDeadzone(this.scale.width * 0.3, this.scale.height * 0.5);
// Camera bounds: never exceed world
this.cameras.main.setBounds(0, 0, worldWidth, worldHeight);
```

### 4.4 Coin Collection

- **Coin types**: coin_gold (10pts), coin_silver (5pts), coin_bronze (2pts)
- **Collection**: Auto-collect on contact, play coinSound
- **HUD**: Top-left coin count + score (reuse hud_coin / hud_character_* digit assets)
- **Layout**: Guided-line arrangement, directing player forward

### 4.5 Adventure State Machine

```
ADVENTURE_INIT
    → ADVENTURE_RUN
        ↔ ADVENTURE_FLASHCARD (hit flash card block)
        ↔ ADVENTURE_GATE (enter learning gate)
    → ADVENTURE_WORLD_COMPLETE (reach exit)
    → ADVENTURE_TRANSITION (world switch)
    → ADVENTURE_COMPLETE (all 5 worlds done)
```

| State | Trigger | Character | Motion Input | UI |
|-------|---------|-----------|--------------|-----|
| INIT | Enter scene | Standing | None | World title + start prompt |
| RUN | Init / learning complete | Free running | Move + Jump | HUD (score/coins/shield) |
| FLASHCARD | Hit glowing block | Stopped | Left+Right+Jump (select/confirm) | Flash card UI + mic HUD |
| GATE | Touch door | Stopped | Left+Right+Jump | Gate UI + 3 quiz options |
| WORLD_COMPLETE | Reach exit | Standing | None | Settlement (stars + words) |
| TRANSITION | Click continue | Hidden | None | World transition animation |
| COMPLETE | 5 worlds done | Hidden | None | Final settlement (CompletionOverlay) |

---

## 5. Learning Gate System

### 5.1 Physical Appearance

Each Learning Gate = `door_closed` + `lock_{color}` + 3 key icons above (indicating 3 questions).

The door blocks the running path. Character collides with door → door doesn't open → automatically triggers learning mode.

### 5.2 Gate Flow

```
Character hits door → Character stops + Camera locks
│
┌─────────────────────────────────────────────────┐
│ Inside Learning Gate (full-screen overlay)      │
│                                                  │
│ Question 1: Play word audio → Show 3 image opts │
│   → Move left/right to select → Jump to confirm  │
│   → Correct: 1 key lights up + small reward      │
│   → Wrong: Hint retry (max 2 attempts)           │
│                                                  │
│ Question 2: Same flow                            │
│ Question 3: Same flow                            │
│                                                  │
│ All 3 correct → door_closed → door_open animation│
│   → Character +1 shield (blue) → Door opens      │
│   → Continue running                             │
└─────────────────────────────────────────────────┘
```

### 5.3 Comparison with Existing Round2

| Existing Round2 | Learning Gate Version | Change |
|-----------------|----------------------|--------|
| Stationary, 3 blocks in front | Gate mode, 3 image options float above door | Layout shifts to above door |
| Move left/right to select answer | **Same** — bodyX controls selection | No change |
| Jump to confirm | **Same** — isJumping confirms | No change |
| Correct/wrong feedback | **Same** — RewardSystem explosion | No change |
| Question source | ThemeQuestion[] | Random 3 from current world's BookConfig.questions |

### 5.4 Door Lock Color per World

| World | Lock Color | Key Asset |
|-------|-----------|-----------|
| Grassland | blue | key_blue |
| Desert | red | key_red |
| Snow Mountain | green | key_green |
| Underground Cave | yellow | key_yellow |
| Mystic Purple | blue | key_blue |

---

## 6. Flash Card Block System

### 6.1 Physical Appearance

Flash Card Block = `block_exclamation_active` (glowing exclamation block, floating above running path).

Jump to hit block → Block disappears + explosion particles (RewardSystem) → Giant flash card pops out.

### 6.2 Flash Card Flow

```
Jump to hit glowing block → Block explosion (reuse RewardSystem.playBlockExplosion)
│
┌─────────────────────────────────────────────────┐
│ Flash Card Pronunciation (character paused)     │
│                                                  │
│ 1. Flash card image zooms from explosion point   │
│    (0.5s expand animation)                       │
│ 2. Auto-play word demonstration audio            │
│ 3. Show microphone HUD + 3-second countdown      │
│ 4. Recording window (3 seconds) → Wait for speech│
│ 5. Scoring:                                      │
│    - Success (confidence ≥ MEDIUM):               │
│      Card flies to HUD + random power-up reward   │
│      Reward types: shield / coin bonus / speed    │
│    - Failure: Allow 1 retry                       │
│    - 2nd failure: Card disappears, no reward      │
│      (doesn't block progress)                     │
│ 6. Flash card closes → Character resumes running  │
└─────────────────────────────────────────────────┘
```

### 6.3 Reward Table

| Pronunciation Score | Reward | Effect |
|---------------------|--------|--------|
| HIGH (≥0.8) | Gold shield (6s) | Gold aura, smash enemies +8pts each |
| MEDIUM (≥0.5) | Green shield (5s) | Green aura, smash enemies +5pts each |
| LOW (<0.5) 1st attempt | Allow retry | Return to step 3 |
| LOW (<0.5) 2nd attempt | Blue shield (3s) | Blue aura, prevent bounce but no attack |
| Both attempts fail | No reward | Card disappears, continue running (no penalty) |

### 6.4 Comparison with Existing Round1

| Existing Round1 | Flash Card Version | Change |
|-----------------|-------------------|--------|
| 3 blind box cards in front | 1 floating block on path | From "choose which to hit" to "hit and learn" |
| Hit → reveal → listen → read | **Same flow** | Core state machine identical |
| Max 3 retries | Max 1 retry | Reduce wait time, maintain running rhythm |
| Score → pure points | Score → power-up reward | Shields as learning rewards |

### 6.5 Learning Rhythm

```
Run ~15s → Flash Card Block (pronunciation) → Run ~10s → Learning Gate (3 questions) → Run ~15s → Flash Card → ...
```

- **Per world**: 3 gates + 3–6 flash cards ≈ 9–12 learning nodes
- **Single world duration**: ~3–5 minutes (running + learning mixed)
- **Total duration**: 5 worlds ≈ 15–25 minutes (suitable for 3–6 year attention span)

---

## 7. Enemy & Shield System

### 7.1 Enemy Catalog

| Type | Movement | Collision (no shield) | Collision (with shield) | Worlds | Assets |
|------|----------|----------------------|------------------------|--------|--------|
| slime_normal | Ground patrol (slow) | Bounce-back -5pts | Shield consumed, enemy destroyed, +3/+5/+8pts | Grassland | slime_normal_walk_a/b/rest |
| slime_fire | Ground patrol (medium) | Bounce-back -8pts | Same | Desert | slime_fire_walk_a/b/rest |
| slime_spike | Ground patrol (fast) | Bounce-back -10pts | Same | Snow | slime_spike_walk_a/b/rest |
| slime_block | Jump patrol | Bounce-back -10pts | Same | Cave | slime_block_jump/walk_a/b/rest |
| snail | Ground patrol (slowest) | Bounce-back -3pts | Same | Grass/Snow | snail_walk_a/b/rest |
| worm_normal | Ground crawl (slow) | Bounce-back -5pts | Same | Desert | worm_normal_move_a/b/rest |
| worm_ring | Ground crawl (medium) | Bounce-back -8pts | Same | Snow | worm_ring_move_a/b/rest |
| mouse | Fast running | Bounce-back -8pts | Same | Desert | mouse_walk_a/b/rest |
| ladybug | Flying patrol (low) | Bounce-back -3pts | Same | Grassland | ladybug_fly/walk_a/b/rest |
| saw | Fixed path (H/V) | Bounce-back -12pts | Same | Cave | saw_a/b/rest |
| barnacle | Wall-mounted | Bounce-back -5pts | Same | Cave | barnacle_attack_a/b/rest |
| bee | Flying patrol (medium) | Bounce-back -8pts | Same | Purple | bee_rest |
| fly | Flying patrol (fast) | Bounce-back -5pts | Same | Purple | fly_a/b/rest |
| frog | Jump patrol | Bounce-back -10pts | Same | Purple | frog_idle/jump/rest |

### 7.2 Bounce-Back Mechanism (No Death)

```
Character hits enemy (no shield):
1. Play hit animation → character_beige_hit.svg (0.5s)
2. Character bounces back 150px in opposite direction + small upward throw (200px)
3. Score penalty: 3–12 pts based on enemy type (minimum 0, never negative)
4. 1 second invincibility (flashing effect)
5. Resume normal control
```

```
Character hits enemy (with shield):
1. Shield consumed → shield visual disappears
2. Enemy destroyed → explosion particles + enemy disappears
3. Score bonus: shield color determines points (blue +3 / green +5 / gold +8)
4. No bounce-back, no pause
5. Continue running normally
```

### 7.3 Shield System

Reuses and enhances existing PlatformScene shield system:

| Shield | Source | Duration | Visual | Smash Bonus |
|--------|--------|----------|--------|-------------|
| 🔵 Blue | Flash card LOW / Gate all correct | 3s | Blue aura, weak pulse | +3/enemy |
| 🟢 Green | Flash card MEDIUM | 5s | Green aura, medium pulse | +5/enemy |
| 🟡 Gold | Flash card HIGH | 6s | Gold aura, strong pulse + star particles | +8/enemy |

**Shield HUD**: Top-right corner, shield icon + remaining time bar (reuse existing shieldIconText/shieldTimerText).

**Shield stacking rule**: New shield replaces old (no duration stacking). Higher tier takes priority.

### 7.4 Boss Area (World 5 Only)

```
Boss = Large slime_block (3× normal size)
Boss behavior: Jumps back and forth in fixed area
Boss HP: 3 flash card pronunciations

Loop 3 times:
  Player jumps to hit glowing block on Boss
  → Flash card pronunciation (World 5 questions)
  → Pronunciation success: Boss -1 HP + screen shake
  → Pronunciation failure: Allow retry

All 3 successful → Boss explosion (large particles) → Path opens → sign_exit + flag
```

---

## 8. Data Flow & State Management

### 8.1 Core Data Structures

```typescript
/** World configuration — complete definition per world */
interface WorldConfig {
  worldId: string;           // 'grass' | 'sand' | 'snow' | 'stone' | 'purple'
  worldIndex: number;        // 0–4
  title: string;             // World display title
  terrainPrefix: string;     // 'terrain_grass' / 'terrain_sand' / ...
  backgroundKey: string;     // Background image asset key
  width: number;             // World width in pixels
  enemies: EnemySpawnDef[];
  learningGates: LearningGateDef[];
  flashCardBlocks: FlashCardBlockDef[];
  coins: CoinDef[];
  decorations: DecorationDef[];
}

/** Enemy spawn point */
interface EnemySpawnDef {
  enemyType: string;   // 'slime_normal' | 'slime_fire' | ...
  x: number;           // Spawn position
  patrolRange: number; // Patrol radius
}

/** Learning Gate */
interface LearningGateDef {
  x: number;                                    // Gate position
  lockColor: 'blue' | 'red' | 'green' | 'yellow';
  questions: ThemeQuestion[];                    // 3 quiz questions (drawn from BookConfig)
}

/** Flash Card Block */
interface FlashCardBlockDef {
  x: number;                  // Block position
  y: number;                  // Usually 128px above ground block
  word: ThemeQuestion;        // Flash card content
}

/** Adventure progress (persisted across worlds within session) */
interface AdventureProgress {
  currentWorldIndex: number;     // Current world 0–4
  totalScore: number;            // Total score
  totalCoins: number;            // Total coins
  totalWordsLearned: number;     // Words learned count
  wordsLearned: string[];        // Learned word list (deduplicated)
  shieldsEarned: number;         // Total shields earned
  worldsCompleted: number[];     // Completed world indices
}
```

### 8.2 Mode Bridge: Adventure ↔ React

```typescript
// React → AdventureScene
GameCanvas passes mode='ADVENTURE'
  + Theme data (questions/images/audio)
  + RuntimeCallbackBridge (score/gameOver etc.)

// AdventureScene → React
RuntimeCallbackBridge (extended):
  onScoreUpdate(score: number, total: number): void;
  onGameOver(): void;
  onBackgroundUpdate(index: number): void;
  onWorldComplete(worldIndex: number, progress: AdventureProgress): void;     // NEW
  onAdventureComplete(progress: AdventureProgress): void;                     // NEW
```

### 8.3 Save Strategy

- **Runtime**: `AdventureProgress` stored on AdventureScene instance, lost on scene destroy
- **Cross-session save**: Not in V1 scope
- **In-world checkpoints**: Each passed learning gate is a checkpoint. Character falling off world bottom respawns at last checkpoint.

---

## 9. Asset Mapping (Kenney SVG → 5 Worlds)

### 9.1 Terrain Assets

Each terrain type has complete block/top/vertical/cloud/ramp/horizontal series:

| Purpose | Grassland | Desert | Snow | Cave | Purple |
|---------|-----------|--------|------|------|--------|
| Ground block | `terrain_grass_block_top` | `terrain_sand_block_top` | `terrain_snow_block_top` | `terrain_stone_block_top` | `terrain_purple_block_top` |
| Solid block | `terrain_grass_block` | `terrain_sand_block` | `terrain_snow_block` | `terrain_stone_block` | `terrain_purple_block` |
| Floating platform | `terrain_grass_horizontal_*` | `terrain_sand_horizontal_*` | `terrain_snow_horizontal_*` | `terrain_stone_horizontal_*` | `terrain_purple_horizontal_*` |
| Vertical wall | `terrain_grass_vertical_*` | `terrain_sand_vertical_*` | `terrain_snow_vertical_*` | `terrain_stone_vertical_*` | `terrain_purple_vertical_*` |
| Ramp | `terrain_grass_ramp_*` | `terrain_sand_ramp_*` | `terrain_snow_ramp_*` | `terrain_stone_ramp_*` | `terrain_purple_ramp_*` |
| Cloud platform | `terrain_grass_cloud_*` | `terrain_sand_cloud_*` | `terrain_snow_cloud_*` | `terrain_stone_cloud_*` | `terrain_purple_cloud_*` |
| Block edges | 9-piece set: `terrain_*_block_top_left/right` etc. | Same | Same | Same | Same |

### 9.2 Background Assets

| World | Background | Notes |
|-------|-----------|-------|
| Grassland | `background_fade_trees.svg` | Gradient green trees |
| Desert | `background_fade_desert.svg` | Gradient desert |
| Snow Mountain | `background_color_hills.svg` | Solid hills (white/blue tint) |
| Underground Cave | `background_color_trees.svg` | Solid trees (dark tint: 0x333333) |
| Mystic Purple | `background_color_desert.svg` | Solid desert (purple tint: 0x9966CC) |
| All worlds | `background_clouds.svg` | Cloud overlay (shared) |

### 9.3 Character Assets

| Purpose | Asset | Notes |
|---------|-------|-------|
| Default character | `character_beige_*` | 9 animation states |
| Alternate characters | `character_pink/green/purple/yellow_*` | Future unlock rewards |
| HUD avatar | `hud_player_beige.svg` | Top-left life/character icon |

**V1 strategy**: Only beige character. Other colors as future unlock rewards.

### 9.4 Enemy Assets

| World | Enemy | Assets |
|-------|-------|--------|
| Grassland | slime_normal | `slime_normal_walk_a/b.svg`, `slime_normal_rest.svg` |
| Grassland | snail | `snail_walk_a/b.svg`, `snail_rest.svg` |
| Grassland | ladybug | `ladybug_walk_a/b.svg`, `ladybug_fly.svg`, `ladybug_rest.svg` |
| Desert | slime_fire | `slime_fire_walk_a/b.svg`, `slime_fire_rest.svg` |
| Desert | worm_normal | `worm_normal_move_a/b.svg`, `worm_normal_rest.svg` |
| Desert | mouse | `mouse_walk_a/b.svg`, `mouse_rest.svg` |
| Snow | slime_spike | `slime_spike_walk_a/b.svg`, `slime_spike_rest.svg` |
| Snow | worm_ring | `worm_ring_move_a/b.svg`, `worm_ring_rest.svg` |
| Cave | slime_block | `slime_block_walk_a/b.svg`, `slime_block_rest.svg` |
| Cave | saw | `saw_a/b.svg`, `saw_rest.svg` |
| Cave | barnacle | `barnacle_attack_a/b.svg`, `barnacle_attack_rest.svg` |
| Purple | bee | `bee_rest.svg` (+ code-driven fly animation) |
| Purple | fly | `fly_a/b.svg`, `fly_rest.svg` |
| Purple | frog | `frog_idle.svg`, `frog_jump.svg`, `frog_rest.svg` |

### 9.5 Props & Decoration Assets

| Purpose | Asset | Scope |
|---------|-------|-------|
| Coins (3 tiers) | `coin_gold.svg`, `coin_silver.svg`, `coin_bronze.svg` | Universal |
| Flash card block (glowing) | `block_exclamation_active.svg` | Universal |
| Flash card block (hit) | `block_exclamation.svg` | Universal |
| Door (closed) | `door_closed.svg` + `door_closed_top.svg` | Universal |
| Door (open) | `door_open.svg` + `door_open_top.svg` | Universal |
| Locks (4 colors) | `lock_blue/red/green/yellow.svg` | Per world color |
| Keys (4 colors) | `key_blue/red/green/yellow.svg` | Per world color |
| Spring | `spring.svg` / `spring_out.svg` | Universal |
| Ladder | `ladder_top/middle/bottom.svg` | Cave mainly |
| Bridge | `bridge.svg` / `bridge_logs.svg` | Desert mainly |
| Torch | `torch_on_a/b.svg` / `torch_off.svg` | Cave exclusive |
| Cactus | `cactus.svg` | Desert exclusive |
| Bush | `bush.svg` | Grassland exclusive |
| Fence | `fence.svg` | Grassland exclusive |
| Rock | `rock.svg` | Desert / Snow |
| Snow | `snow.svg` | Snow exclusive |
| Gems (4 colors) | `gem_blue/green/red/yellow.svg` | Purple decoration |
| Flags | `flag_{color}_a/b.svg` | Exit marker |
| Exit sign | `sign_exit.svg` | Exit |
| Heart | `heart.svg` | HUD life |
| Bomb | `bomb.svg` / `bomb_active.svg` | Cave decoration |
| Lava | `lava.svg` / `lava_top.svg` | Purple hazard |
| Water | `water.svg` / `water_top.svg` | Grassland/Desert decoration |
| Chain | `chain.svg` | Cave decoration |
| Rope | `rope.svg` | Universal decoration |

### 9.6 HUD Assets

| Purpose | Asset |
|---------|-------|
| Coin icon | `hud_coin.svg` |
| Life | `hud_heart.svg`, `hud_heart_half.svg`, `hud_heart_empty.svg` |
| Shield (4 colors) | `hud_key_blue/green/red/yellow.svg` (reuse key icons) |
| Digits 0–9 | `hud_character_0~9.svg` |
| Multiply/percent | `hud_character_multiply.svg`, `hud_character_percent.svg` |
| Character avatar | `hud_player_beige.svg` |
| Reward assets | `star.svg`, `mushroom_brown/red.svg`, `gem_*.svg`, `card.svg` |
| Feedback text | `excellent.svg`, `great.svg`, `try_again.svg` |

---

## 10. Error Handling & Edge Cases

### 10.1 Motion Input Failures

| Scenario | Handling |
|----------|----------|
| MediaPipe not loaded | Fall back to touch controls (left/right buttons + jump button) |
| Pose lost mid-game | Character auto-slows, show "Move into camera view" prompt |
| Jump false-positive | 800ms cooldown prevents rapid double-jumps |

### 10.2 Learning Flow Failures

| Scenario | Handling |
|----------|----------|
| Speech recognition unavailable | Skip pronunciation, auto-award blue shield (lowest) |
| Audio file missing | Flash card shows text only, no demo audio |
| All 3 gate questions failed | Still open gate after 3rd attempt (no soft-lock) |
| Flash card 2nd attempt fails | Card disappears, continue running (no block) |

### 10.3 Physics Edge Cases

| Scenario | Handling |
|----------|----------|
| Character falls off world bottom | Respawn at last checkpoint (learning gate) |
| Character stuck in terrain | Auto-unstick: teleport to nearest valid ground position |
| Enemy patrol overlap | Enemies ignore each other, no stacking issues |
| Camera exceeds world bounds | `cameras.main.setBounds()` prevents out-of-bounds |

---

## 11. Performance Considerations

### 11.1 Asset Loading

- **PreloadScene**: Load only World 1 assets initially
- **World transition**: Load next world assets during transition animation (1–2s window)
- **SVG rendering**: Kenney SVGs are simple vectors — no texture atlas needed
- **Audio caching**: Reuse existing audioController blob URL cache (max 48 entries)

### 11.2 Runtime Performance

- **Object pooling**: Reuse Phaser sprite pools for coins, enemies, particles
- **Off-screen culling**: Enemies/coins outside camera view skip update logic
- **Physics simplification**: Static terrain group (no per-frame body updates for ground)
- **Particle budget**: Max 50 active particles simultaneously

### 11.3 Mobile Optimization

- **World width**: Wider worlds split into chunked sections for rendering
- **DPR adaptation**: Reuse existing GameCanvas quality profiles (iPad/Mobile/Desktop)
- **Touch fallback**: If MediaPipe unavailable, show on-screen control buttons

---

## 12. Scope & Non-Goals

### In Scope (V1)

1. AdventureScene with 5 worlds
2. Motion-controlled running, jumping, climbing
3. Learning Gates (3 per world, Round2-style quiz)
4. Flash Card Blocks (3–6 per world, Round1-style pronunciation)
5. Bounce-back enemy system (no death)
6. Shield system (pronunciation reward)
7. Boss fight (World 5)
8. World completion settlement
9. Coin collection and score tracking

### Out of Scope (V1)

1. Cross-session save / progress persistence
2. Character color selection / unlock system
3. Multiplayer or leaderboards
4. Custom level editor
5. Advanced physics (water swimming, wind zones)
6. IAP or monetization integration
7. Accessibility features beyond touch fallback
8. A/B testing or analytics integration

---

## 13. File Structure Plan

### New Files

```
game/
├── scenes/
│   └── AdventureScene.ts              (NEW — main adventure scene)
├── modes/
│   └── adventure/
│       ├── AdventureModePlugin.ts     (NEW — mode plugin)
│       └── AdventureFlow.ts           (NEW — flow controller, state machine)
├── systems/
│   ├── PlatformPhysicsSystem.ts       (NEW — terrain, gravity, collision)
│   ├── PlatformPlayerControlSystem.ts (REFACTOR — motion input)
│   ├── EnemySystem.ts                 (REFACTOR — from PlatformEnemySystem)
│   ├── LearningGateSystem.ts          (NEW — replaces PlatformWordGateSystem)
│   ├── FlashCardSystem.ts             (NEW — flash card pronunciation)
│   ├── CameraSystem.ts                (NEW — side-scrolling camera)
│   └── WorldConfigSystem.ts           (NEW — world config management)
├── data/
│   └── worldConfigs.ts                (NEW — 5 world configurations)
```

### Modified Files

```
game/modes/core/types.ts               (EXTEND — add 'ADVENTURE' to GameplayModeId)
game/runtime/ModeRegistry.ts           (EXTEND — register AdventureModePlugin)
game/scenes/PreloadScene.ts            (EXTEND — load adventure assets)
components/GameCanvas.tsx              (EXTEND — support 'ADVENTURE' mode)
types.ts                               (EXTEND — add AdventureProgress, WorldConfig types)
```

### Deleted Files (after Adventure is stable)

```
game/scenes/PlatformScene.ts           (DELETE — replaced by AdventureScene)
game/scenes/MarioScene.ts              (DELETE — replaced by AdventureScene)
game/systems/PlatformWordGateSystem.ts (DELETE — replaced by LearningGateSystem)
```

---

## 14. Verification & Testing

### 14.1 Manual Smoke Tests

1. **Motion control**: Run left/right, jump, climb ladder
2. **Learning Gate**: 3 quiz questions, correct/wrong feedback, door opens
3. **Flash Card Block**: Hit block, pronunciation flow, shield reward
4. **Enemy collision**: Bounce-back (no shield), shield smash (with shield)
5. **World completion**: Reach exit, settlement screen, transition to next world
6. **Boss fight**: World 5 boss, 3 pronunciations, victory
7. **Full playthrough**: All 5 worlds, 15–25 minutes
8. **Device coverage**: iPad, Android phone, desktop browser
9. **Orientation switch**: Portrait ↔ landscape, HUD adapts
10. **Audio recovery**: Background/foreground switch, camera/audio resume

### 14.2 Build Verification

```bash
npm run build  # Must pass with 0 errors
```

### 14.3 LSP Diagnostics

All new/modified files must show zero TypeScript errors via `lsp_diagnostics`.

---

## Changelog

### 2026-04-22
- Initial design specification created
- 7 sections: Architecture, Worlds, Gameplay, Learning Gates, Flash Cards, Enemies/Shields, Assets
- Based on 6-round brainstorming session with user (方案A: 探险故事流)
- Replaces PlatformScene and MarioScene prototypes
