/**
 * Spell query engine.
 *
 * Reads every `spell` Item out of the world's Item compendium packs, normalises the
 * bits of the PF2e data model this module cares about, and groups the result by rank
 * so a Handlebars template can render it directly.
 *
 * PF2e renamed spell "level" to "rank" in its UI, but the stored source data still
 * lives at `system.level.value`. `SpellPF2e` exposes a `rank` getter on top of it.
 * Every accessor below reads the getter first and falls back to raw source paths, so
 * the module keeps working across PF2e data-model shuffles.
 */

/** @type {readonly string[]} The four PF2e magical traditions. */
export const TRADITIONS = Object.freeze(["arcane", "divine", "occult", "primal"]);

/** Highest spell rank in PF2e. */
export const MAX_RANK = 10;

/**
 * @type {readonly number[]} Every selectable rank, cantrips (0) first.
 * Shared by the query filter and the creator's rank chips so both agree on the range.
 */
export const RANKS = Object.freeze(Array.from({ length: MAX_RANK + 1 }, (_, i) => i));

/**
 * Cached compendium read. Building this is expensive (it loads every spell document
 * in every pack), so it is done once and reused for all subsequent filtering.
 * @type {{ spells: object[], packCount: number } | null}
 */
let _cache = null;

/** In-flight load, so concurrent callers share one pass over the packs. */
let _loading = null;

/** Clear the cached compendium read. Call when packs change. */
export function invalidateSpellCache() {
  _cache = null;
  _loading = null;
}

/**
 * Read a spell's rank (formerly "level").
 * @param {object} spell A SpellPF2e document or raw spell source.
 * @returns {number} Rank 0-10, where 0 means cantrip.
 */
export function getSpellRank(spell) {
  const raw = spell?.rank ?? spell?.system?.level?.value ?? spell?.system?.rank;
  const rank = Number(raw);
  return Number.isFinite(rank) ? Math.clamp(rank, 0, MAX_RANK) : 1;
}

/**
 * Read a spell's traits array.
 * @param {object} spell A SpellPF2e document or raw spell source.
 * @returns {string[]} Lower-cased trait slugs.
 */
export function getSpellTraits(spell) {
  const traits = spell?.system?.traits?.value;
  if (!Array.isArray(traits)) return [];
  return traits.map((t) => String(t).toLowerCase());
}

/**
 * Read a spell's magical traditions.
 * @param {object} spell A SpellPF2e document or raw spell source.
 * @returns {string[]} Any of arcane/divine/occult/primal present on the spell.
 */
export function getSpellTraditions(spell) {
  // PF2e 6+ keeps traditions in their own bucket; older data folded them into traits.
  const explicit = spell?.system?.traits?.traditions;
  const source = Array.isArray(explicit) ? explicit : getSpellTraits(spell);
  return source.map((t) => String(t).toLowerCase()).filter((t) => TRADITIONS.includes(t));
}

/**
 * Read a spell's category slug (`spell`, `focus`, `ritual`, ...).
 * @param {object} spell A SpellPF2e document or raw spell source.
 * @returns {string} Lower-cased category slug, or an empty string.
 */
export function getSpellCategory(spell) {
  const raw = spell?.system?.category?.value ?? spell?.system?.category;
  return typeof raw === "string" ? raw.toLowerCase() : "";
}

/**
 * Is this a focus spell?
 * @param {object} spell A SpellPF2e document or raw spell source.
 * @returns {boolean}
 */
export function isFocusSpell(spell) {
  if (typeof spell?.isFocusSpell === "boolean") return spell.isFocusSpell;
  return getSpellCategory(spell) === "focus" || getSpellTraits(spell).includes("focus");
}

/**
 * Is this a ritual? Rituals cannot occupy spell slots, so they are always excluded.
 * @param {object} spell A SpellPF2e document or raw spell source.
 * @returns {boolean}
 */
