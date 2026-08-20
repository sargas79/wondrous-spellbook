/**
 * Spellbook persistence.
 *
 * A spellbook is a JournalEntry inside a dedicated folder. The authoritative spell
 * list lives in `flags[MODULE_ID].spells`; the journal page is a human-readable
 * rendering of that flag, regenerated on every save.
 *
 * Ownership is written explicitly on create: default NONE, OWNER for the creator,
 * and OWNER for every GM, so a spellbook is always reachable by any GM regardless
 * of who authored it.
 */

import { MODULE_ID, SPELLS_FLAG, SETTINGS, DEFAULT_FOLDER_NAME } from "./constants.js";
import { getRankBadge, getRankLabel } from "./spell-query.js";

const { DOCUMENT_OWNERSHIP_LEVELS: OWNERSHIP } = CONST;

/**
 * Configured name of the spellbook folder.
 * @returns {string}
 */
export function getFolderName() {
  const configured = game.settings.get(MODULE_ID, SETTINGS.FOLDER_NAME);
  return configured?.trim() || DEFAULT_FOLDER_NAME;
}

/**
 * Find the spellbook folder, creating it if it does not exist.
 *
 * Only a GM can create a Folder, so players fall back to whatever folder already
 * exists; if none does yet, they get null and the caller reports the failure.
 *
 * @returns {Promise<object|null>} The Folder document, or null on failure.
 */
export async function getOrCreateSpellbooksFolder() {
  const name = getFolderName();
  try {
    const existing = game.folders.find((f) => f.type === "JournalEntry" && f.name === name);
    if (existing) return existing;
    if (!game.user.isGM) return null;

    return await Folder.create({ name, type: "JournalEntry", color: "#6d5ce7", sorting: "a" });
  } catch (err) {
    console.error("Blizzard's Wondrous Spellbook | Failed to resolve the spellbook folder", err);
    ui.notifications.error(game.i18n.localize("BWS.Error.FolderFailed"));
    return null;
  }
}

/**
 * Build the ownership map for a new spellbook: nobody by default, OWNER for the
 * creating user, OWNER for every GM.
 *
 * @param {string} [creatorId] User id of the creator. Defaults to the current user.
 * @returns {Record<string, number>} A Foundry ownership object.
 */
export function buildOwnership(creatorId = game.user.id) {
  const ownership = { default: OWNERSHIP.NONE };
  ownership[creatorId] = OWNERSHIP.OWNER;
  for (const gm of game.users.filter((u) => u.isGM)) ownership[gm.id] = OWNERSHIP.OWNER;
  return ownership;
}

/**
 * Render the stored spell list as journal page HTML.
 * @param {object[]} spells Stored spell records.
 * @returns {string} HTML table grouped by rank.
 */
export function renderSpellsPage(spells) {
  if (!spells.length) return `<p><em>${game.i18n.localize("BWS.Creator.SelectedEmpty")}</em></p>`;

  const byRank = new Map();
  for (const spell of spells) {
    if (!byRank.has(spell.rank)) byRank.set(spell.rank, []);
    byRank.get(spell.rank).push(spell);
  }

  const sections = [...byRank.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rank, list]) => {
      const rows = list
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((spell) => {
          // Spell names and traits come from world and pack content, which may contain
          // markup. This HTML is persisted into a JournalEntry page and rendered later,
          // so everything interpolated here is escaped first.
          const traditions = foundry.utils.escapeHTML((spell.traditions ?? []).join(", "));
          const uuid = foundry.utils.escapeHTML(spell.uuid ?? "");
          // The enricher delimits its label with braces, so strip those from the name
          // before escaping or a stray brace truncates the link.
          const label = foundry.utils.escapeHTML(String(spell.name ?? "").replace(/[{}]/g, ""));
          return `<tr><td>@UUID[${uuid}]{${label}}</td><td>${traditions}</td></tr>`;
        })
        .join("");
      return `<h2>${getRankLabel(rank)}</h2>
<table><thead><tr><th>${game.i18n.localize("BWS.Journal.TableSpell")}</th><th>${game.i18n.localize(
        "BWS.Journal.TableTraditions"
      )}</th></tr></thead><tbody>${rows}</tbody></table>`;
    });

  return sections.join("\n");
}

/**
 * Strip a spell record down to what is worth persisting.
 * @param {object} spell A normalised spell record.
 * @returns {object} Storable record.
 */
export function toStoredSpell(spell) {
  return {
    uuid: spell.uuid,
    id: spell.id,
    packId: spell.packId,
    name: spell.name,
    img: spell.img,
    rank: spell.rank,
    traditions: spell.traditions ?? [],
    // Preserved verbatim if it was ever set, even while JB2A is disabled.
    ...(spell.jb2aAnimation ? { jb2aAnimation: spell.jb2aAnimation } : {})
  };
}

/**
 * Create a new spellbook journal entry.
 *
 * @param {object} params
 * @param {string} params.name Spellbook name.
 * @param {object[]} params.spells Normalised spell records to store.
 * @returns {Promise<object|null>} The created JournalEntry, or null on failure.
 */
