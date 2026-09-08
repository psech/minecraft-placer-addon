import { ItemStack } from "@minecraft/server";
import {
  getInventory,
  insertIntoInventory,
  isPlaceableBlock,
  takeOneItem,
} from "./inventory.js";

/*
 * ============================================================================
 * Hopper interaction
 * ============================================================================
 *
 * Custom blocks do not participate in vanilla hopper logic, so transfers are
 * simulated from the Placer's side: the Placer ticks every 8 game ticks (the
 * vanilla hopper cooldown, via minecraft:tick in blocks/placer.json) and
 * moves at most one item per adjacent hopper per tick — the vanilla rate of
 * 2.5 items/second per hopper.
 *
 * Vanilla-faithful behaviour, matching how hoppers treat a Dispenser:
 *
 *   insertion   a down-facing hopper above, or a horizontal hopper whose
 *               output spout points into the Placer — but never through the
 *               Placer's FRONT face (the placement face)
 *   extraction  a hopper directly below (vanilla hoppers only ever pull
 *               from the container directly above themselves, regardless of
 *               their own facing — side extraction does not exist)
 *
 * A hopper locked by redstone (toggle_bit) is skipped, and items that are
 * not placeable blocks stay in the feeding hopper — the push scans the
 * hopper's slots in order and moves the first item the Placer accepts,
 * like a vanilla hopper skipping items its target cannot take.
 */

const HOPPER_BLOCK_ID = "minecraft:hopper";

/*
 * Direction the hopper's output spout points, per its facing_direction
 * block state. 1 (up) is unused by the game.
 */
const HOPPER_OUTPUT_OFFSETS = new Map([
  [0, { x: 0, y: -1, z: 0 }],
  [2, { x: 0, y: 0, z: -1 }],
  [3, { x: 0, y: 0, z: 1 }],
  [4, { x: -1, y: 0, z: 0 }],
  [5, { x: 1, y: 0, z: 0 }],
]);

const ABOVE = { x: 0, y: 1, z: 0 };
const BELOW = { x: 0, y: -1, z: 0 };

const HORIZONTAL_OFFSETS = [
  { x: 0, y: 0, z: -1 },
  { x: 0, y: 0, z: 1 },
  { x: -1, y: 0, z: 0 },
  { x: 1, y: 0, z: 0 },
];

/**
 * Returns the hopper adjacent to a Placer at the given offset, or null when
 * there is no hopper there, the position is unloaded, or the hopper is
 * locked by redstone (toggle_bit).
 */
function getUnlockedHopperAt(placerBlock, offset) {
  let neighbor;

  try {
    neighbor = placerBlock.offset(offset);
  } catch {
    return null;
  }

  if (!neighbor || neighbor.typeId !== HOPPER_BLOCK_ID) {
    return null;
  }

  try {
    if (neighbor.permutation.getState("toggle_bit") === true) {
      return null;
    }
  } catch {
    return null;
  }

  return neighbor;
}

/**
 * Returns a hopper's vanilla inventory container.
 */
function getHopperContainer(hopperBlock) {
  return hopperBlock.getComponent("minecraft:inventory")?.container ?? null;
}

/**
 * Returns true when a hopper's output spout points at the Placer.
 *
 * `offset` is the Placer -> hopper direction, so the hopper feeds the
 * Placer exactly when its output vector is the opposite of that offset.
 */
function hopperOutputsIntoPlacer(hopperBlock, offset) {
  let facing;

  try {
    facing = hopperBlock.permutation.getState("facing_direction");
  } catch {
    return false;
  }

  const output = HOPPER_OUTPUT_OFFSETS.get(facing);

  return (
    output !== undefined &&
    output.x === -offset.x &&
    output.y === -offset.y &&
    output.z === -offset.z
  );
}

/**
 * Moves one item from a hopper into the Placer.
 *
 * Scans the hopper's slots in order and moves the first item the Placer
 * accepts (placeable block with room available), like a vanilla hopper
 * skipping items its target cannot take.
 *
 * Returns true when an item was moved.
 */
function pushOneItemFromHopper(hopperBlock, placerBlock) {
  const container = getHopperContainer(hopperBlock);

  if (!container) {
    return false;
  }

  for (let slotIndex = 0; slotIndex < container.size; slotIndex++) {
    const item = container.getItem(slotIndex);

    if (!item || !isPlaceableBlock(item.typeId)) {
      continue;
    }

    const remaining = insertIntoInventory(placerBlock, {
      typeId: item.typeId,
      amount: 1,
    });

    if (remaining !== 0) {
      /*
       * The Placer has no room for this item type; try the next slot.
       */
      continue;
    }

    if (item.amount > 1) {
      item.amount -= 1;
      container.setItem(slotIndex, item);
    } else {
      container.setItem(slotIndex, undefined);
    }

    return true;
  }

  return false;
}

/**
 * Moves one item from the Placer into a hopper.
 *
 * Scans the Placer's slots in order and moves the first item the hopper
 * accepts, mirroring how a vanilla hopper drains a Dispenser.
 *
 * Returns true when an item was moved.
 */
function pullOneItemIntoHopper(placerBlock, hopperBlock) {
  const container = getHopperContainer(hopperBlock);

  if (!container) {
    return false;
  }

  const inventory = getInventory(placerBlock);

  for (let slotIndex = 0; slotIndex < inventory.length; slotIndex++) {
    const slot = inventory[slotIndex];

    if (!slot) {
      continue;
    }

    let leftover;

    try {
      /*
       * addItem with a single item either accepts it fully (returns
       * undefined) or not at all (returns the leftover stack) — there is
       * no partial outcome, so the Placer decrement below cannot lose or
       * duplicate items.
       */
      leftover = container.addItem(new ItemStack(slot.typeId, 1));
    } catch {
      /*
       * Stale/invalid item type in storage; leave it for the UI to expose
       * rather than deleting it silently.
       */
      continue;
    }

    if (leftover) {
      continue;
    }

    takeOneItem(placerBlock, slotIndex);

    return true;
  }

  return false;
}

/**
 * Runs one hopper-transfer cycle for a Placer: at most one item in from
 * each feeding hopper and one item out to a hopper below.
 *
 * `frontOffset` is the direction the Placer's front faces (insertion
 * through the front is rejected); undefined skips the front exclusion.
 *
 * Returns true when any item was moved, so the caller can refresh open
 * container screens.
 */
export function processHopperTransfers(placerBlock, frontOffset) {
  let changed = false;

  const above = getUnlockedHopperAt(placerBlock, ABOVE);

  if (above && hopperOutputsIntoPlacer(above, ABOVE)) {
    changed = pushOneItemFromHopper(above, placerBlock) || changed;
  }

  for (const offset of HORIZONTAL_OFFSETS) {
    if (
      frontOffset &&
      offset.x === frontOffset.x &&
      offset.z === frontOffset.z
    ) {
      continue;
    }

    const side = getUnlockedHopperAt(placerBlock, offset);

    if (side && hopperOutputsIntoPlacer(side, offset)) {
      changed = pushOneItemFromHopper(side, placerBlock) || changed;
    }
  }

  const below = getUnlockedHopperAt(placerBlock, BELOW);

  if (below) {
    changed = pullOneItemIntoHopper(placerBlock, below) || changed;
  }

  return changed;
}
