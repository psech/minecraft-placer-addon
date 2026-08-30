import { ItemStack, world } from "@minecraft/server";

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
 * We deliberately store only typeId + amount. That is sufficient for plain
 * placeable blocks, which is all the Placer accepts.
 */

export const INVENTORY_SIZE = 9;

const INVENTORY_PROPERTY_PREFIX = "placer:";

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
export function getInventory(block) {
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
export function deleteInventory(block) {
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
export function createItemStack(slot) {
  return new ItemStack(slot.typeId, slot.amount);
}

/**
 * Creates our serialized representation from an ItemStack.
 */
export function serializeItemStack(itemStack) {
  return {
    typeId: itemStack.typeId,
    amount: itemStack.amount,
  };
}

/*
 * ============================================================================
 * Inventory operations
 * ============================================================================
 */

/**
 * Inserts items into the Placer using vanilla container semantics:
 * first top up existing stacks of the same type, then fill empty slots.
 *
 * Returns the number of items that could NOT be inserted.
 */
export function insertIntoInventory(block, item) {
  if (
    !item ||
    typeof item.typeId !== "string" ||
    !Number.isInteger(item.amount) ||
    item.amount <= 0
  ) {
    throw new Error("Invalid item");
  }

  const inventory = getInventory(block);
  const maxStackSize = getMaxStackSize(item.typeId);

  let remaining = item.amount;

  /*
   * Merge pass: top up existing stacks of the same type.
   */
  for (const slot of inventory) {
    if (remaining === 0) {
      break;
    }

    if (!slot || slot.typeId !== item.typeId) {
      continue;
    }

    const availableSpace = maxStackSize - slot.amount;

    if (availableSpace <= 0) {
      continue;
    }

    const moved = Math.min(availableSpace, remaining);

    slot.amount += moved;
    remaining -= moved;
  }

  /*
   * Empty pass: fill empty slots with new stacks.
   */
  for (let slotIndex = 0; slotIndex < inventory.length; slotIndex++) {
    if (remaining === 0) {
      break;
    }

    if (inventory[slotIndex]) {
      continue;
    }

    const moved = Math.min(maxStackSize, remaining);

    inventory[slotIndex] = {
      typeId: item.typeId,
      amount: moved,
    };

    remaining -= moved;
  }

  if (remaining !== item.amount) {
    saveInventory(block, inventory);
  }

  return remaining;
}

/**
 * Removes an entire stack from a Placer slot.
 *
 * Returns null when the slot is empty.
 */
export function removeStack(block, slotIndex) {
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
 * Used to return items that did not fit elsewhere.
 */
export function setSlot(block, slotIndex, slot) {
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
