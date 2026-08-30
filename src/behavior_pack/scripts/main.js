import { BlockTypes, system } from "@minecraft/server";
import {
  createItemStack,
  deleteInventory,
  getInventory,
  insertIntoInventory,
  removeStack,
  serializeItemStack,
  setSlot,
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
      console.warn(
        `Placer activated at ` +
          `${event.block.location.x}, ` +
          `${event.block.location.y}, ` +
          `${event.block.location.z}`,
      );
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
