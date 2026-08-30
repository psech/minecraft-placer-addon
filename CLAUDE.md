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
- **Block definition:** `src/behavior_pack/blocks/placer.json`. Orientation uses the `minecraft:placement_direction` trait (`minecraft:cardinal_direction` state) plus `minecraft:transformation` rotation permutations. The un-rotated front is the **south** material instance.
- **Custom component:** `placer:placer`, registered in `main.js` via `system.beforeEvents.startup` → `blockComponentRegistry`. Handles `onPlayerInteract` (UI), `onRedstoneUpdate` (activation), `onPlayerBreak` (cleanup).
- **Inventory storage:** world dynamic properties, one JSON string per Placer, keyed `placer:<dimensionId>:<x>:<y>:<z>`. Slots are `{ typeId, amount } | null`, 9 entries. This gives per-block persistence that survives `/reload all`.
- **Manifests:** BP depends on RP by UUID and on `@minecraft/server` 2.9.0 + `@minecraft/server-ui` 2.1.0. Keep BP/RP `header.version` in sync — CI fails if they disagree, and release tags `vX.Y.Z` must match the manifest version.

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
