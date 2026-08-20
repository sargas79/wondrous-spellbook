# Blizzard's Wondrous Spellbook

A spellbook creator and slot-fill tool for the **Pathfinder Second Edition** system on **Foundry VTT v14**.

Build reusable spellbooks from your compendium spells, then send those spells straight into a
character's spellcasting slots — without replacing or reskinning the PF2e character sheet.

---

## What it does

**A spellbook is storage only.** It holds spells so they can be sent into an actor's existing
slots. Casting, and any animation that plays on cast, happen on the PF2e character sheet — not
in this module's windows.

- **Spellbook Creator** — browse every spell in every Item compendium, filtered by tradition,
  focus category and a free-text search over names and traits. Tick spells to collect them into
  a book; save the book as a Journal Entry.
- **My Spellbooks** — an ownership-filtered browser. GMs see every spellbook; players see only
  the ones they own.
- **Send to Slot** — the one write path from a spellbook to an actor. Pick a spellcasting entry
  and a rank; the spell is created as an embedded item bound to that entry, so it appears in the
  sheet's own spellcasting tab.
- **Animations (optional)** — when JB2A *and* Sequencer are both active, spell rows on the
  character sheet gain a gear button for attaching a Sequencer effect that fires when the spell
  is cast.

---

## Requirements

| | |
|---|---|
| **Foundry VTT** | v14 (verified against build 366) |
| **Game system** | Pathfinder Second Edition (verified against 8.4.1) |
| **Sequencer** | Optional |
| **JB2A** (`JB2A_DnD5e` or `jb2a_patreon`) | Optional |

Sequencer and JB2A are **soft dependencies**. Without them the module works normally and every
animation control is simply not rendered — no warnings, no broken buttons.

---

## Installation

Paste this manifest URL into Foundry's **Add-on Modules → Install Module** dialog:

```
https://github.com/sargas79/wondrous-spellbook/releases/latest/download/module.json
```

Or clone into your Foundry `Data/modules` directory:

```bash
git clone https://github.com/sargas79/wondrous-spellbook.git blizzards-wondrous-spellbook
```

---

## Usage

1. Click the **book icon** at the bottom of the sidebar control column to open *My Spellbooks*.
2. Hit **New** to open the Spellbook Creator.
3. Filter by tradition, toggle focus spells, or search by name or trait.
4. **Tick a spell** to add it to the book. **Click the ↓ arrow** to send that spell directly to
   the selected token's spellcasting entry — this works immediately and does not require saving.
5. Name the book and hit **Save spellbook**.

### Sending a spell to a slot

Select a token (or rely on your assigned character), then click ↓ on any spell row. The dialog
lists the actor's spellcasting entries and the ranks available on the chosen entry, with free
prepared-slot counts where applicable. Prepared entries get the spell placed into an actual
open slot; spontaneous and innate entries just receive the spell.

If the actor has no spellcasting entries, the dialog says so rather than offering an empty
dropdown.

### Attaching an animation

With JB2A and Sequencer both active, each spell row on the PF2e character sheet grows a small
gear button. Click it, enter a Sequencer database path (the field autocompletes against the
Sequencer database, and there's a button to open the Database Viewer), and save. The effect
plays on the caster's token when that spell is cast from the sheet.

The path is stored as a flag on the actor's spell item. If JB2A or Sequencer is later disabled,
**the flag is preserved** — the editing controls just disappear and playback is skipped
silently until both modules are active again.

---

## Permissions

Spellbooks are created with **ownership default NONE**, **OWNER for the creator**, and
**OWNER for every GM**, so any GM can always reach any spellbook regardless of who made it.

Players see only spellbooks they own, tested via `testUserPermission(user, "OWNER")` rather
than by comparing creator ids — so ownership granted after the fact is respected. Edit and
delete controls are disabled per-row for anyone without OWNER on that entry.

---

## Settings

| Setting | Scope | Default | Description |
|---|---|---|---|
| Character Sheet Integration | World | On | Inject the animation gear button into PF2e spell rows |
| Show Sidebar Button | Client | On | Add the spellbook button to the sidebar control column |
| Spellbook Folder Name | World | `Blizzard's Spellbooks` | Journal folder that stores every spellbook |

---

## API

The module exposes an API on its module entry and as a global:

```js
const api = game.modules.get("blizzards-wondrous-spellbook").api;

api.openCreator();                          // open a blank Spellbook Creator
api.openBrowser();                          // open My Spellbooks
api.sendToSlot({ uuid: "Compendium....." }); // open the Send to Slot dialog
api.getUserSpellbooks();                    // JournalEntry[] the current user may see
api.getAnimationsAvailable();               // boolean, re-evaluated live
```

---

## Project structure

```
module.json                      Manifest (Foundry v14, PF2e system relationship)
lang/en.json                     All UI strings
styles/spellbook.css             Nocturne-flavoured dark theme, scoped to .bws
scripts/
  constants.js                   Shared ids, settings keys, template path helper
  main.js                        init/ready hooks, settings, sidebar button
  spell-query.js                 Compendium query, filtering, rank grouping
  persistence.js                 Folder + JournalEntry writes, ownership rules
  spellbook-app.js               Spellbook Creator (ApplicationV2)
  my-spellbooks-app.js           My Spellbooks browser (ApplicationV2)
  slot-manager.js                Send to Slot dialog, character sheet injection
  animation-config.js            JB2A/Sequencer detection, config dialog, cast hooks
templates/                       Handlebars templates for the above
```

---

## Notes on PF2e compatibility

PF2e renamed spell "level" to "rank" in its interface, but the stored source data still lives at
`system.level.value`. Every accessor in `spell-query.js` reads the document getter first and falls
back to raw source paths, so the module tolerates data-model changes across PF2e releases.

Similarly, `slot-manager.js` prefers PF2e's own `SpellcastingEntryPF2e#addSpell` and
`#prepareSpell` helpers and only falls back to a manual `Item.create` + `system.location` write
if those are unavailable.

The spell-cast signal has moved between PF2e releases. The module listens on `pf2e.castSpell`
and additionally on `createChatMessage` (reading the cast card's origin flags) as a
version-tolerant fallback, de-duplicating so a single cast animates once.

---

## License

See [LICENSE](LICENSE).
