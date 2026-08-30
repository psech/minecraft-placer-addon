import { ItemStack, system, world } from "@minecraft/server";
import { CustomForm } from "@minecraft/server-ui";

const INVENTORY_SIZE = 9;
const INVENTORY_PROPERTY_PREFIX = "placer:";

/*
 * ============================================================================
 * Inventory storage
 * ============================================================================
 *
 * Each Placer gets its own world dynamic property.
 *
 * Example:
 *
 *   placer:minecraft:overworld:10:64:20
 *
 * contains:
 *
 *   [
 *     { "typeId": "minecraft:stone", "amount": 64 },
 *     null,
 *     { "typeId": "minecraft:dirt", "amount": 32 },
 *     ...
 *   ]
 *
 * We deliberately store only typeId + amount for now. That is sufficient
 * for the block-placement functionality we are implementing.
 */

/**
 * Returns a new empty 9-slot inventory.
 */
function createEmptyInventory() {
  return Array(INVENTORY_SIZE).fill(null);
}

/**
 * Returns the dynamic-property identifier for a specific Placer.
 */
function getInventoryPropertyId(block) {
  const { x, y, z } = block.location;

  return (
    `${INVENTORY_PROPERTY_PREFIX}` + `${block.dimension.id}:` + `${x}:${y}:${z}`
  );
}

/**
 * Loads a Placer inventory from the world.
 *
 * Missing data means the Placer has an empty inventory.
 */
function getInventory(block) {
  const propertyId = getInventoryPropertyId(block);
  const value = world.getDynamicProperty(propertyId);

  if (typeof value !== "string") {
    return createEmptyInventory();
  }

  try {
    const inventory = JSON.parse(value);

    if (!Array.isArray(inventory) || inventory.length !== INVENTORY_SIZE) {
      throw new Error("Invalid inventory length");
    }

    for (const slot of inventory) {
      if (slot === null) {
        continue;
      }

      if (
        typeof slot !== "object" ||
        typeof slot.typeId !== "string" ||
        !Number.isInteger(slot.amount) ||
        slot.amount <= 0
      ) {
        throw new Error("Invalid inventory slot");
      }
    }

    return inventory;
  } catch (error) {
    console.warn(
      `[Placer] Invalid inventory at ` +
        `${block.dimension.id} ` +
        `${block.location.x},${block.location.y},${block.location.z}: ` +
        `${error}`,
    );

    return createEmptyInventory();
  }
}

/**
 * Saves a Placer inventory to the world.
 */
function saveInventory(block, inventory) {
  if (!Array.isArray(inventory) || inventory.length !== INVENTORY_SIZE) {
    throw new Error("Invalid Placer inventory");
  }

  const propertyId = getInventoryPropertyId(block);

  world.setDynamicProperty(propertyId, JSON.stringify(inventory));
}

/**
 * Deletes the persistent inventory belonging to a Placer.
 */
function deleteInventory(block) {
  const propertyId = getInventoryPropertyId(block);

  world.setDynamicProperty(propertyId, undefined);
}

/*
 * ============================================================================
 * Item helpers
 * ============================================================================
 */

/**
 * Returns the maximum stack size for an item type.
 */
function getMaxStackSize(typeId) {
  try {
    return new ItemStack(typeId, 1).maxAmount;
  } catch {
    /*
     * This should only happen for an invalid/unknown item type.
     * 64 is a safe fallback for normal Minecraft blocks.
     */
    return 64;
  }
}

/**
 * Creates an ItemStack from our serialized slot representation.
 */
function createItemStack(slot) {
  return new ItemStack(slot.typeId, slot.amount);
}

/**
 * Creates our serialized representation from an ItemStack.
 */
function serializeItemStack(itemStack) {
  return {
    typeId: itemStack.typeId,
    amount: itemStack.amount,
  };
}

/**
 * Returns true when two serialized stacks contain the same item type.
 */
function sameItemType(first, second) {
  return first !== null && second !== null && first.typeId === second.typeId;
}

/*
 * ============================================================================
 * Inventory operations
 * ============================================================================
 */

/**
 * Inserts as many items as possible into one Placer slot.
 *
 * Returns the number of items that could NOT be inserted.
 *
 * Examples:
 *
 *   empty slot + stone x64
 *     -> slot becomes stone x64
 *     -> returns 0
 *
 *   stone x32 + stone x64
 *     -> slot becomes stone x64
 *     -> returns 32
 *
 *   dirt x64 + stone x64
 *     -> unchanged
 *     -> returns 64
 */
