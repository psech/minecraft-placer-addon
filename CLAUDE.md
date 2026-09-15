# CLAUDE.md

Minecraft Bedrock Add-on (target runtime: **Bedrock 1.26.45**) that adds a **Placer** block — a Dispenser-like block that, on redstone activation, places one block from its 9-slot inventory directly in front of itself. Full spec: `docs/Minecraft Bedrock Add-on_ Placer Block.md`.

## Guiding principles

1. **Verify APIs against the actual 1.26.45 runtime, not just documentation.** Bedrock docs frequently describe APIs that are missing, renamed, or behave differently in a given release. Never call nonexistent APIs or make speculative API assumptions. If an API is experimental or version-dependent, say so explicitly.
2. **Don't retry approaches already proven unsupported by the runtime.** If an experiment in-game showed something doesn't work, record it here and move on to an alternative.
3. **Existing code is a guide, not a working solution.** Swapping approaches (e.g., `@minecraft/server` module versions, form libraries, storage strategies) is encouraged when it gets closer to the goal. Experimentation is welcome.
4. **The Placer should feel like a vanilla block, not a scripted form pretending to be one.** Prefer native vanilla container UI/behaviour wherever the Add-on API permits; fall back to JSON UI, then scripted forms, in that order.
5. **Narrow scope.** The Placer only places blocks. Do not implement general Dispenser behaviour (water buckets, bone meal, projectiles, minecarts).
6. **Incremental phases.** Work follows the phases in the spec doc (orientation → inventory → UI → hoppers → placement → edge cases). Don't rewrite working phases unnecessarily — Phase 2 (dynamic-property inventory) is done and should not be gratuitously rewritten.

## Code style

Production-quality code, not proof-of-concept:

- Clear module/function boundaries; small testable functions.
- Constants instead of magic values.
- Defensive validation (see `getInventory` in `src/behavior_pack/scripts/main.js` for the established pattern).
- Meaningful logging prefixed `[Placer]`.
- Comments explaining **Bedrock-specific** behaviour and quirks — that's where the non-obvious complexity lives.
- No dead code, no unused functions.
- JSDoc-style comments on functions, following the existing style in `main.js`.

## Architecture notes

- **UI (Phase 3 decision, 2026-08-30):** the container screen is a **JSON-UI-restyled ActionForm** (Chest-UI technique, adapted under CC BY 4.0). Native vanilla container UI was ruled out after doc research: custom blocks have no inventory/container component (format 1.26.40), script has no API to open a container screen, and the invisible-entity workaround offers no 3×3 `container_type`, unreliable raycast targeting, and extraction-only hopper support. Do not re-litigate without new API evidence. Mechanism: the form title carries invisible marker `§p§l§a§c§e§r`; `resource_pack/ui/server_form.json` hides the vanilla long form and shows `placer_ui` (in `ui/placer_form.json`) when the marker is present. Button order is fixed: 0–8 Placer slots, 9–44 player container slots 0–35 (every slot gets a button, empty ones use empty text and are hidden/unclickable — form `selection` indices count hidden buttons). Icons render via the aux-value trick: numeric icon string = vanilla item ID × 65536 (map in `scripts/ui/typeIds.js`, vendored — update from upstream Chest-UI on new Minecraft versions); `textures/...` strings render as flat images. Note: any other add-on that also overrides `server_form.json` will conflict.
- **Interaction model:** click-to-transfer (whole stacks), form reopens after each move. Deposits are filtered to placeable blocks (`BlockTypes.get`) — matches the Placer's scope and prevents NBT loss, since storage keeps only `typeId + amount`.
- **Block definition:** `src/behavior_pack/blocks/placer.json`. Orientation uses the `minecraft:placement_direction` trait with the `minecraft:facing_direction` state (all 6 directions, like a Dispenser; switched from 4-way `minecraft:cardinal_direction` on 2026-09-15) plus `minecraft:transformation` rotation permutations. The un-rotated front is the **south** material instance; front = opposite of the state value (place looking down → front faces up). With a vertical front, the hopper logic excludes the above/below hopper instead of a horizontal side.
- **Custom component:** `placer:placer`, registered in `main.js` via `system.beforeEvents.startup` → `blockComponentRegistry`. Handles `onPlayerInteract` (UI), `onTick` (hopper transfers), `onRedstoneUpdate` (activation), `onPlayerBreak` (cleanup).
- **Hoppers (Phase 4):** script-simulated from the Placer's side in `scripts/hoppers.js`, driven by the `minecraft:tick` block component at a fixed `[8, 8]` interval (the vanilla hopper cooldown; `onTick` without `minecraft:tick` on the block is a content error). Per cycle: one item in from a down-facing hopper above and from each horizontal hopper whose spout (`facing_direction`: 0=down, 2=N, 3=S, 4=W, 5=E) points into the Placer — never through the front — and one item out to a hopper directly below (vanilla hoppers only pull from directly above themselves, so side extraction doesn't exist). `toggle_bit` (redstone-locked) hoppers are skipped; non-placeable items stay in the feeding hopper (slots scanned in order, first acceptable item moves).
- **Inventory storage:** world dynamic properties, one JSON string per Placer, keyed `placer:<dimensionId>:<x>:<y>:<z>`. Slots are `{ typeId, amount } | null`, 9 entries. This gives per-block persistence that survives `/reload all`.
- **Manifests:** BP depends on RP by UUID and on `@minecraft/server` 2.9.0 + `@minecraft/server-ui` 2.1.0. Keep BP/RP `header.version` in sync — CI fails if they disagree, and release tags `vX.Y.Z` must match the manifest version.

