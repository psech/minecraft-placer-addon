import { ItemStack, system, world } from "@minecraft/server";

import { CustomForm } from "@minecraft/server-ui";

const INVENTORY_SIZE = 9;
const INVENTORY_PROPERTY = "inventory";

/*
 * --------------------------------------------------------------------------
 * Inventory storage
 * --------------------------------------------------------------------------
 */

function emptyInventory() {
  return Array(INVENTORY_SIZE).fill(null);
}

function getInventory(block) {
  const properties = block.getComponent("minecraft:dynamic_properties");

  if (!properties) {
    throw new Error("Placer does not have minecraft:dynamic_properties");
  }

  const value = properties.get(INVENTORY_PROPERTY);

  if (typeof value !== "string") {
    const inventory = emptyInventory();

    properties.set(INVENTORY_PROPERTY, JSON.stringify(inventory));

    return inventory;
  }

  try {
    const inventory = JSON.parse(value);

    if (!Array.isArray(inventory) || inventory.length !== INVENTORY_SIZE) {
      throw new Error("Invalid inventory structure");
    }

    return inventory;
  } catch (error) {
    console.warn(`Invalid Placer inventory: ${error}`);

    return emptyInventory();
  }
}

function saveInventory(block, inventory) {
  const properties = block.getComponent("minecraft:dynamic_properties");

  if (!properties) {
    throw new Error("Placer does not have minecraft:dynamic_properties");
  }

  properties.set(INVENTORY_PROPERTY, JSON.stringify(inventory));
}

/*
 * --------------------------------------------------------------------------
 * Inventory operations
 * --------------------------------------------------------------------------
 */

function getMaxStackSize(typeId) {
  return getItemMaxStackSize(typeId);
}

function getItemMaxStackSize(typeId) {
  try {
    const item = new ItemStack(typeId, 1);
    return item.maxAmount;
  } catch {
    return 64;
  }
}

function addItemToSlot(block, slotIndex, item) {
  const inventory = getInventory(block);
  const slot = inventory[slotIndex];

  if (!slot) {
    const amount = Math.min(item.amount, getMaxStackSize(item.typeId));

    inventory[slotIndex] = {
      typeId: item.typeId,
      amount,
    };

    saveInventory(block, inventory);

    return item.amount - amount;
  }

  if (slot.typeId !== item.typeId) {
    return item.amount;
  }

  const maxStackSize = getMaxStackSize(slot.typeId);

  const space = maxStackSize - slot.amount;

  if (space <= 0) {
    return item.amount;
  }

  const amount = Math.min(space, item.amount);

  slot.amount += amount;
  item.amount -= amount;

  saveInventory(block, inventory);

  return item.amount;
}

function removeOne(block, slotIndex) {
  const inventory = getInventory(block);
  const slot = inventory[slotIndex];

  if (!slot) {
    return null;
  }

  const removed = {
    typeId: slot.typeId,
    amount: 1,
  };

  slot.amount--;

  if (slot.amount <= 0) {
    inventory[slotIndex] = null;
  }

  saveInventory(block, inventory);

  return removed;
}

function removeStack(block, slotIndex) {
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

/*
 * --------------------------------------------------------------------------
 * Player inventory
 * --------------------------------------------------------------------------
 */

function getHeldItem(player) {
  const inventory = player.getComponent("minecraft:inventory");

  if (!inventory?.container) {
    return null;
  }

  const selectedSlot = player.selectedSlotIndex;

  return inventory.container.getItem(selectedSlot);
}

function setHeldItem(player, item) {
  const inventory = player.getComponent("minecraft:inventory");

  if (!inventory?.container) {
    return;
  }

  inventory.container.setItem(player.selectedSlotIndex, item);
}

/*
 * --------------------------------------------------------------------------
 * UI
 * --------------------------------------------------------------------------
 */

function slotLabel(slot, index) {
  if (!slot) {
    return `Slot ${index + 1}\n[ empty ]`;
  }

  return `Slot ${index + 1}\n${slot.typeId}\n×${slot.amount}`;
}

function showPlacerInventory(player, block) {
  const inventory = getInventory(block);

  let form = new CustomForm(player, "Placer");

  form.label("9-Slot Inventory");
  form.divider();

  for (let i = 0; i < INVENTORY_SIZE; i++) {
    const index = i;

    form.button(slotLabel(inventory[index], index), () => {
      handleSlotClick(player, block, index);
    });
  }

  form.closeButton();

  form.show().catch((error) => {
    console.warn(`Failed to open Placer UI: ${error}`);
  });
}

function handleSlotClick(player, block, slotIndex) {
  const inventory = getInventory(block);
  const slot = inventory[slotIndex];

  /*
   * Empty slot:
   *
   * Put the player's currently held item into the Placer.
   */
  if (!slot) {
    const heldItem = getHeldItem(player);

    if (!heldItem) {
      player.sendMessage("§7That slot is empty.");
      return;
    }

    const item = {
      typeId: heldItem.typeId,
      amount: heldItem.amount,
    };

    if (!addItem(block, item)) {
      player.sendMessage("§cThe Placer inventory is full.");
      return;
    }

    setHeldItem(player, undefined);

    player.sendMessage(`§aInserted ${item.amount} × ${item.typeId}`);

    return;
  }

  /*
   * Occupied slot:
   *
   * Remove one item and give it to the player.
   */
  const removed = removeOne(block, slotIndex);

  if (!removed) {
    return;
  }

  const itemStack = new ItemStack(removed.typeId, removed.amount);

  const playerInventory = player.getComponent("minecraft:inventory")?.container;

  if (!playerInventory) {
    return;
  }

  const leftover = playerInventory.addItem(itemStack);

  if (leftover) {
    // Player inventory was full, so put the item back.
    addItem(block, {
      typeId: leftover.typeId,
      amount: leftover.amount,
    });

    player.sendMessage("§cYour inventory is full.");

    return;
  }

  player.sendMessage(`§aRemoved ${removed.typeId}`);
}

/*
 * --------------------------------------------------------------------------
 * Block registration
 * --------------------------------------------------------------------------
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
  });
});