function insertIntoSlot(block, slotIndex, item) {
  if (slotIndex < 0 || slotIndex >= INVENTORY_SIZE) {
    throw new Error(`Invalid Placer slot: ${slotIndex}`);
  }

  if (
    !item ||
    typeof item.typeId !== "string" ||
    !Number.isInteger(item.amount) ||
    item.amount <= 0
  ) {
    throw new Error("Invalid item");
  }

  const inventory = getInventory(block);
  const slot = inventory[slotIndex];

  /*
   * Empty slot.
   */
  if (!slot) {
    const amount = Math.min(item.amount, getMaxStackSize(item.typeId));

    inventory[slotIndex] = {
      typeId: item.typeId,
      amount,
    };

    saveInventory(block, inventory);

    return item.amount - amount;
  }

  /*
   * Different item type.
   */
  if (slot.typeId !== item.typeId) {
    return item.amount;
  }

  /*
   * Same item type: merge into the existing stack.
   */
  const maxStackSize = getMaxStackSize(slot.typeId);
  const availableSpace = maxStackSize - slot.amount;

  if (availableSpace <= 0) {
    return item.amount;
  }

  const amount = Math.min(availableSpace, item.amount);

  slot.amount += amount;

  saveInventory(block, inventory);

  return item.amount - amount;
}

/**
 * Removes an entire stack from a Placer slot.
 *
 * Returns null when the slot is empty.
 */
function removeStack(block, slotIndex) {
  if (slotIndex < 0 || slotIndex >= INVENTORY_SIZE) {
    throw new Error(`Invalid Placer slot: ${slotIndex}`);
  }

  const inventory = getInventory(block);
  const slot = inventory[slotIndex];

  if (!slot) {
    return null;
  }

  const removed = {
    typeId: slot.typeId,
    amount: slot.amount,
  };

  inventory[slotIndex] = null;

  saveInventory(block, inventory);

  return removed;
}

/**
 * Replaces the contents of a Placer slot.
 *
 * Used for swapping stacks.
 */
function setSlot(block, slotIndex, slot) {
  if (slotIndex < 0 || slotIndex >= INVENTORY_SIZE) {
    throw new Error(`Invalid Placer slot: ${slotIndex}`);
  }

  const inventory = getInventory(block);

  inventory[slotIndex] = slot
    ? {
        typeId: slot.typeId,
        amount: slot.amount,
      }
    : null;

  saveInventory(block, inventory);
}

/*
 * ============================================================================
 * Player inventory
 * ============================================================================
 */

/**
 * Returns the player's inventory container.
 */
function getPlayerInventory(player) {
  return player.getComponent("minecraft:inventory")?.container ?? null;
}

/**
 * Returns the item currently held in the selected hotbar slot.
 */
function getHeldItem(player) {
  const inventory = getPlayerInventory(player);

  if (!inventory) {
    return null;
  }

  return inventory.getItem(player.selectedSlotIndex);
}

/**
 * Sets the item currently held in the selected hotbar slot.
 */
function setHeldItem(player, item) {
  const inventory = getPlayerInventory(player);

  if (!inventory) {
    return;
  }

  inventory.setItem(player.selectedSlotIndex, item);
}

/*
 * ============================================================================
 * Player <-> Placer transfers
 * ============================================================================
 */

/**
 * Inserts the player's held stack into a Placer slot.
 *
 * The player's held stack is reduced by the amount inserted.
 *
 * Returns the number of items inserted.
 */
function insertHeldItemIntoSlot(player, block, slotIndex) {
  const heldItem = getHeldItem(player);

  if (!heldItem) {
    return 0;
  }

  const originalAmount = heldItem.amount;

  const remainder = insertIntoSlot(
    block,
    slotIndex,
    serializeItemStack(heldItem),
  );

  const inserted = originalAmount - remainder;

  if (inserted <= 0) {
    return 0;
  }

  if (remainder === 0) {
    setHeldItem(player, undefined);
  } else {
    heldItem.amount = remainder;
    setHeldItem(player, heldItem);
  }

  return inserted;
}

/**
 * Attempts to give a complete stack to the player.
 *
 * Returns true when the complete stack was accepted.
 */
function giveStackToPlayer(player, stack) {
  const inventory = getPlayerInventory(player);

  if (!inventory) {
    return false;
  }

  const itemStack = createItemStack(stack);
  const leftover = inventory.addItem(itemStack);

  if (!leftover) {
    return true;
  }

  /*
   * Some or all of the stack could not be inserted.
   *
   * We don't modify the Placer here. The caller is responsible for
   * deciding whether to restore the original stack.
   */
  return false;
}

/*
 * ============================================================================
 * UI
 * ============================================================================
 */

function getDisplayName(typeId) {
  return typeId.replace(/^minecraft:/, "").replace(/_/g, " ");
}

/**
 * Creates the text displayed inside an inventory slot.
 *
 * We deliberately keep this compact because the UI is now arranged as a
 * 3 × 3 grid.
 */
function getSlotLabel(slot) {
  if (!slot) {
    return "§8[ ]";
  }

  const name = getDisplayName(slot.typeId);

  return `§f${name}\n` + `§e×${slot.amount}`;
}

