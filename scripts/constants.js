/**
 * Shared identifiers.
 *
 * Kept in their own module so every other file can import them without pulling in
 * `main.js` and creating an import cycle.
 */

/** Module id, used for flags, settings, template paths and socket names. */
export const MODULE_ID = "blizzards-wondrous-spellbook";

/** Root path for this module's assets inside the Foundry data directory. */
export const MODULE_PATH = `modules/${MODULE_ID}`;

/** Default name of the Journal Entry folder that stores every spellbook. */
export const DEFAULT_FOLDER_NAME = "Blizzard's Spellbooks";

/** Flag key on a JournalEntry holding the array of stored spell records. */
export const SPELLS_FLAG = "spells";

/** Settings keys. */
export const SETTINGS = Object.freeze({
  SHEET_INTEGRATION: "enableSheetIntegration",
  SIDEBAR_BUTTON: "showSidebarButton",
  FOLDER_NAME: "folderName"
});

/**
 * Build a path to one of this module's Handlebars templates.
 * @param {string} name File name inside `templates/`.
 * @returns {string} Full template path.
 */
export const template = (name) => `${MODULE_PATH}/templates/${name}`;