## Icon recipe

The container UI renders vanilla items in 3D via aux IDs, but custom blocks have no stable numeric ID, so `placer:placer` uses a pre-rendered isometric icon (`resource_pack/textures/ui/placer_icon.png`). Regenerate it with ImageMagick when block textures change (16×16 sources → 64×64 icon; top unshaded, side ×0.80 on the left face, front ×0.60 on the bottom-right face — vanilla item renders face bottom-RIGHT, verified against Dispenser/Dropper 2026-08-30):

```bash
magick \
 \( <top>.png -virtual-pixel transparent +distort Perspective '0,0 32,0  16,0 64,16  16,16 32,32  0,16 0,16' \) \
 \( <side>.png -channel RGB -evaluate Multiply 0.80 +channel -virtual-pixel transparent +distort Perspective '0,0 0,16  16,0 32,32  16,16 32,64  0,16 0,48' \) \
 \( <front>.png -channel RGB -evaluate Multiply 0.60 +channel -virtual-pixel transparent +distort Perspective '0,0 32,32  16,0 64,16  16,16 64,48  0,16 32,64' \) \
 -background none -layers merge +repage -background none -extent 64x64 PNG32:placer_icon.png
```

Note: `placer_side`/`placer_top` in terrain_texture.json point at vanilla `furnace_side`/`furnace_top` — fetch those from Mojang/bedrock-samples when regenerating.

The 256×256 `pack_icon.png` (same file in both packs) uses the same projection ×4, but for crisp pixel edges each source must be pre-upscaled (`-filter point -resize 256x256`) and distorted with `-interpolate Integer`, with source coordinates 0..256 and destination coordinates ×4 (top `128,0 / 256,64 / 128,128 / 0,64`; left `0,64 / 128,128 / 128,256 / 0,192`; right `128,128 / 256,64 / 256,192 / 128,256`) — distorting the raw 16px textures directly comes out blurry regardless of filter settings.

## Phase 6 backlog (updated 2026-09-15)

