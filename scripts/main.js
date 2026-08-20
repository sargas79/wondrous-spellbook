/**
 * Blizzard's Wondrous Spellbook - module entry point.
 *
 * Registers settings and hooks at `init`, then wires up the scene control button, the PF2e
 * character sheet integration and the spell-cast animation listeners at `ready`.
 */

import { MODULE_ID, SETTINGS, DEFAULT_FOLDER_NAME } from "./constants.js";

/** Name of the scene control tool that opens the spellbook browser. */
const TOOL_NAME = "bws-spellbook";
import { SpellbookApp } from "./spellbook-app.js";
import { MySpellbooksApp, registerBrowserRefreshHooks } from "./my-spellbooks-app.js";
import { injectSheetControls, openSendToSlotDialog, resolveTargetActor } from "./slot-manager.js";
import { getAnimationsAvailable, registerAnimationHooks } from "./animation-config.js";
import { invalidateSpellCache, querySpells } from "./spell-query.js";
import * as persistence from "./persistence.js";

/**
 * Register this module's world settings.
 * @returns {void}
 */
function registerSettings() {
  game.settings.register(MODULE_ID, SETTINGS.SHEET_INTEGRATION, {
    name: "BWS.Settings.SheetIntegration.Name",
    hint: "BWS.Settings.SheetIntegration.Hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, SETTINGS.SIDEBAR_BUTTON, {
    name: "BWS.Settings.SidebarButton.Name",
    hint: "BWS.Settings.SidebarButton.Hint",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => ui.controls?.render()
  });

  game.settings.register(MODULE_ID, SETTINGS.FOLDER_NAME, {
    name: "BWS.Settings.FolderName.Name",
    hint: "BWS.Settings.FolderName.Hint",
    scope: "world",
    config: true,
    type: String,
    default: DEFAULT_FOLDER_NAME
  });
}

/**
 * Add the spellbook button to the scene controls toolbar.
 *
 * The tool is appended to the journal notes control group so it sits with the
 * other left-hand map tools, falling back to the token group when a build does
 * not expose a notes group. Both the v13 record shape and the older array shape
 * of the hook payload are handled so the button survives Foundry version
 * differences.
 *
 * @param {object|Array} controls The scene control definitions being assembled.
 * @returns {void}
 */
function injectSceneControlButton(controls) {
  // Controls can be built before this module's settings exist in a partially
  // initialised world; treat a missing setting as "enabled".
  try {
    if (!game.settings.get(MODULE_ID, SETTINGS.SIDEBAR_BUTTON)) return;
  } catch {
    /* settings not registered yet - fall through and render the button */
  }

  const open = () => new MySpellbooksApp().render(true);
  const tool = {
    name: TOOL_NAME,
    title: "BWS.ModuleTitle",
    icon: "fa-solid fa-book-open",
    visible: true,
    button: true,
    order: 100,
    // v13 dispatches tool activation through `onChange`; v12 and earlier use
    // `onClick`. Only one of the two is ever called, so both point at `open`.
    onClick: open,
    onChange: open
  };

  const group = Array.isArray(controls)
    ? controls.find((c) => c.name === "notes") ?? controls.find((c) => c.name === "token")
    : controls?.notes ?? controls?.tokens ?? controls?.token;
  if (!group?.tools) return;

  if (Array.isArray(group.tools)) {
    if (!group.tools.some((t) => t.name === TOOL_NAME)) group.tools.push(tool);
  } else {
    group.tools[TOOL_NAME] ??= tool;
  }
}

Hooks.once("init", () => {
  registerSettings();

  // Public surface for macros and other modules.
  const api = {
    SpellbookApp,
    MySpellbooksApp,
    openCreator: (options = {}) => new SpellbookApp(options).render(true),
    openBrowser: () => new MySpellbooksApp().render(true),
    sendToSlot: openSendToSlotDialog,
    resolveTargetActor,
    getAnimationsAvailable,
    querySpells,
    invalidateSpellCache,
    ...persistence
  };

  game.modules.get(MODULE_ID).api = api;
  globalThis.BlizzardsWondrousSpellbook = api;
});

Hooks.once("ready", () => {
  if (game.system.id !== "pf2e") {
    ui.notifications.error(
      "Blizzard's Wondrous Spellbook requires the Pathfinder Second Edition system."
    );
    return;
  }

  registerAnimationHooks();
  registerBrowserRefreshHooks();

  // The spell cache is built from compendium contents, so drop it when a pack changes.
  Hooks.on("createItem", (item) => {
    if (item.pack && item.type === "spell") invalidateSpellCache();
  });
  Hooks.on("deleteItem", (item) => {
    if (item.pack && item.type === "spell") invalidateSpellCache();
  });

  console.log(`${MODULE_ID} | Ready`);
});

Hooks.on("getSceneControlButtons", injectSceneControlButton);

// PF2e's character sheet render hook. Availability of JB2A/Sequencer is re-checked
// inside the handler on every render, so toggling either module mid-session takes
// effect without a reload.
Hooks.on("renderCharacterSheetPF2e", (app, html) => {
  if (!game.settings.get(MODULE_ID, SETTINGS.SHEET_INTEGRATION)) return;
  try {
    injectSheetControls(app, html);
  } catch (err) {
    console.error(`${MODULE_ID} | Character sheet integration failed`, err);
  }
});
