import { BlockTypes, system } from "@minecraft/server";
import {
  createItemStack,
  deleteInventory,
  getInventory,
  insertIntoInventory,
  removeStack,
  serializeItemStack,
  setSlot,
  takeOneItem,
} from "./inventory.js";
import { buildPlacerScreen, PLAYER_SLOT_OFFSET } from "./ui/placerScreen.js";

const PLACER_BLOCK_ID = "placer:placer";

/*
 * Logs every UI interaction to the content log. Uses console.warn because
 * lower levels are filtered out of the content log by default. Enable when
 * debugging the container screen.
 */
const DEBUG_UI = false;

function debugLog(message) {
  if (DEBUG_UI) {
    console.warn(`[Placer] ${message}`);
  }
}

/*
 * ============================================================================
 * Block resolution
 * ============================================================================
 */

/**
 * Re-resolves a Placer block from its dimension and location.
 *
 * Form interactions are asynchronous: between showing the screen and the
 * player clicking a slot, the block may have been broken, replaced, or its
 * chunk unloaded (dimension.getBlock throws for unloaded chunks).
 * Never trust a Block reference across an await/then boundary.
 */
function resolvePlacerBlock(dimension, location) {
  try {
    const block = dimension.getBlock(location);

    return block && block.typeId === PLACER_BLOCK_ID ? block : null;
  } catch {
    return null;
  }
}

/**
 * Returns the player's inventory container.
 */
function getPlayerContainer(player) {
  return player.getComponent("minecraft:inventory")?.container ?? null;
}

/**
 * Returns true when an item type is a placeable block.
 *
 * The Placer only stores placeable blocks. This also protects players from
 * losing data on complex items (enchantments, durability, names), because
 * the Placer persists only typeId + amount.
 */
function isPlaceableBlock(typeId) {
  return BlockTypes.get(typeId) !== undefined;
}

/*
 * ============================================================================
 * Container screen flow
 * ============================================================================
 *
 * The screen is a restyled ActionForm (see ui/placerScreen.js), so it cannot
 * do live drag & drop. Instead, every click transfers a whole stack, the
 * form closes, the transfer is applied, and the screen reopens with the
 * updated contents — similar to shift-clicking in a vanilla container:
 *
 *   click a Placer stack     -> moves to the player inventory
 *   click a player item      -> moves into the Placer
 *   close button / ESC       -> done
 */

/**
 * Opens (or reopens) the Placer screen for a player.
 */
function openPlacerScreen(player, dimension, location) {
  const block = resolvePlacerBlock(dimension, location);

  if (!block) {
    return;
  }

  const container = getPlayerContainer(player);

  if (!container) {
    return;
  }

  buildPlacerScreen(getInventory(block), container)
    .show(player)
    .then((response) => {
      debugLog(
        `form response: canceled=${response.canceled} ` +
          `reason=${response.cancelationReason ?? "none"} ` +
          `selection=${response.selection ?? "none"}`,
      );

      if (response.canceled || response.selection === undefined) {
        return;
      }

      handleSlotSelection(player, dimension, location, response.selection);
    })
    .catch((error) => {
      console.warn(`[Placer] Failed to show screen: ${error}`);
    });
}

/**
 * Dispatches a click on any slot of the Placer screen.
 *
 * Form-button indices: 0-8 are Placer slots, 9-44 are player container
 * slots 0-35 (see ui/placerScreen.js).
 */
function handleSlotSelection(player, dimension, location, selection) {
  const block = resolvePlacerBlock(dimension, location);

  if (!block) {
    return;
  }

  if (selection < PLAYER_SLOT_OFFSET) {
    debugLog(`withdraw from Placer slot ${selection}`);
    withdrawPlacerSlot(player, block, selection);
  } else {
    debugLog(`deposit from player slot ${selection - PLAYER_SLOT_OFFSET}`);
    depositPlayerSlot(player, block, selection - PLAYER_SLOT_OFFSET);
  }

  /*
   * Reopen so the player can keep moving stacks until they close the screen.
   */
  openPlacerScreen(player, dimension, location);
}

