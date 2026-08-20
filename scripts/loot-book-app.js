/**
 * The loot spellbook reader.
 *
 * Player-facing half of the loot feature: open a generated book and learn a spell from
 * it. Learning routes into `openSendToSlotDialog`, the module's single actor write
 * path, so nothing here writes to an actor itself.
 *
 * Which spells have been learned is recorded back onto the item's loot flag, keyed by
 * spell uuid, so a shared book remembers who already copied what. The write is guarded
 * by item ownership: a player reading a book they do not own simply gets no tracking
 * rather than a rejected update.
 */

import { MODULE_ID, LOOT_FLAG, SETTINGS, template } from "./constants.js";
import { getStoredSpells } from "./persistence.js";
import { getRankBadge, getRankLabel, getRarityLabel } from "./spell-query.js";
import { openSendToSlotDialog, resolveTargetActor } from "./slot-manager.js";
import { getLootMeta, isLootSpellbook } from "./loot-generator.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Read a world setting, treating a missing registration as its default.
 * @param {string} key A key from `SETTINGS`.
 * @param {*} fallback Value to use when the setting cannot be read.
 * @returns {*}
 */
function setting(key, fallback) {
  try {
    return game.settings.get(MODULE_ID, key);
  } catch {
    return fallback;
  }
}

export class LootBookApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /**
   * @param {object} options
   * @param {object} options.item The loot spellbook Item to read.
   */
  constructor(options = {}) {
    super(options);
    /** @type {object} */
    this.item = options.item;
  }

  /** @inheritdoc */
  static DEFAULT_OPTIONS = {
    id: "bws-loot-book",
    classes: ["bws", "bws-loot-book"],
    tag: "div",
    window: {
      title: "BWS.Loot.ReaderTitle",
      icon: "fa-solid fa-book-sparkles",
      resizable: true
    },
    position: { width: 520, height: 600 },
    actions: {
      learn: LootBookApp.#onLearn
    }
  };

  /** @inheritdoc */
  static PARTS = {
    body: { template: template("loot-book.hbs"), scrollable: [".bws-loot-spells"] }
  };

  /**
   * Windows are keyed per item so two books can be open side by side.
   * @inheritdoc
   */
  get id() {
    return `bws-loot-book-${this.item?.id ?? "unknown"}`;
  }

  /** @inheritdoc */
  get title() {
    return this.item?.name ?? game.i18n.localize("BWS.Loot.ReaderTitle");
  }

  /** @inheritdoc */
  async _prepareContext(options) {
    const meta = getLootMeta(this.item) ?? {};
    const learned = meta.learned ?? {};
    const target = this.#resolveActor();
    const consume = !!setting(SETTINGS.CONSUME_ON_LEARN, false);

    const groups = [];
    // Copied before sorting: `getStoredSpells` hands back the array stored on the
    // document, and sorting it in place would reorder the item's own flag data.
    const stored = [...getStoredSpells(this.item)].sort(
      (a, b) => a.rank - b.rank || a.name.localeCompare(b.name)
    );

    for (const spell of stored) {
      const actorIds = learned[spell.uuid] ?? [];
      const names = actorIds.map((id) => game.actors.get(id)?.name).filter(Boolean);
      const alreadyLearned = !!target && actorIds.includes(target.actor.id);

      let group = groups.at(-1);
      if (!group || group.rank !== spell.rank) {
        group = { rank: spell.rank, label: getRankLabel(spell.rank), spells: [] };
        groups.push(group);
      }
      group.spells.push({
        ...spell,
        rankBadge: getRankBadge(spell.rank),
        // Older books carry no rarity; those rows just render without the pill.
        rarityLabel: spell.rarity ? getRarityLabel(spell.rarity) : "",
        learnedBy: names.length ? game.i18n.format("BWS.Loot.LearnedBy", { actors: names.join(", ") }) : "",
        alreadyLearned,
        // Consumption is per-actor: the page is spent for whoever copied it, not for
        // the next reader.
        disabled: !target || (consume && alreadyLearned)
      });
    }

    return {
      ...(await super._prepareContext(options)),
      img: this.item?.img,
      groups,
      hasSpells: groups.length > 0,
      meta,
      metaLine: meta.level
        ? game.i18n.format("BWS.Loot.MetaLine", {
            level: meta.level,
            tradition: game.i18n.localize(`BWS.Loot.Tradition.${meta.tradition}`),
            profile: game.i18n.localize(`BWS.Loot.Profile.${meta.profile}`)
          })
        : "",
      seedLine: meta.seed
        ? game.i18n.format(meta.edited ? "BWS.Loot.SeedEdited" : "BWS.Loot.SeedLine", { seed: meta.seed })
        : "",
      targetLine: target
        ? game.i18n.format("BWS.Loot.TargetLine", { actor: target.actor.name })
        : game.i18n.localize("BWS.Loot.NoTarget"),
      hasTarget: !!target
    };
  }

  /**
   * Who is learning from this book.
   *
   * The book's own carrier wins: a book sitting in a character's inventory is being
   * read by that character. Otherwise fall back to the module's usual token/assigned
   * character resolution, which is what makes a book in a loot chest usable.
   *
   * @returns {{ actor: object, source: string }|null}
   */
  #resolveActor() {
    const parent = this.item?.parent;
    if (parent?.documentName === "Actor" && parent.isOwner && parent.type !== "loot") {
      return { actor: parent, source: game.i18n.localize("BWS.Loot.SourceCarrier") };
    }
    return resolveTargetActor();
  }

  /** Send one spell from the book into the reader's spellcasting entry. */
  static async #onLearn(event, target) {
    const uuid = target.dataset.uuid;
    if (!uuid) return;

    const resolved = this.#resolveActor();
    if (!resolved) {
      ui.notifications.warn(game.i18n.localize("BWS.Slot.NoActor"));
      return;
    }

    const created = await openSendToSlotDialog({ uuid, actor: resolved.actor });
    if (!created) return;

    if (setting(SETTINGS.TRACK_LEARNED, true)) await this.#recordLearned(uuid, resolved.actor.id);
    await this.render();
  }

  /**
   * Record that an actor has copied a spell out of this book.
   *
   * Silently skipped when the reader cannot write to the item - tracking is a
   * convenience, not something worth failing a successful learn over.
   *
   * @param {string} uuid Spell uuid.
   * @param {string} actorId Actor that learned it.
   * @returns {Promise<void>}
   */
  async #recordLearned(uuid, actorId) {
    if (!this.item?.isOwner) return;
    try {
      const meta = getLootMeta(this.item);
      if (!meta) return;
      const learned = foundry.utils.deepClone(meta.learned ?? {});
      const actors = new Set(learned[uuid] ?? []);
      actors.add(actorId);
      learned[uuid] = [...actors];
      await this.item.setFlag(MODULE_ID, LOOT_FLAG, { ...meta, learned });
    } catch (err) {
      console.warn("Blizzard's Wondrous Spellbook | Failed to record a learned spell", err);
    }
  }
}

