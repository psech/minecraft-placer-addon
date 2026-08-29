import { ItemStack, system, world } from "@minecraft/server";

import { CustomForm } from "@minecraft/server-ui";

const INVENTORY_SIZE = 9;
const INVENTORY_PROPERTY = "placer:inventories";

console.warn("Placer add-on loaded");

/*
 * --------------------------------------------------------------------------
 * Inventory storage
 * --------------------------------------------------------------------------
 */

function loadInventories() {
  const value = world.getDynamicProperty(INVENTORY_PROPERTY);

  if (typeof value !== "string") {
    return {};
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    console.warn(`Failed to parse Placer inventories: ${error}`);
    return {};
  }
}

function saveInventories(inventories) {
  world.setDynamicProperty(INVENTORY_PROPERTY, JSON.stringify(inventories));
}

function blockKey(block) {
  return [
    block.dimension.id,
    block.location.x,
    block.location.y,
    block.location.z,
  ].join(":");
}

function getInventory(block) {
  const inventories = loadInventories();
  const key = blockKey(block);

  if (!inventories[key]) {
    inventories[key] = Array(INVENTORY_SIZE).fill(null);
    saveInventories(inventories);
  }

  return inventories[key];
}

function setInventory(block, inventory) {
  const inventories = loadInventories();
  inventories[blockKey(block)] = inventory;
  saveInventories(inventories);
}

/*
 * --------------------------------------------------------------------------
 * Inventory operations
 * --------------------------------------------------------------------------
 */

function addItem(block, item) {
  const inventory = getInventory(block);

  // First try to stack with an existing stack.
  for (let i = 0; i < inventory.length; i++) {
    const slot = inventory[i];

    if (slot && slot.typeId === item.typeId && slot.amount < 64) {
      const space = 64 - slot.amount;
      const amount = Math.min(space, item.amount);

      slot.amount += amount;
      item.amount -= amount;

      if (item.amount === 0) {
        setInventory(block, inventory);
        return true;
      }
    }
  }

  // Then find an empty slot.
  for (let i = 0; i < inventory.length; i++) {
    if (!inventory[i]) {
      inventory[i] = {
        typeId: item.typeId,
        amount: item.amount,
      };

      setInventory(block, inventory);
      return true;
    }
  }

  return false;
}

function removeOne(block, slotIndex) {
  const inventory = getInventory(block);
  const slot = inventory[slotIndex];

  if (!slot) {
    return null;
  }

  const result = {
    typeId: slot.typeId,
    amount: 1,
  };

  slot.amount--;

  if (slot.amount <= 0) {
    inventory[slotIndex] = null;
  }

  setInventory(block, inventory);

  return result;
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
