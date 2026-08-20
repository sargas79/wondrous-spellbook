/**
 * Blizzard's Wondrous Spellbook - module entry point.
 *
 * Registers settings and hooks at `init`, then wires up the sidebar button, the PF2e
 * character sheet integration and the spell-cast animation listeners at `ready`.
 */

import { MODULE_ID, SETTINGS, DEFAULT_FOLDER_NAME } from "./constants.js";
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
    onChange: () => ui.sidebar?.render()
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
 * Add the spellbook button to the bottom of the sidebar's control column.
 *
 * The button is appended to the existing tab strip so it inherits Foundry's own
 * sizing and hover treatment. Selectors are tried in order to tolerate markup
 * changes between Foundry builds.
 *
 * @param {object} sidebar The Sidebar application.
 * @param {HTMLElement|object} html The sidebar's root element.
 * @returns {void}
 */
function injectSidebarButton(sidebar, html) {
  // The sidebar can render before this module's settings exist in a partially
  // initialised world; treat a missing setting as "enabled".
  try {
    if (!game.settings.get(MODULE_ID, SETTINGS.SIDEBAR_BUTTON)) return;
  } catch {
    /* settings not registered yet - fall through and render the button */
  }

  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root) return;

  const tabs =
    root.querySelector("#sidebar-tabs") ??
    root.querySelector("menu.tabs") ??
    root.querySelector(".sidebar-tabs");
  if (!tabs || tabs.querySelector(".bws-sidebar-button")) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "bws-sidebar-button ui-control icon fa-solid fa-book-open";
  button.dataset.tooltip = game.i18n.localize("BWS.ModuleTitle");
  button.setAttribute("aria-label", game.i18n.localize("BWS.ModuleTitle"));
  button.addEventListener("click", (event) => {
    event.preventDefault();
    new MySpellbooksApp().render(true);
  });

  tabs.appendChild(button);
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

Hooks.on("renderSidebar", injectSidebarButton);

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