export function isRitual(spell) {
  if (typeof spell?.isRitual === "boolean") return spell.isRitual;
  return getSpellCategory(spell) === "ritual" || !!spell?.system?.ritual;
}

/**
 * Is this a cantrip? Cantrips report rank 0 in this module's grouping.
 * @param {object} spell A SpellPF2e document or raw spell source.
 * @returns {boolean}
 */
export function isCantrip(spell) {
  if (typeof spell?.isCantrip === "boolean") return spell.isCantrip;
  return getSpellTraits(spell).includes("cantrip");
}

/**
 * Describe a spell's action cost for the compact row glyph.
 * @param {object} spell A SpellPF2e document or raw spell source.
 * @returns {{ glyph: string, label: string, isNumeric: boolean }}
 */
export function getActionCost(spell) {
  const raw = String(spell?.system?.time?.value ?? "").trim();
  if (!raw) return { glyph: "", label: "", isNumeric: false };

  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric >= 1 && numeric <= 3) {
    return { glyph: String(numeric), label: `${numeric} action${numeric > 1 ? "s" : ""}`, isNumeric: true };
  }
  if (/^reaction$/i.test(raw)) return { glyph: "R", label: "Reaction", isNumeric: false };
  if (/^free$/i.test(raw)) return { glyph: "F", label: "Free action", isNumeric: false };
  return { glyph: raw, label: raw, isNumeric: false };
}

/**
 * Localised heading for a rank group.
 * @param {number} rank Spell rank, 0 for cantrips.
 * @returns {string}
 */
export function getRankLabel(rank) {
  if (rank === 0) return game.i18n.localize("BWS.Rank.Cantrips");
  return game.i18n.format("BWS.Rank.Rank", { rank });
}

/**
 * Short rank badge used in the selected-spells panel (`C`, `R1`, `R3`, ...).
 * @param {number} rank Spell rank, 0 for cantrips.
 * @returns {string}
 */
export function getRankBadge(rank) {
  if (rank === 0) return game.i18n.localize("BWS.Rank.CantripShort");
  return game.i18n.format("BWS.Rank.RankShort", { rank });
}

/**
 * Reduce a spell document to the flat shape the templates and journal flags use.
 * @param {object} spell A SpellPF2e document.
 * @param {string} packId The compendium collection id the spell came from.
 * @returns {object} Normalised spell record.
 */
function normaliseSpell(spell, packId) {
  const rank = isCantrip(spell) ? 0 : getSpellRank(spell);
  const traditions = getSpellTraditions(spell);
  return {
    uuid: spell.uuid,
    id: spell.id,
    packId,
    name: spell.name,
    img: spell.img,
    rank,
    baseRank: rank,
    rankBadge: getRankBadge(rank),
    traditions,
    // Pre-localised for the row pills: Handlebars has no `capitalize` helper.
    traditionTags: traditions.map((key) => ({
      key,
      label: game.i18n.localize(`BWS.Tradition.${key.charAt(0).toUpperCase()}${key.slice(1)}`)
    })),
    traits: getSpellTraits(spell),
    category: getSpellCategory(spell),
    isFocus: isFocusSpell(spell),
    isRitual: isRitual(spell),
    isCantrip: rank === 0,
    action: getActionCost(spell),
    // Pre-lowered once so filtering does not re-allocate per keystroke.
    searchKey: `${spell.name} ${getSpellTraits(spell).join(" ")}`.toLowerCase()
  };
}

/**
 * Load and cache every spell in every Item compendium pack.
 *
 * @param {object} [options]
 * @param {boolean} [options.force=false] Bypass the cache and re-read the packs.
 * @returns {Promise<{ spells: object[], packCount: number }>}
 */
