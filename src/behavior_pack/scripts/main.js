import { system } from "@minecraft/server";

console.warn("Placer add-on loaded");

system.beforeEvents.startup.subscribe(({ blockComponentRegistry }) => {
  blockComponentRegistry.registerCustomComponent("placer:placer", {
    onRedstoneUpdate(event) {
      console.warn(
        `Placer activated at ${event.block.location.x}, ` +
          `${event.block.location.y}, ` +
          `${event.block.location.z}`,
      );
    },
  });
});