/**
 * Open the reader for an item, refusing anything that is not a loot spellbook.
 * @param {object} item An Item document.
 * @returns {LootBookApp|null}
 */
export function openLootBook(item) {
  if (!isLootSpellbook(item)) {
    ui.notifications.warn(game.i18n.localize("BWS.Loot.NotALootBook"));
    return null;
  }
  const app = new LootBookApp({ item });
  app.render(true);
  return app;
}

/**
 * Add an "Open Spellbook" button to a loot book's item sheet header.
 *
 * Injected into the window header rather than registered as a sheet header control,
 * because PF2e's physical item sheet is not this module's to subclass. The button is
 * marked so repeated renders never stack copies of it.
 *
 * @param {object} app The rendered item sheet.
 * @param {HTMLElement|object} html The sheet's root element, or a jQuery wrapper.
 * @returns {void}
 */
export function injectLootBookButton(app, html) {
  const item = app?.document ?? app?.item;
  if (!isLootSpellbook(item)) return;

  const root = html instanceof HTMLElement ? html : html?.[0];
  // The header lives outside `.window-content` on ApplicationV2, so walk up to the
  // application frame before looking for it.
  const frame = root?.closest?.(".application, .app") ?? root;
  const header = frame?.querySelector?.(".window-header");
  if (!header || header.querySelector(".bws-open-loot-book")) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "header-control icon fa-solid fa-book-sparkles bws-open-loot-book";
  button.dataset.tooltip = game.i18n.localize("BWS.Loot.OpenBook");
  button.setAttribute("aria-label", game.i18n.localize("BWS.Loot.OpenBook"));
  button.addEventListener("click", (event) => {
    event.preventDefault();
    event.stopPropagation();
    openLootBook(item);
  });

  const close = header.querySelector("[data-action='close'], .close");
  header.insertBefore(button, close ?? null);
}

/**
 * Add an "Open Spellbook" entry to the Items directory context menu.
 *
 * Registered under both the current and the legacy hook name so the entry survives
 * Foundry's renaming of directory context hooks.
 *
 * @returns {void}
 */
export function registerLootBookContextMenu() {
  const entry = {
    name: "BWS.Loot.OpenBook",
    icon: '<i class="fa-solid fa-book-sparkles"></i>',
    condition: (li) => {
      const id = li instanceof HTMLElement ? li.dataset.entryId ?? li.dataset.documentId : li?.data?.("entry-id");
      return isLootSpellbook(game.items.get(id));
    },
    callback: (li) => {
      const id = li instanceof HTMLElement ? li.dataset.entryId ?? li.dataset.documentId : li?.data?.("entry-id");
      openLootBook(game.items.get(id));
    }
  };

  const add = (_directory, options) => options.push(entry);
  Hooks.on("getItemContextOptions", add);
  Hooks.on("getItemDirectoryEntryContext", add);
}
