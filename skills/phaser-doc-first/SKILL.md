# phaser-doc-first

## Purpose
Enforce documentation-first changes for any Phaser-related implementation.

## When to use
Use this skill whenever the task changes code that depends on Phaser APIs, including:
- Scene lifecycle (`init`, `preload`, `create`, `update`)
- Arcade physics (bodies, collisions, overlap, velocity)
- Loader, texture/audio cache, asset pipeline
- Input, camera, tween, animation, timer, sound
- Game config and Phaser plugin/runtime integration

## Required workflow
1. Identify the exact Phaser API(s) being changed.
2. Open the official docs for those API(s):
   - https://docs.phaser.io/api-documentation/3.88.2/api-documentation
   - https://photonstorm.github.io/phaser3-docs/
3. Verify signature, lifecycle timing, defaults, and side effects.
4. Implement changes strictly aligned with documented behavior.
5. In the final response, cite the relevant API page(s) used.

## Guardrails
- Do not guess Phaser method names/params.
- Do not change Phaser lifecycle ordering without docs evidence.
- Do not introduce undocumented behavior assumptions.
- If docs and runtime behavior differ, note the mismatch explicitly and choose the safer documented path first.

## Completion checklist
- [ ] Official API pages were consulted before coding.
- [ ] Changed code matches documented parameter and return types.
- [ ] Lifecycle-sensitive logic is placed in the correct scene phase.
- [ ] Final response includes the consulted API references.