export async function createSpellbook({ name, spells }) {
  try {
    const folder = await getOrCreateSpellbooksFolder();
    const stored = spells.map(toStoredSpell);

    return await JournalEntry.create({
      name,
      folder: folder?.id ?? null,
      ownership: buildOwnership(),
      flags: { [MODULE_ID]: { [SPELLS_FLAG]: stored, createdBy: game.user.id } },
      pages: [
        {
          name: game.i18n.localize("BWS.Journal.PageTitle"),
          type: "text",
          text: { format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML, content: renderSpellsPage(stored) }
        }
      ]
    });
  } catch (err) {
    console.error("Blizzard's Wondrous Spellbook | Failed to create the spellbook", err);
    ui.notifications.error(game.i18n.localize("BWS.Error.SaveFailed"));
    return null;
  }
}

/**
 * Update an existing spellbook in place, preserving its ownership map.
 *
 * @param {object} journal The JournalEntry to update.
 * @param {object} params
 * @param {string} params.name New spellbook name.
 * @param {object[]} params.spells Normalised spell records to store.
 * @returns {Promise<object|null>} The updated JournalEntry, or null on failure.
 */
export async function updateSpellbook(journal, { name, spells }) {
  if (!canEditSpellbook(journal)) {
    ui.notifications.warn(game.i18n.localize("BWS.Notify.NoPermission"));
    return null;
  }

  try {
    const stored = spells.map(toStoredSpell);
    await journal.update({
      name,
      [`flags.${MODULE_ID}.${SPELLS_FLAG}`]: stored
    });

    // Keep the readable page in step with the flag data.
    const page = journal.pages.contents[0];
    const content = renderSpellsPage(stored);
    if (page) await page.update({ "text.content": content });
    else {
      await journal.createEmbeddedDocuments("JournalEntryPage", [
        {
          name: game.i18n.localize("BWS.Journal.PageTitle"),
          type: "text",
          text: { format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML, content }
        }
      ]);
    }
    return journal;
  } catch (err) {
    console.error("Blizzard's Wondrous Spellbook | Failed to update the spellbook", err);
    ui.notifications.error(game.i18n.localize("BWS.Error.SaveFailed"));
    return null;
  }
}

/**
 * Delete a spellbook.
 * @param {object} journal The JournalEntry to delete.
 * @returns {Promise<boolean>} True when the entry was deleted.
 */
export async function deleteSpellbook(journal) {
  if (!canEditSpellbook(journal)) {
    ui.notifications.warn(game.i18n.localize("BWS.Notify.NoPermission"));
    return false;
  }
  try {
    const name = journal.name;
    await journal.delete();
    ui.notifications.info(game.i18n.format("BWS.Notify.Deleted", { name }));
    return true;
  } catch (err) {
    console.error("Blizzard's Wondrous Spellbook | Failed to delete the spellbook", err);
    ui.notifications.error(game.i18n.localize("BWS.Error.DeleteFailed"));
    return false;
  }
}

/**
 * Read the spell records stored on a spellbook.
 * @param {object} journal A JournalEntry.
 * @returns {object[]} Stored spell records, or an empty array.
 */
export function getStoredSpells(journal) {
  const spells = journal?.getFlag?.(MODULE_ID, SPELLS_FLAG);
  return Array.isArray(spells) ? spells : [];
}

/**
 * Is this JournalEntry one of our spellbooks?
 * @param {object} journal A JournalEntry.
 * @returns {boolean}
 */
export function isSpellbook(journal) {
  return Array.isArray(journal?.getFlag?.(MODULE_ID, SPELLS_FLAG));
}

/**
 * May the current user edit this spellbook? GMs always may.
 * @param {object} journal A JournalEntry.
 * @returns {boolean}
 */
export function canEditSpellbook(journal) {
  if (game.user.isGM) return true;
  return !!journal?.testUserPermission(game.user, "OWNER");
}

/**
 * List the spellbooks the current user may see.
 *
 * GMs get every spellbook in the folder. Players get only the ones they own, tested
 * through `testUserPermission` rather than by comparing the creator id, so ownership
 * granted after the fact is respected.
 *
 * @returns {object[]} JournalEntry documents, sorted by name.
 */
export function getUserSpellbooks() {
  const folderName = getFolderName();
  const folder = game.folders.find((f) => f.type === "JournalEntry" && f.name === folderName);

  return game.journal
    .filter((entry) => {
      if (!isSpellbook(entry)) return false;
      if (folder && entry.folder?.id !== folder.id) return false;
      if (game.user.isGM) return true;
      return entry.testUserPermission(game.user, "OWNER");
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Summarise a spellbook for the browser list.
 * @param {object} journal A JournalEntry.
 * @returns {object} View model with counts and permission flags.
 */
export function summariseSpellbook(journal) {
  const spells = getStoredSpells(journal);
  const ranks = [...new Set(spells.map((s) => s.rank))].sort((a, b) => a - b);
  return {
    id: journal.id,
    uuid: journal.uuid,
    name: journal.name,
    count: spells.length,
    countLabel:
      spells.length === 1
        ? game.i18n.localize("BWS.Browser.SpellSummaryOne")
        : game.i18n.format("BWS.Browser.SpellSummary", { count: spells.length }),
    ranks: ranks.map((r) => ({ rank: r, badge: getRankBadge(r) })),
    canEdit: canEditSpellbook(journal)
  };
}
