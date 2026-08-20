/**
 * The Loot Spellbook Generator window.
 *
 * GM-facing. Rolls a level-appropriate spell list, previews it, and writes it to a
 * physical Item - either into the world's loot folder or straight onto the selected
 * tokens' actors.
 *
 * Every control change re-rolls against the seed currently in the seed field, so the
 * preview always matches the form. The dice button next to the seed is what produces a
 * genuinely different book.
 */

import { template } from "./constants.js";
import { RARITIES, TRADITIONS, getRankBadge, getRankLabel } from "./spell-query.js";
import {
  MAX_LEVEL,
  PROFILES,
  createLootSpellbook,
  drawReplacement,
  estimatePrice,
  generateLootSpellbook,
  getDefaultMaxRarity,
  getDefaultProfile,
  getLootFolderName,
  maxRankForLevel,
  randomSeed
} from "./loot-generator.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class LootGeneratorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  /**
   * @param {object} [options] Standard ApplicationV2 options. Any of `level`,
   *   `tradition`, `profile` and `seed` seed the form.
   */
  constructor(options = {}) {
    super(options);

    /** @type {number} */
    this.level = Number(options.level) || 5;
    /** @type {string} */
    this.tradition = options.tradition ?? "random";
    /** @type {string} */
    this.profile = options.profile ?? getDefaultProfile().key;
    /** @type {string} */
    this.maxRarity = options.maxRarity ?? getDefaultMaxRarity();
    /** @type {number|null} Explicit spell count, or null to let the profile decide. */
    this.count = null;
    /** @type {boolean} */
    this.includeCantrips = true;
    /** @type {boolean} */
    this.includeFocus = false;
    /** @type {string} */
    this.seed = options.seed ?? randomSeed();
    /** @type {"directory"|"selected"} */
    this.target = "directory";

    /** @type {string} Book title, editable once a roll has produced one. */
    this.bookName = "";
    /** @type {{ spells: object[], meta: object, shortfall: number }|null} */
    this.result = null;
    /** @type {boolean} True while a roll is in flight. */
    this.rolling = false;
  }

  /** @inheritdoc */
  static DEFAULT_OPTIONS = {
    id: "bws-loot-generator",
    classes: ["bws", "bws-loot-generator"],
    tag: "div",
    window: {
      title: "BWS.Loot.Title",
      icon: "fa-solid fa-dice-d20",
      resizable: true
    },
    position: { width: 660, height: 620 },
    actions: {
      reroll: LootGeneratorApp.#onReroll,
      newSeed: LootGeneratorApp.#onNewSeed,
      rerollSpell: LootGeneratorApp.#onRerollSpell,
      removeSpell: LootGeneratorApp.#onRemoveSpell,
      create: LootGeneratorApp.#onCreate,
      cancel: LootGeneratorApp.#onCancel
    }
  };

  /** @inheritdoc */
  static PARTS = {
    body: { template: template("loot-generator.hbs"), scrollable: [".bws-loot-preview"] }
  };

  /** @inheritdoc */
  async _prepareContext(options) {
    // First open rolls immediately: an empty preview would say nothing useful.
    if (!this.result && !this.rolling) await this.#roll();

    const spells = this.result?.spells ?? [];
    const meta = this.result?.meta ?? null;

    const groups = [];
    for (const spell of spells) {
      let group = groups.at(-1);
      if (!group || group.rank !== spell.rank) {
        group = { rank: spell.rank, label: getRankLabel(spell.rank), spells: [] };
        groups.push(group);
      }
      group.spells.push({ ...spell, rankBadge: getRankBadge(spell.rank) });
    }

    const selectedTokens = canvas?.tokens?.controlled?.filter((t) => t.actor) ?? [];

    return {
      ...(await super._prepareContext(options)),
      level: this.level,
      maxLevel: MAX_LEVEL,
      maxRank: maxRankForLevel(this.level),
      traditions: [
        { key: "random", label: game.i18n.localize("BWS.Loot.Tradition.random") },
        { key: "mixed", label: game.i18n.localize("BWS.Loot.Tradition.mixed") },
        ...TRADITIONS.map((key) => ({ key, label: game.i18n.localize(`BWS.Loot.Tradition.${key}`) }))
      ].map((t) => ({ ...t, selected: t.key === this.tradition })),
      profiles: Object.values(PROFILES).map((p) => ({
        key: p.key,
        label: game.i18n.localize(`BWS.Loot.Profile.${p.key}`),
        hint: game.i18n.localize(`BWS.Loot.ProfileHint.${p.key}`),
        selected: p.key === this.profile
      })),
      rarities: RARITIES.filter((r) => r !== "unique").map((key) => ({
        key,
        label: game.i18n.localize(`BWS.Loot.Rarity.${key}`),
        selected: key === this.maxRarity
      })),
      count: this.count ?? "",
      includeCantrips: this.includeCantrips,
      includeFocus: this.includeFocus,
      seed: this.seed,
      target: this.target,
      targetIsDirectory: this.target === "directory",
      targetIsSelected: this.target === "selected",
      folderName: getLootFolderName(),
      selectedCount: selectedTokens.length,
      selectedNames: selectedTokens.map((t) => t.actor.name).join(", "),
      bookName: this.bookName,
      groups,
      hasSpells: spells.length > 0,
      spellCount: spells.length,
      shortfall: this.result?.shortfall ?? 0,
      edited: !!meta?.edited,
      summaryLine: meta
        ? game.i18n.format("BWS.Loot.SummaryLine", {
            count: spells.length,
            tradition: game.i18n.localize(`BWS.Loot.Tradition.${meta.tradition}`),
            rarity: game.i18n.localize(`BWS.Loot.Rarity.${meta.rarity}`),
            price: estimatePrice(meta, spells)
          })
        : "",
      canCreate: spells.length > 0 && !!this.bookName.trim()
    };
  }

  /**
   * Roll a fresh book from the current form state.
   * @param {object} [options]
   * @param {boolean} [options.keepName=false] Preserve a title the GM has edited.
   * @returns {Promise<void>}
   */
  async #roll({ keepName = false } = {}) {
    this.rolling = true;
    try {
      const result = await generateLootSpellbook({
        level: this.level,
        tradition: this.tradition,
        profile: this.profile,
        count: this.count,
        includeCantrips: this.includeCantrips,
        includeFocus: this.includeFocus,
        maxRarity: this.maxRarity,
        seed: this.seed
      });
      this.result = result;
      // The rolled tradition is what the book actually is, so the form stops saying
      // "random" once a roll has resolved it.
      if (this.tradition === "random") this.tradition = result.meta.tradition;
      if (!keepName || !this.bookName.trim()) this.bookName = result.name;
    } catch (err) {
      console.error("Blizzard's Wondrous Spellbook | Loot generation failed", err);
      ui.notifications.error(game.i18n.localize("BWS.Loot.RollFailed"));
    } finally {
      this.rolling = false;
    }
  }

  /** @inheritdoc */
  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.element;

    // Text and number fields update state without a re-render, so typing is never
    // interrupted; the re-roll happens on `change` (blur or Enter) instead.
    const onInput = (name, handler) => {
      const node = root.querySelector(`[name='${name}']`);
      node?.addEventListener("input", (event) => handler(event.currentTarget));
    };
    const onChange = (name, handler) => {
      const node = root.querySelector(`[name='${name}']`);
      node?.addEventListener("change", async (event) => {
        handler(event.currentTarget);
        await this.#roll({ keepName: true });
        await this.render();
      });
    };

    onInput("bookName", (node) => {
      this.bookName = node.value;
      const create = root.querySelector("[data-action='create']");
      if (create) create.disabled = !this.bookName.trim() || !this.result?.spells.length;
    });
    onInput("seed", (node) => {
      this.seed = node.value.trim() || randomSeed();
    });

    onChange("level", (node) => {
      this.level = Math.clamp(Number(node.value) || 1, 1, MAX_LEVEL);
    });
    onChange("tradition", (node) => {
      this.tradition = node.value;
    });
    onChange("profile", (node) => {
      this.profile = node.value;
    });
    onChange("maxRarity", (node) => {
      this.maxRarity = node.value;
    });
    onChange("count", (node) => {
      const value = Number(node.value);
      this.count = node.value === "" || !Number.isFinite(value) ? null : Math.clamp(value, 1, 60);
    });
    onChange("includeCantrips", (node) => {
      this.includeCantrips = node.checked;
    });
    onChange("includeFocus", (node) => {
      this.includeFocus = node.checked;
    });
    onChange("seed", (node) => {
      this.seed = node.value.trim() || randomSeed();
    });

    // The target radios only change where the item is written, so they never re-roll.
    for (const radio of root.querySelectorAll("[name='target']")) {
      radio.addEventListener("change", (event) => {
        this.target = event.currentTarget.value;
        this.render();
      });
    }
  }

  /** Roll again with the seed in the field. */
  static async #onReroll() {
    await this.#roll();
    await this.render();
  }

  /** Take a brand new seed and roll again. */
  static async #onNewSeed() {
    this.seed = randomSeed();
    await this.#roll();
    await this.render();
  }

  /** Swap one page for another of the same rank. */
  static async #onRerollSpell(event, target) {
    if (!this.result) return;
    const uuid = target.dataset.uuid;
    const index = this.result.spells.findIndex((s) => s.uuid === uuid);
    if (index < 0) return;

    const replacement = await drawReplacement({
      meta: this.result.meta,
      exclude: this.result.spells.map((s) => s.uuid),
      rank: this.result.spells[index].rank,
      includeFocus: this.includeFocus
    });
    if (!replacement) {
      ui.notifications.warn(game.i18n.localize("BWS.Loot.NoReplacement"));
      return;
    }

    this.result.spells[index] = replacement;
    this.result.spells.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
    // Hand-edited books no longer reproduce from their seed; say so on the item.
    this.result.meta.edited = true;
    await this.render();
  }

  /** Drop a page from the book. */
  static async #onRemoveSpell(event, target) {
    if (!this.result) return;
    this.result.spells = this.result.spells.filter((s) => s.uuid !== target.dataset.uuid);
    this.result.meta.edited = true;
    await this.render();
  }

  /** Write the book to the world or onto the selected actors. */
  static async #onCreate() {
    if (!this.result?.spells.length) {
      ui.notifications.warn(game.i18n.localize("BWS.Loot.NothingRolled"));
      return;
    }
    const name = this.bookName.trim();
    if (!name) {
      ui.notifications.warn(game.i18n.localize("BWS.Notify.NoName"));
      return;
    }

    let actors = [];
    if (this.target === "selected") {
      // De-duplicated: several tokens can share one actor, and each copy would be a
      // separate book in the same inventory.
      actors = [...new Set((canvas?.tokens?.controlled ?? []).map((t) => t.actor).filter(Boolean))];
      if (!actors.length) {
        ui.notifications.warn(game.i18n.localize("BWS.Loot.NoSelection"));
        return;
      }
    }

    const created = await createLootSpellbook({
      name,
      spells: this.result.spells,
      meta: this.result.meta,
      actors
    });
    if (!created.length) return;

    ui.notifications.info(
      actors.length
        ? game.i18n.format("BWS.Loot.CreatedOnActors", { name, count: created.length })
        : game.i18n.format("BWS.Loot.CreatedInFolder", { name, folder: getLootFolderName() })
    );
    await this.close();
  }

  /** Close without writing anything. */
  static async #onCancel() {
    await this.close();
  }
}
