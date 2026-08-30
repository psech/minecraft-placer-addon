import { ActionFormData } from "@minecraft/server-ui";
import { INVENTORY_SIZE } from "../inventory.js";
import { typeIdToDataId, typeIdToID } from "./typeIds.js";

/*
 * ============================================================================
 * Placer container screen builder
 * ============================================================================
 *
 * The screen is an ActionForm that the resource pack's JSON UI
 * (ui/placer_form.json) restyles into a Dispenser-like container screen.
 * The JSON UI recognises the form by an invisible marker in its title.
 *
 * The form buttons map to UI slots by index:
 *
 *   0-8    the 9 Placer slots (3x3 grid)
 *   9-17   player hotbar      (container slots 0-8)
 *   18-44  player inventory   (container slots 9-35)
 *
 * Every slot gets a button, including empty ones, so that button indices in
 * the form response always correspond to fixed slot positions. Empty slots
 * use an empty label, which the JSON UI hides (and makes unclickable).
 *
 * Technique adapted from Chest-UI
 * (https://github.com/Herobrine643928/Chest-UI) by LeGend077 & Herobrine64,
 * licensed CC BY 4.0.
 */

/**
 * Form-button index of the first player inventory slot.
 * Player container slot N is form button PLAYER_SLOT_OFFSET + N.
 */
export const PLAYER_SLOT_OFFSET = INVENTORY_SIZE;

/**
 * Number of player container slots shown (9 hotbar + 27 inventory).
 */
export const PLAYER_SLOT_COUNT = 36;

/*
 * Invisible marker (Minecraft formatting codes render as nothing) that the
 * JSON UI matches in the form title to switch from the vanilla long form to
 * the Placer container layout. Must match ui/placer_form.json and
 * ui/server_form.json in the resource pack.
 */
const TITLE_MARKER = "§p§l§a§c§e§r";

/*
 * Icons for item types that have no vanilla numeric ID (custom content).
 * "textures/..." paths render as flat images in the JSON UI.
 */
const CUSTOM_ICON_TEXTURES = new Map([
  ["placer:placer", "textures/blocks/placer_front"],
]);

/**
 * Turns "minecraft:oak_planks" into "Oak Planks" for hover text.
 *
 * Server forms cannot resolve item typeIds to translated names, so this
 * readable fallback is the best available without shipping a lang map.
 */
function getDisplayName(typeId) {
  return typeId
    .replace(/^[^:]+:/, "")
    .replace(/_/g, " ")
    .replace(/(^\w|\s\w)/g, (match) => match.toUpperCase());
}

/**
 * Resolves the form-button "icon" value for an item type.
 *
 * The JSON UI feeds numeric values to the vanilla item renderer as an aux
 * value (item ID * 65536), which draws the actual item icon, including 3D
 * blocks. Strings starting with "textures/" render as flat images instead.
 *
 * Returns undefined for unknown types (the slot then shows no icon).
 */
function getIconValue(typeId) {
  const customTexture = CUSTOM_ICON_TEXTURES.get(typeId);

  if (customTexture) {
    return customTexture;
  }

  const numericId = typeIdToDataId.get(typeId) ?? typeIdToID.get(typeId);

  if (numericId === undefined) {
    return undefined;
  }

  return String(numericId * 65536);
}

/**
 * Encodes the button text for an occupied slot.
 *
 * The JSON UI parses the fixed-width "stack#NN" prefix for the stack-count
 * label and shows everything after it as hover text.
 */
function getSlotText(typeId, amount) {
  const clamped = Math.min(Math.max(amount, 1), 99);
  const stackText = String(clamped).padStart(2, "0");

  return `stack#${stackText}§r${getDisplayName(typeId)}`;
}

/**
 * Builds the Placer container screen.
 *
 * `placerInventory` is the serialized 9-slot inventory
 * (array of { typeId, amount } | null); `playerContainer` is the player's
 * inventory Container.
 */
export function buildPlacerScreen(placerInventory, playerContainer) {
  const form = new ActionFormData().title({
    rawtext: [{ text: `${TITLE_MARKER}Placer` }],
  });

  for (const slot of placerInventory) {
    if (slot) {
      form.button(getSlotText(slot.typeId, slot.amount), getIconValue(slot.typeId));
    } else {
      form.button("");
    }
  }

  for (let slotIndex = 0; slotIndex < PLAYER_SLOT_COUNT; slotIndex++) {
    const item =
      slotIndex < playerContainer.size
        ? playerContainer.getItem(slotIndex)
        : undefined;

    if (item) {
      form.button(getSlotText(item.typeId, item.amount), getIconValue(item.typeId));
    } else {
      form.button("");
    }
  }

  return form;
}
