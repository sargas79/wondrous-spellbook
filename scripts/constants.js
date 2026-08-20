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

/** Default name of the Item folder that stores generated loot spellbooks. */
export const DEFAULT_LOOT_FOLDER_NAME = "Spellbook Loot";

/** Flag key on a JournalEntry holding the array of stored spell records. */
export const SPELLS_FLAG = "spells";

/**
 * Flag key on a physical Item holding the loot metadata (seed, level, learned map).
 * The spell list itself lives under {@link SPELLS_FLAG}, so every reader helper in
 * `persistence.js` works on a loot book exactly as it does on a spellbook journal.
 */
export const LOOT_FLAG = "loot";

/** Settings keys. */
export const SETTINGS = Object.freeze({
  SHEET_INTEGRATION: "enableSheetIntegration",
  SIDEBAR_BUTTON: "showSidebarButton",
  FOLDER_NAME: "folderName",
  LOOT_FOLDER_NAME: "lootFolderName",
  LOOT_PROFILE: "lootDefaultProfile",
  LOOT_MAX_RARITY: "lootMaxRarity",
  LOOT_SOURCES: "lootSources",
  TRACK_LEARNED: "trackLearned",
  CONSUME_ON_LEARN: "consumeOnLearn"
});

/**
 * Build a path to one of this module's Handlebars templates.
 * @param {string} name File name inside `templates/`.
 * @returns {string} Full template path.
 */
export const template = (name) => `${MODULE_PATH}/templates/${name}`;