/**
 * Moves a stack from a Placer slot into the player inventory.
 *
 * Anything that does not fit stays in the Placer slot.
 */
function withdrawPlacerSlot(player, block, slotIndex) {
  const removed = removeStack(block, slotIndex);

  if (!removed) {
    return;
  }

  const container = getPlayerContainer(player);

  if (!container) {
    setSlot(block, slotIndex, removed);

    return;
  }

  /*
   * Container.addItem returns the leftover ItemStack when only part of the
   * stack fits, or undefined when everything was accepted.
   */
  const leftover = container.addItem(createItemStack(removed));

  if (leftover) {
    setSlot(block, slotIndex, {
      typeId: removed.typeId,
      amount: leftover.amount,
    });

    player.sendMessage("§7Your inventory is full.");
  }
}

/**
 * Moves a stack from a player container slot into the Placer.
 *
 * Anything that does not fit stays in the player slot.
 */
function depositPlayerSlot(player, block, playerSlotIndex) {
  const container = getPlayerContainer(player);

  if (!container || playerSlotIndex >= container.size) {
    return;
  }

  const item = container.getItem(playerSlotIndex);

  if (!item) {
    return;
  }

  if (!isPlaceableBlock(item.typeId)) {
    player.sendMessage("§7The Placer only stores placeable blocks.");

    return;
  }

  const remaining = insertIntoInventory(block, serializeItemStack(item));

  if (remaining === item.amount) {
    player.sendMessage("§7The Placer is full.");

    return;
  }

  if (remaining === 0) {
    container.setItem(playerSlotIndex, undefined);
  } else {
    item.amount = remaining;
    container.setItem(playerSlotIndex, item);
  }
}

/*
 * ============================================================================
 * Block placement (redstone activation)
 * ============================================================================
 */

/*
 * Direction the Placer's front face points, per minecraft:cardinal_direction
 * state value.
 *
 * The state records the direction the player was FACING at placement, and
 * the block's rotation permutations (blocks/placer.json) put the front
 * texture — the un-rotated "south" (+Z) material instance — on the side
 * facing the player, like a Dispenser. The front therefore points OPPOSITE
 * to the state value.
 *
 * Bedrock axes: north = -Z, south = +Z, east = +X, west = -X.
 *
 * If in-game testing shows blocks appearing on the BACK side, the trait
 * semantics are inverted on this runtime: negate all four offsets.
 */
const FRONT_OFFSETS = new Map([
  ["north", { x: 0, y: 0, z: 1 }],
  ["south", { x: 0, y: 0, z: -1 }],
  ["east", { x: -1, y: 0, z: 0 }],
  ["west", { x: 1, y: 0, z: 0 }],
]);

const SOUND_DISPENSE = "dispenser.dispense";
const SOUND_FAIL = "dispenser.fail";

/**
 * Plays a vanilla dispenser sound at a Placer's position.
 */
function playPlacerSound(block, soundId) {
  const { x, y, z } = block.location;

  block.dimension.playSound(soundId, { x: x + 0.5, y: y + 0.5, z: z + 0.5 });
}

/**
 * Returns the block directly in front of a Placer, or undefined when the
 * front direction is unknown or the target position is not loaded.
 */
function getFrontBlock(block) {
  let state;

  try {
    state = block.permutation.getState("minecraft:cardinal_direction");
  } catch {
    state = undefined;
  }

  const offset = FRONT_OFFSETS.get(state);

  if (!offset) {
    console.warn(`[Placer] Unknown cardinal_direction state: ${state}`);

    return undefined;
  }

  try {
    /*
     * Block.offset returns undefined (or throws at world bounds) when the
     * target chunk is not loaded.
     */
    return block.offset(offset);
  } catch {
    return undefined;
  }
}