1. **Explosion-safe drops** — DONE, verified in-game (2026-09-15): `onPlayerBreak` → `onBreak` in `main.js`; TNT-destroyed Placers drop their contents. `onBreak` permits synchronous world mutation (spawnItem + dynamic-property writes) even during explosions — no deferral needed.
2. **Placement validity** — CLOSED as accepted limitation (2026-09-15): `Block.canPlace` does NOT exist in v26.40 (the backlog's candidate was wrong; verified against docs), and no other placement-validity API exists. A support-needing block (torch, rail, flower) placed into air floats until a block update pops it — harmless quirk, no item loss, and vanilla has no reference behaviour (dispensers eject rather than place). A deny-list of attachable blocks was considered and rejected (ages badly). Prior decision stands: no item→block alias map for redstone components.
3. **Protected areas** — CLOSED as vanilla-consistent (2026-09-15): spawn protection restricts players, not machines — a vanilla dispenser also operates inside protected areas — and the script surface has no API to query protection anyway.
4. **Rapid-pulse torture test** — PASSED (2026-09-15): comparator clock + Placer full of sand (sand falls away, self-clearing the front — pistons are too slow to keep up with a fast clock, so gravity blocks are the right test rig). One block placed per rising edge until the inventory drained; no double-places, no errors. Bonus finding: gravity blocks placed via `setType` convert to falling blocks normally. Still unreported from this round: TNT-drop verification (backlog item 1) and the adjacent-Placers-sharing-a-feed scenario.

Pending runtime verification (6-way facing, implemented 2026-09-15 — move up once confirmed):

- `minecraft:facing_direction` stores the player's look direction including `up`/`down` (assumed to match the verified `cardinal_direction` semantics; front = opposite of state).
- Up/down rotation signs: state `up` → `[90, 0, 0]`, state `down` → `[-90, 0, 0]` in placer.json — if the front texture ends up on the wrong vertical face in-game, swap the two.
- Vertical-front behaviour: placement into the block above/below, and hopper exclusion of the front (a hopper above must not insert into an up-facing Placer; a hopper below must not extract from a down-facing one).
- **Migration note:** Placers placed before this change carried a `cardinal_direction` state that no longer exists on the block — expect them to reset to the default orientation (or misbehave); they may need breaking and re-placing.

## Development & testing workflow

- The maintainer tests on a **separate Windows 11 machine** where the packs are symlinked as development packs; they pull from GitHub and run `/reload all` in-game. **Do not suggest export/import cycles** for development iteration.
- This means you **cannot run or test the add-on from this machine** — in-game verification results come from the maintainer. When a change needs runtime confirmation, say exactly what to test and what output/behaviour to expect.
- There is no build step for development — scripts are plain JS loaded directly from `src/behavior_pack/scripts/`. `scripts/build.ps1` and CI only produce distributable `.mcpack`/`.mcaddon` archives.

## Runtime findings log

Record confirmed runtime behaviour here so it isn't re-litigated:

- `minecraft:cardinal_direction` via the `minecraft:placement_direction` trait works in 1.26.45.
- The `placer:placer` custom component and `onRedstoneUpdate` fire correctly (verified via `[Scripting][warning]` log output).
- World dynamic properties persist inventories across `/reload all`.
- The `§p§l§a§c§e§r` marker switches `server_form` to the Placer layout, and aux-value item icons + stack counts render correctly on 1.26.45 (verified in-game 2026-08-30).
- A bare fixed-width control inside the UI's vertical stack panel renders **left-aligned**, not centered — centering requires a full-width wrapper panel with explicit center anchors.
- Chest-UI's inventory-section buttons are **display-only by design**: their `button_mappings` override replaces `common.button`'s standard mappings with inert ones, so clicks are swallowed. Clickable slots need the standard mappings (`button.menu_select → $pressed_button_name` pressed, `button.menu_ok → …` focused) — declared explicitly in `placer_ui.indexed_slot_button`.

- Click-to-transfer works end to end (verified 2026-08-30): explicit standard button mappings (`button.menu_select → $pressed_button_name` pressed, `button.menu_ok → …` focused) make slot buttons fire, `selection` maps correctly across hidden empty-slot buttons and manual `collection_index` slots, and deposits (full + partial stacks) and withdrawals both work.
- The grid-row wrapper centers the 3×3 grid (verified 2026-08-30).
- Zero-motion screen animations (override of `third_party_server_screen` `$screen_animations`/`$background_animations` with no-op anims firing `screen.exit_end`) suppress the swipe on the close/reopen cycle (verified 2026-08-30). Side effect: all server forms lose slide transitions while the pack is active.
- `onRedstoneUpdate` events carry `powerLevel` and `previousPowerLevel` (stable, v26.40 docs), so rising-edge detection is stateless.
- Mining speed: `destructible_by_mining.item_specific_speeds` still requires the UpcomingFeatures experiment (MS docs, checked 2026-08-30) — the experiment-free way to get vanilla tool scaling is the `minecraft:tags` component (format ≥ 1.26.20) with `minecraft:is_pickaxe_item_destructible`; mining time = `seconds_to_destroy` ÷ the tool's digger speed (wood 2, stone 4, copper 5, iron 6, diamond 8, netherite 9, gold 12). The Placer uses 5.25s base to match Dispenser per-pickaxe times; bare-hand is 5.25s (vanilla's ×5 no-tool penalty isn't expressible without the experiment).
- Break-drop hook is `onBreak` (since 2026-09-15; previously `onPlayerBreak`): fires for all destruction causes, and synchronous world mutation (`dimension.spawnItem`, dynamic-property writes) works directly inside it — verified for both player mining (2026-08-30, then via onPlayerBreak) and TNT explosions (2026-09-15). Contents drop like a vanilla container in both cases.
- Phase 4 hoppers verified end to end (2026-09-08): `minecraft:tick` fires `onTick` every 8 ticks and permits world mutation inside the handler; hopper `facing_direction`/`toggle_bit` states read correctly and hopper containers work via `BlockInventoryComponent`; top/side insertion, below extraction, front rejection, redstone locking, and the placeable-blocks filter all behave at the vanilla rate, including on a redstone clock with auto-restocking.
- **"Placeable block" definition seam** (observed in-game 2026-09-08): `isPlaceableBlock` = `BlockTypes.get(typeId) !== undefined`, i.e. the item id doubles as a block id. Torch passes (shared id) but repeater is rejected — Bedrock's repeater *item* is `minecraft:repeater` while its *blocks* are `minecraft:unpowered_repeater`/`powered_repeater`; same split affects comparator, redstone dust (`redstone_wire`), string (`trip_wire`). Accepted behaviour (redstone components are out of scope); the torch-floats-when-placed-into-air side of it is Phase 6 item 2.
- **Comparator reading of the Placer is not possible** (researched 2026-09-08): comparators read container fill only from real container block entities, which custom blocks cannot have. `minecraft:redstone_producer` (stable, format ≥ 1.26.40) could fake a fill-level signal via a block state + permutations, but a producer emits real power to neighbors — it would lock adjacent hoppers and trigger dust/pistons, breaking hopper automation. Rejected. Player-facing workaround: put the comparator on the vanilla hopper feeding/draining the Placer.
- **Live UI refresh via `uiManager.closeAllForms` was tried and REJECTED (2026-09-08) — do not re-attempt.** The API itself works on 1.26.45 (stable in `@minecraft/server-ui` 2.1.0, forced close resolves the form promise and a flagged reopen works), but the close/reopen cycle visibly blinks the whole screen — including the player's hotbar — every transfer, even with the zero-motion screen animations; the maintainer found it "super annoying". Accepted limitation instead: the Placer screen is a snapshot; hopper transfers while it is open become visible on the next click or reopen (trapped-chest-like feel). Forms fundamentally cannot be redrawn in place.
- Phase 5 placement verified end to end (2026-08-30): `minecraft:cardinal_direction` stores the direction the player FACED at placement (front = opposite of state — `FRONT_OFFSETS` in `main.js` is correct as written, all four facings tested); one rising edge places exactly one block (a held-on lever does not retrigger); blocked fronts fail cleanly; liquid is replaced; random slot selection works; `dispenser.dispense`/`dispenser.fail` sound ids play. Confirmed compatible with piston contraptions on a clock (place → piston pushes → place again).