/**
 * Opens the Placer inventory as a 3 × 3 grid.
 *
 * The form API doesn't provide native inventory slots, so the grid is
 * represented by three rows containing three buttons each.
 */
function showPlacerInventory(player, block) {
  const inventory = getInventory(block);

  const form = new CustomForm(player, "Placer");

  form.label("§lPlacer");
  form.divider();

  /*
   * Row 1
   */
  form.button(getSlotLabel(inventory[0]), () =>
    handleSlotClick(player, block, 0),
  );

  form.button(getSlotLabel(inventory[1]), () =>
    handleSlotClick(player, block, 1),
  );

  form.button(getSlotLabel(inventory[2]), () =>
    handleSlotClick(player, block, 2),
  );

  form.divider();

  /*
   * Row 2
   */
  form.button(getSlotLabel(inventory[3]), () =>
    handleSlotClick(player, block, 3),
  );

  form.button(getSlotLabel(inventory[4]), () =>
    handleSlotClick(player, block, 4),
  );

  form.button(getSlotLabel(inventory[5]), () =>
    handleSlotClick(player, block, 5),
  );

  form.divider();

  /*
   * Row 3
   */
  form.button(getSlotLabel(inventory[6]), () =>
    handleSlotClick(player, block, 6),
  );

  form.button(getSlotLabel(inventory[7]), () =>
    handleSlotClick(player, block, 7),
  );

  form.button(getSlotLabel(inventory[8]), () =>
    handleSlotClick(player, block, 8),
  );

  form.divider();
  form.closeButton();

  form.show().catch((error) => {
    console.warn(`[Placer] Failed to open UI: ${error}`);
  });
}

/**
 * Handles interaction with a Placer slot.
 *
 * Behaviour:
 *
 *   Empty slot + held item
 *       -> insert held stack
 *
 *   Empty slot + empty hand
 *       -> nothing
 *
 *   Occupied slot + empty hand
 *       -> take complete stack
 *
 *   Occupied slot + same item
 *       -> merge held stack
 *
 *   Occupied slot + different item
 *       -> swap stacks
 */
function handleSlotClick(player, block, slotIndex) {
  const inventory = getInventory(block);
  const slot = inventory[slotIndex];
  const heldItem = getHeldItem(player);

  /*
   * --------------------------------------------------------------------------
   * Empty Placer slot
   * --------------------------------------------------------------------------
   */

  if (!slot) {
    if (!heldItem) {
      return;
    }

    const heldTypeId = heldItem.typeId;

    const inserted = insertHeldItemIntoSlot(player, block, slotIndex);

    if (inserted > 0) {
      player.sendMessage(
        `§aInserted ${inserted} × ` + `${getDisplayName(heldTypeId)}`,
      );
    }

    return;
  }

  /*
   * --------------------------------------------------------------------------
   * Occupied slot + empty hand
   * --------------------------------------------------------------------------
   */

  if (!heldItem) {
    const removed = removeStack(block, slotIndex);

    if (!removed) {
      return;
    }

    const playerInventory = getPlayerInventory(player);

    if (!playerInventory) {
      setSlot(block, slotIndex, removed);

      return;
    }

    const leftover = playerInventory.addItem(createItemStack(removed));

    if (!leftover) {
      player.sendMessage(
        `§aRemoved ${removed.amount} × ` + `${getDisplayName(removed.typeId)}`,
      );

      return;
    }

    /*
     * Never destroy an item because the player's inventory is full.
     */
    setSlot(block, slotIndex, removed);

    player.sendMessage("§cYour inventory is full.");

    return;
  }

  /*
   * --------------------------------------------------------------------------
   * Occupied slot + same item
   * --------------------------------------------------------------------------
   */

  if (sameItemType(slot, serializeItemStack(heldItem))) {
    const inserted = insertHeldItemIntoSlot(player, block, slotIndex);

    if (inserted > 0) {
      player.sendMessage(
        `§aAdded ${inserted} × ` + `${getDisplayName(slot.typeId)}`,
      );
    } else {
      player.sendMessage("§7That stack is already full.");
    }

    return;
  }

  /*
   * --------------------------------------------------------------------------
   * Occupied slot + different item
   * --------------------------------------------------------------------------
   */

  const playerStack = serializeItemStack(heldItem);

  setSlot(block, slotIndex, playerStack);

  setHeldItem(player, createItemStack(slot));

  player.sendMessage("§aSwapped stacks.");
}

/*
 * ============================================================================
 * Block registration
 * ============================================================================
 */

system.beforeEvents.startup.subscribe(({ blockComponentRegistry }) => {
  blockComponentRegistry.registerCustomComponent("placer:placer", {
    onPlayerInteract(event) {
      showPlacerInventory(event.player, event.block);
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
       * them into the world. We will implement item dropping when we
       * implement the final inventory/hopper behaviour.
       */
      deleteInventory(event.block);
    },
  });
});
