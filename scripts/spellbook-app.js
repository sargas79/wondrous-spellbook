/**
 * The Spellbook Creator window.
 *
 * Built on ApplicationV2 + HandlebarsApplicationMixin. The window is split into three
 * parts so typing in the search box only re-renders the results list: the search input
 * itself lives in `header`, which is left untouched, so focus and caret position
 * survive without any manual restoration.
 *
 * A spellbook is storage only. Ticking a spell adds it to the book; the row's
 * "send to slot" arrow is a separate, immediate write to an actor and does not
 * require the book to be saved first.
 */

import { MODULE_ID, template } from "./constants.js";
import { TRADITIONS, querySpells, getRankBadge } from "./spell-query.js";
import { canEditSpellbook, createSpellbook, getStoredSpells, updateSpellbook } from "./persistence.js";
import { openSendToSlotDialog } from "./slot-manager.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class SpellbookApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /**
   * @param {object} [options]
   * @param {object} [options.journal] An existing spellbook JournalEntry to edit.
   */
  constructor(options = {}) {
    super(options);

    /** @type {object|null} The spellbook being edited, if any. */
    this.journal = options.journal ?? null;

    /** @type {string} */
    this.spellbookName = this.journal?.name ?? "";
    /** @type {string} */
    this.tradition = "all";
    /** @type {boolean} */
    this.includeFocus = false;
    /** @type {string} */
    this.search = "";

    /**
     * Selected spells, keyed by uuid. Seeded from the journal when editing so
     * previously stored records (including any animation flag) round-trip intact.
     * @type {Map<string, object>}
     */
    this.selected = new Map();
    for (const spell of getStoredSpells(this.journal)) this.selected.set(spell.uuid, spell);

    /** @type {boolean} True when the user may not write to this spellbook. */
    this.readOnly = !!this.journal && !canEditSpellbook(this.journal);

    this._debouncedSearch = foundry.utils.debounce(() => {
      this.render({ parts: ["body", "footer"] });
    }, 200);
  }

  /** @inheritdoc */
  static DEFAULT_OPTIONS = {
    id: "bws-spellbook-creator",
    classes: ["bws", "bws-creator"],
    tag: "div",
    window: {
      title: "BWS.Creator.Title",
      icon: "fa-solid fa-book-open",
      resizable: true
    },
    position: { width: 900, height: 640 },
    actions: {
      setTradition: SpellbookApp.#onSetTradition,
      sendToSlot: SpellbookApp.#onSendToSlot,
      removeSelected: SpellbookApp.#onRemoveSelected,
      save: SpellbookApp.#onSave,
      cancel: SpellbookApp.#onCancel
    }
  };

  /** @inheritdoc */
  static PARTS = {
    header: { template: template("creator-header.hbs") },
    body: { template: template("creator-body.hbs"), scrollable: [".bws-spell-list", ".bws-selected-list"] },
    footer: { template: template("creator-footer.hbs") }
  };

  /** @inheritdoc */
  get title() {
    return this.journal ? `${game.i18n.localize("BWS.Creator.Title")}: ${this.journal.name}` : super.title;
  }

  /** @inheritdoc */
  async _prepareContext(options) {
    const query = await querySpells({
      tradition: this.tradition,
      includeFocus: this.includeFocus,
      search: this.search
    });

    // Mark rows that are already in the book so the checkbox renders ticked.
    // `querySpells` hands back references into the shared compendium cache, so the
    // `selected` flag goes onto a shallow clone: mutating the cached record would
    // leak this window's selection into every other Spellbook Creator window.
    const groups = query.groups.map((group) => ({
      ...group,
      spells: group.spells.map((spell) => ({ ...spell, selected: this.selected.has(spell.uuid) }))
    }));

    const selected = [...this.selected.values()]
      .sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name))
      .map((spell) => ({ ...spell, rankBadge: getRankBadge(spell.rank) }));

    return {
      ...(await super._prepareContext(options)),
      spellbookName: this.spellbookName,
      tradition: this.tradition,
      traditions: [
        { key: "all", label: game.i18n.localize("BWS.Tradition.All"), active: this.tradition === "all" },
        ...TRADITIONS.map((key) => ({
          key,
          label: game.i18n.localize(`BWS.Tradition.${key.charAt(0).toUpperCase()}${key.slice(1)}`),
          active: this.tradition === key
        }))
      ],
      includeFocus: this.includeFocus,
      search: this.search,
      groups,
      hasResults: groups.length > 0,
      selected,
      selectedCount: selected.length,
      selectedCountLabel:
        selected.length === 1
          ? game.i18n.localize("BWS.Creator.SelectedCountOne")
          : game.i18n.format("BWS.Creator.SelectedCount", { count: selected.length }),
      readOnly: this.readOnly,
      canSave: !this.readOnly && selected.length > 0 && !!this.spellbookName.trim(),
      statusLine: game.i18n.format("BWS.Creator.StatusLine", {
        packs: query.packCount,
        indexed: query.indexed,
        shown: query.shown
      })
    };
  }

  /** @inheritdoc */
  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.element;

    // Every listener below is guarded by a marker attribute: parts re-render
    // independently, so a node that survived the last render must not be bound twice.
    const bind = (selector, event, handler) => {
      const node = root.querySelector(selector);
      if (!node || node.dataset.bwsBound === event) return;
      node.dataset.bwsBound = event;
      node.addEventListener(event, handler);
    };

    bind("[name='spellbookName']", "input", (event) => {
      this.spellbookName = event.currentTarget.value;
      // Only the save button's disabled state depends on the name.
      const save = root.querySelector("[data-action='save']");
      if (save) save.disabled = this.readOnly || !this.spellbookName.trim() || !this.selected.size;
    });

    bind("[name='search']", "input", (event) => {
      this.search = event.currentTarget.value;
      this._debouncedSearch();
    });

    bind("[name='includeFocus']", "change", (event) => {
      this.includeFocus = event.currentTarget.checked;
      this.render({ parts: ["body", "footer"] });
    });

    // Row checkboxes live inside `body`, which is replaced wholesale on each render,
    // so a single delegated listener on the freshly rendered list is enough.
    const list = root.querySelector(".bws-spell-list");
    if (list && list.dataset.bwsBound !== "change") {
      list.dataset.bwsBound = "change";
      list.addEventListener("change", (event) => {
        const checkbox = event.target.closest("input[type='checkbox'][data-uuid]");
        if (checkbox) this.#toggleSpell(checkbox.dataset.uuid, checkbox.checked);
      });
    }
  }

  /**
   * Add or remove a spell from the book.
   * @param {string} uuid Spell uuid.
   * @param {boolean} selected Whether the spell should be in the book.
   */
  #toggleSpell(uuid, selected) {
    if (this.readOnly) return;

    if (!selected) {
      this.selected.delete(uuid);
    } else {
      // Pull the normalised record straight out of the rendered context.
      const record = this.#findRenderedSpell(uuid);
      if (record) this.selected.set(uuid, record);
    }
    this.render({ parts: ["body"] });
  }

  /**
   * Look up a spell record from the most recent query result.
   * @param {string} uuid Spell uuid.
   * @returns {object|null}
   */
  #findRenderedSpell(uuid) {
    for (const group of this._lastQueryGroups ?? []) {
      const found = group.spells.find((s) => s.uuid === uuid);
      if (found) return found;
    }
    return null;
  }

  /** @inheritdoc */
  async _preparePartContext(partId, context, options) {
    const partContext = await super._preparePartContext(partId, context, options);
    // Cache the groups so checkbox toggles can resolve a uuid without re-querying.
    if (partId === "body") this._lastQueryGroups = context.groups;
    return partContext;
  }

  /** Switch the tradition filter. */
  static async #onSetTradition(event, target) {
    this.tradition = target.dataset.tradition ?? "all";
    await this.render({ parts: ["header", "body", "footer"] });
  }

  /** Send a compendium spell straight to an actor's slot. */
  static async #onSendToSlot(event, target) {
    const uuid = target.dataset.uuid;
    if (uuid) await openSendToSlotDialog({ uuid });
  }

  /** Drop a spell from the selection panel. */
  static async #onRemoveSelected(event, target) {
    if (this.readOnly) return;
    this.selected.delete(target.dataset.uuid);
    await this.render({ parts: ["body"] });
  }

  /** Persist the spellbook and close. */
  static async #onSave() {
    if (this.readOnly) {
      ui.notifications.warn(game.i18n.localize("BWS.Notify.NoPermission"));
      return;
    }

    const name = this.spellbookName.trim();
    if (!name) {
      ui.notifications.warn(game.i18n.localize("BWS.Notify.NoName"));
      return;
    }
    if (!this.selected.size) {
      ui.notifications.warn(game.i18n.localize("BWS.Notify.NoSpells"));
      return;
    }

    const spells = [...this.selected.values()];
    const result = this.journal
      ? await updateSpellbook(this.journal, { name, spells })
      : await createSpellbook({ name, spells });

    if (!result) return;

    ui.notifications.info(
      game.i18n.format(this.journal ? "BWS.Notify.Updated" : "BWS.Notify.Saved", { name })
    );
    Hooks.callAll(`${MODULE_ID}.spellbookSaved`, result);
    await this.close();
  }

  /** Close without saving. */
  static async #onCancel() {
    await this.close();
  }
}