/**
 * Picks the Placer slot to place from: a random occupied slot holding a
 * placeable block, matching the vanilla Dispenser's random slot selection.
 *
 * Returns a slot index, or -1 when no eligible slot exists. Non-placeable
 * types cannot normally get in (deposits are filtered), but stale data is
 * skipped defensively rather than trusted.
 */
function pickPlacementSlot(inventory) {
  const eligibleSlots = [];

  for (let slotIndex = 0; slotIndex < inventory.length; slotIndex++) {
    const slot = inventory[slotIndex];

    if (slot && isPlaceableBlock(slot.typeId)) {
      eligibleSlots.push(slotIndex);
    }
  }

  if (eligibleSlots.length === 0) {
    return -1;
  }

  return eligibleSlots[Math.floor(Math.random() * eligibleSlots.length)];
}

/**
 * Places one block from the Placer's inventory into the block directly in
 * front of it. Runs deferred (via system.run) from the redstone handler.
 */
function activatePlacer(dimension, location) {
  const block = resolvePlacerBlock(dimension, location);

  if (!block) {
    return;
  }

  const target = getFrontBlock(block);

  if (!target) {
    debugLog("activation skipped: front target unavailable");

    return;
  }

  /*
   * Only replace air or liquid, like placing a block by hand. Everything
   * else (including protected areas and special placement rules) is
   * Phase 6 territory.
   */
  if (!target.isAir && !target.isLiquid) {
    debugLog(`activation blocked by ${target.typeId}`);
    playPlacerSound(block, SOUND_FAIL);

    return;
  }

  const slotIndex = pickPlacementSlot(getInventory(block));

  if (slotIndex === -1) {
    debugLog("activation with no placeable blocks in inventory");
    playPlacerSound(block, SOUND_FAIL);

    return;
  }

  const typeId = takeOneItem(block, slotIndex);

  try {
    target.setType(typeId);
  } catch (error) {
    /*
     * Placement failed after the item was already removed: put it back so
     * activation failures never destroy items.
     */
    insertIntoInventory(block, { typeId, amount: 1 });

    console.warn(`[Placer] Failed to place ${typeId}: ${error}`);
    playPlacerSound(block, SOUND_FAIL);

    return;
  }

  debugLog(`placed ${typeId} from slot ${slotIndex}`);
  playPlacerSound(block, SOUND_DISPENSE);
}

/*
 * ============================================================================
 * Block registration
 * ============================================================================
 */

system.beforeEvents.startup.subscribe(({ blockComponentRegistry }) => {
  blockComponentRegistry.registerCustomComponent(PLACER_BLOCK_ID, {
    onPlayerInteract(event) {
      const { block, player } = event;

      if (!player) {
        return;
      }

      openPlacerScreen(player, block.dimension, block.location);
    },

    onRedstoneUpdate(event) {
      const { block, powerLevel, previousPowerLevel } = event;

      /*
       * Activate on the rising edge only (unpowered -> powered), so one
       * redstone pulse places exactly one block. Level changes while
       * already powered, and power-off updates, are ignored.
       */
      if (powerLevel <= 0 || previousPowerLevel > 0) {
        return;
      }

      debugLog(
        `redstone rising edge (${previousPowerLevel} -> ${powerLevel}) at ` +
          `${block.location.x}, ${block.location.y}, ${block.location.z}`,
      );

      /*
       * Defer the world mutation by one tick: the event fires during
       * redstone evaluation, and deferring both avoids read-only-mode
       * surprises and mimics the vanilla Dispenser's activation delay.
       */
      const { dimension, location } = block;

      system.run(() => activatePlacer(dimension, location));
    },

    onPlayerBreak(event) {
      /*
       * Remove the persistent inventory when the block is broken.
       *
       * IMPORTANT:
       * This currently deletes the stored contents without dropping
       * them into the world. Dropping the contents is part of
       * Phase 6 (edge cases).
       */
      deleteInventory(event.block);
    },
  });
});