export async function loadAllSpells({ force = false } = {}) {
  if (force) invalidateSpellCache();
  if (_cache) return _cache;
  if (_loading) return _loading;

  _loading = (async () => {
    try {
      const packs = game.packs.filter((p) => p.documentName === "Item");

      const results = await Promise.all(
        packs.map(async (pack) => {
          try {
            const docs = await pack.getDocuments({ type: "spell" });
            return docs.map((doc) => normaliseSpell(doc, pack.collection));
          } catch (err) {
            // One unreadable pack must not sink the whole query.
            console.warn(`Blizzard's Wondrous Spellbook | Skipped pack ${pack.collection}`, err);
            return [];
          }
        })
      );

      const seen = new Set();
      const spells = [];
      for (const spell of results.flat()) {
        // Rituals never occupy a slot, so they are dropped at the source. The flag is
        // read off the normalised record, which carries no `system` object.
        if (spell.isRitual) continue;
        if (seen.has(spell.uuid)) continue;
        seen.add(spell.uuid);
        spells.push(spell);
      }

      spells.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
      _cache = { spells, packCount: packs.length };
      return _cache;
    } catch (err) {
      console.error("Blizzard's Wondrous Spellbook | Spell query failed", err);
      ui.notifications.error(game.i18n.localize("BWS.Error.QueryFailed"));
      _cache = { spells: [], packCount: 0 };
      return _cache;
    } finally {
      _loading = null;
    }
  })();

  return _loading;
}

/**
 * Query, filter and group spells for rendering.
 *
 * @param {object} [options]
 * @param {string} [options.tradition="all"] One of `all`, `arcane`, `divine`, `occult`, `primal`.
 * @param {boolean} [options.includeFocus=false] Include focus spells in the results.
 * @param {string} [options.search=""] Case-insensitive match against name and traits.
 * @param {number[]|null} [options.ranks=null] Ranks to keep, 0 for cantrips. Empty or null
 *   means every rank, so callers that do not care about rank can omit it entirely.
 * @returns {Promise<{ groups: object[], shown: number, indexed: number, packCount: number }>}
 *   `groups` is sorted by rank ascending, each with its own name-sorted `spells` array.
 */
export async function querySpells({
  tradition = "all",
  includeFocus = false,
  search = "",
  ranks = null
} = {}) {
  const { spells, packCount } = await loadAllSpells();
  const needle = search.trim().toLowerCase();
  // Built once rather than per-spell: the predicate below runs over every indexed spell.
  const rankSet = Array.isArray(ranks) && ranks.length ? new Set(ranks.map(Number)) : null;

  const filtered = spells.filter((spell) => {
    // Cheapest discriminator first; `normaliseSpell` already folds cantrips down to rank 0.
    if (rankSet && !rankSet.has(spell.rank)) return false;
    if (!includeFocus && spell.isFocus) return false;
    if (tradition !== "all" && !spell.traditions.includes(tradition)) return false;
    if (needle && !spell.searchKey.includes(needle)) return false;
    return true;
  });

  // Bucket by rank, then emit in ascending rank order.
  const buckets = new Map();
  for (const spell of filtered) {
    if (!buckets.has(spell.rank)) buckets.set(spell.rank, []);
    buckets.get(spell.rank).push(spell);
  }

  const groups = [...buckets.entries()]
    .sort(([a], [b]) => a - b)
    .map(([rank, list]) => ({
      rank,
      label: getRankLabel(rank),
      count: list.length,
      countLabel:
        list.length === 1
          ? game.i18n.localize("BWS.Creator.SpellCountOne")
          : game.i18n.format("BWS.Creator.SpellCount", { count: list.length }),
      spells: list.sort((a, b) => a.name.localeCompare(b.name))
    }));

  return { groups, shown: filtered.length, indexed: spells.length, packCount };
}

/**
 * Resolve a normalised spell record back into a live document for embedding.
 * @param {string} uuid The spell's compendium UUID.
 * @returns {Promise<object|null>} The SpellPF2e document, or null if it no longer exists.
 */
export async function resolveSpell(uuid) {
  try {
    return await fromUuid(uuid);
  } catch (err) {
    console.error("Blizzard's Wondrous Spellbook | Failed to resolve spell", uuid, err);
    return null;
  }
}
