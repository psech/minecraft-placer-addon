# Placer — Minecraft Bedrock Add-on

A custom **Placer** block for Minecraft Bedrock Edition (1.26.45). The Placer looks and behaves like a Dispenser/Dropper, but with one narrow purpose: when powered by redstone, it takes one block from its 9-slot inventory and **places it directly in front of itself**.

```text
Place Placer
     ↓
Right-click
     ↓
Vanilla-looking 3×3 inventory
     ↓
Put blocks into it
     ↓
Hopper can feed/extract it
     ↓
Power it with redstone
     ↓
One block is placed directly in front
```

## What it does

- **Directional block** — the front faces the player when placed, like a Dispenser. Front face has a distinct texture.
- **9-slot inventory** — proper container semantics: stack limits, merging, partial insertion, swapping, per-block persistence that survives `/reload all`.
- **Redstone activation** — one redstone pulse places exactly one block in front of the Placer and decrements the source stack.
- **Hopper support** (planned) — hoppers insert/extract from every side *except* the front, which is the output face.

It deliberately does **not** reproduce general Dispenser behaviour (water buckets, bone meal, arrows, minecarts, etc.). Only placeable blocks are handled.

## Installation

### From a release

Download `Placer.mcaddon` from the [latest release](https://github.com/psech/minecraft-placer-addon/releases) and open it — Minecraft imports both packs. Add both the Behavior Pack and Resource Pack to your world. The Behavior Pack requires the **Beta APIs** experiment if scripts use beta modules.

### In-game usage

```mcfunction
/give @s placer:placer
```

or

```mcfunction
/setblock ~ ~ ~ placer:placer
```

## Project structure

```text
src/
  behavior_pack/               Behavior Pack (Placer_BP)
    blocks/placer.json         Block definition: geometry, textures, redstone, rotation permutations
    scripts/
      main.js                  Custom component handlers + container screen flow
      inventory.js             9-slot inventory backend (world dynamic properties)
      ui/placerScreen.js       Builds the container screen (marker-titled ActionForm)
      ui/typeIds.js            Vanilla item ID map for icon rendering (vendored from Chest-UI)
    manifest.json
  resource_pack/               Resource Pack (Placer_RP)
    textures/                  Block textures (Dispenser/Crafter-inspired, distinct front face)
    ui/                        JSON UI: restyles the Placer form into a vanilla-looking container
    blocks.json
    manifest.json
scripts/build.ps1              Local Windows build → dist/Placer.mcaddon
docs/                          Design/implementation notes
.github/workflows/             CI: builds .mcpack/.mcaddon artifacts; tags vX.Y.Z create releases
```

## Development setup

Development is done against a real Bedrock client using **development packs** — no export/import cycle needed.

Link the packs into Minecraft with directory junctions (Windows):

```cmd
mklink /d "%appdata%\Minecraft Bedrock\Users\Shared\games\com.mojang\development_behavior_packs\Placer_BP" "C:\Users\przem\Git\minecraft-placer-addon\src\behavior_pack"
mklink /d "%appdata%\Minecraft Bedrock\Users\Shared\games\com.mojang\development_resource_packs\Placer_RP" "C:\Users\przem\Git\minecraft-placer-addon\src\resource_pack"
```

Then iterate by editing the source and running `/reload all` in-game.

### Building distributable packs

- **Locally (Windows):** run the *Build Placer Add-on* VS Code task, or `scripts/build.ps1`. Output lands in `dist/`.
- **CI:** every push to `main` builds artifacts. Pushing a `v*` tag that matches the manifest versions creates a GitHub release with `Placer.mcaddon`, `Placer_BP.mcpack`, and `Placer_RP.mcpack`.

## Implementation status

| Phase | Description | Status |
|-------|-------------|--------|
| 1 | Orientation — front face tracks player placement direction | ✅ Done |
| 2 | Inventory backend — 9 slots on world dynamic properties | ✅ Done |
| 3 | UI — 3×3 container-style interface via JSON UI (real item icons, stack counts, player inventory below; click-to-transfer) | 🔄 Implemented, pending in-game verification |
| 4 | Hopper interaction — all sides except front | ⬜ Planned |
| 5 | Block placement on redstone activation | ⬜ Planned |
| 6 | Edge cases — unloaded chunks, protected areas, non-replaceable targets, rapid pulses, block drops on destruction | ⬜ Planned |

See [docs/Minecraft Bedrock Add-on_ Placer Block.md](docs/Minecraft%20Bedrock%20Add-on_%20Placer%20Block.md) for the full specification.

## Credits

The container-style UI is adapted from [Chest-UI](https://github.com/Herobrine643928/Chest-UI) by [LeGend077](https://github.com/LeGend077) and Herobrine64, licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Modifications: 3×3 dispenser layout, fixed slot indexing for a functional player inventory, durability/enchant rendering removed.

## References

- [Minecraft Add-ons (wiki)](https://minecraft.wiki/w/Add-on)
- [Bedrock Creator documentation](https://learn.microsoft.com/en-us/minecraft/creator/)
- [Getting started with Add-on development](https://learn.microsoft.com/en-us/minecraft/creator/documents/gettingstarted?view=minecraft-bedrock-stable)
- [Mojang Bedrock sample files](https://github.com/mojang/bedrock-samples)
