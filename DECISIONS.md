# Decisions

Project-wide architectural decisions. **Read this before PRD.md or TRD.md** — where they
disagree with each other or with the design canvas, this file is authoritative.

Original decisions are immutable. Changes go in a dated `### Amendment` block appended to
the decision, never by editing the original.

---

## 2026-08-20 — Design canvas reconciliation

`design/Shelf Library.dc.html` arrived after PRD v0.2 and TRD v0.2 were written and
conflicts with them in six places. Resolutions below. The canvas covers the **library page
and six popup states only**; the save bar, onboarding, and backup UI are undesigned and
resolved at their own build steps.

### D1 — Typography is self-hosted, never fetched

The canvas loads Lora and Karla from `fonts.googleapis.com`. That is a network request and
is forbidden (TRD §14, and an explicit project constraint).

**Decision:** ship Lora and Karla as Latin-subset `.woff2` files in `shelf/fonts/`,
declared with local `@font-face`. The design renders as drawn with zero network.

The font files are downloaded **once, by hand, at development time** and committed as
ordinary binary assets. This is not a build step and not a runtime dependency — it is the
same category of act as committing the icon PNGs. Verified feasible 2026-08-20.

Applies at step 6 (`theme.css`). Until then no font is referenced anywhere.

### D2 — No image thumbnails. The right-hand card is a letter avatar

The canvas draws a 132×88 card per row and a "Clear thumbnails" storage-pressure state,
implying captured page images. Nothing in PRD or TRD provides for this.

**Decision:** the card renders exactly what the mockup actually draws — a bordered card
containing a large Lora initial derived from the domain. No image is captured, stored, or
displayed. No `captureVisibleTab`, no new permission, no new object store.

**Why this is load-bearing:** ~500 bytes per clip is the premise under three separate TRD
conclusions — no pagination below ~2,000 clips (§11), loading every clip into memory to
search (§11), and the expectation that Safari's quota won't bite (§17). Screenshots run
20–40KB each, 50× that budget, and all three conclusions fail together. Consistent with
§14's existing refusal to fetch favicons for the same reason.

The storage-pressure popup state is kept, driven by `navigator.storage.estimate()`, but its
remedy is export, not clearing thumbnails.

### D3 — The passage leads when there is one

The canvas makes the title the row's largest element and the passage an optional italic
quote beneath it. PRD §8.2 requires the opposite: "the passage itself is the largest
element on the row… a list of sentences, not a list of links."

**Decision:** hierarchy is conditional on what was actually saved.

| Clip has | Leads the row (20px Lora) | Demoted to the meta line |
|---|---|---|
| A selected passage | the passage | title, domain, time |
| No passage (page save) | the title | domain, time |

Honours §8.2 for the primary flow — selection capture — while keeping the canvas exactly as
drawn for the page-save case it was designed around. Applies at step 6.

### D4 — Export JSON and export HTML are two different features

The canvas has one header button, "Export JSON", which downloads the whole library
unfiltered. TRD §12 specifies a self-contained **HTML** export, scoped to `isPublic` clips,
gated behind a count-and-domain-tally confirmation.

**Decision:** both exist, and they are not the same thing.

- **Back up** → JSON, whole library, no confirmation. This is §13's format and the canvas's
  button. It is a personal safety act with no sharing risk.
- **Share** → HTML, `isPublic` clips only, count-and-tally confirmation required
  (§12, PRD §8.4). Full-corpus HTML export is never the default.

The canvas's button is the backup path and keeps its label. The share flow is undesigned;
resolved at step 7.

**Why the confirmation survives:** PRD §8.4 calls an accidentally published reading history
the worst outcome available in this product. That safety mechanism attaches to the sharing
path specifically, so routing backup around it costs nothing.

### D5 — The `color` field stays in the schema; no picker until it is designed

The canvas uses a single teal accent and has no colour-coding UI. PRD U9 and TRD §5.1 both
specify five clip colours.

**Decision:** keep `color` in the record with a default, so no migration is needed later.
Ship no colour UI in v1 — the canvas is the design of record and it has none. PRD U9 is P1,
not P0, so this costs no committed scope.

### D6 — Delete is undoable

The canvas deletes immediately, from both the per-row "Remove" and the bulk action. TRD §16
check 7 requires "Delete → undo restores".

**Decision:** the check wins. Deletion shows an undo affordance and is reversible for the
duration of that affordance. Resolved concretely at step 6.

### Amendment — 2026-08-20 — accent is terracotta, not teal

Canvas revised. `--accent` moved `#1F5C5C` → `#A8462A` (light) and `#83BBB1` → `#E39272`
(dark); `--accent-soft` moved `#E7EFED` → `#F6EAE4` and `#1D2A28` → `#2C1F1A`. Every other
token is unchanged.

Two surfaces hardcode the accent and cannot pick it up from a stylesheet: the save bar
(closed shadow root) and the toolbar badge (a `chrome.action` call). Both updated.

The save button's hover shade is **derived, not from the canvas**: `#8E3A22`, darker than
the accent. The instinct is to lighten on hover, but paper-on-terracotta at `#C15634` is
4.33:1 — below WCAG AA — on the one control the entire feature depends on. Darker gives
7.24:1.

`test/design.test.mjs` now reads the accent out of the canvas and fails if shipped code
disagrees, or if any hex in the source is not traceable to a current token or a listed
derived shade. Palette drift is otherwise invisible: the design changes everywhere except
the two surfaces the user actually touches while saving.

### Amendment — 2026-08-20 — logo is mark 1a "Stack"

Chosen from the four in `design/Shelf Logo.dc.html`. Three rounded bars of descending
width, the top one in accent — "shelved lines, one just saved". It reads at 16px better
than the alternatives because it is pure horizontal mass with no enclosing shape stealing
pixels, and its meaning is the product's actual verb.

Icons are cut from that SVG geometry verbatim, **including the canvas's per-size optical
adjustments**: as the mark shrinks the bars get thicker and wider and the corner radius
grows (16px uses 8-unit bars at rx 4; 128px uses 6-unit bars at rx 3). Scaling one
drawing down instead would thin the bars into mush at toolbar size.

**Treatment is the dark tile, not the bare mark.** The canvas presents both; the tile is
the 52px rounded square in each card's footer. A toolbar icon sits on light *and* dark
browser chrome, and the two muted bars are near-black at 16–22% opacity — on a dark
toolbar the bare mark would show one terracotta bar and nothing else. The tile uses
`--dark` #131615 with `--dark-accent` #E39272, so the whole mark survives any background.

Verified at 16px pixel by pixel: three distinct bars, 1px gaps, widths 12/9/6.

### Kept from the canvas, absent from the specs

Adopted as-is, no conflict: date-range filter, Newest/Oldest/Title sort, light/dark theme
toggle, the "Restricted page" popup state, the storage-pressure popup state, and
`rel="noreferrer"` on outbound links.

Theme preference persists to `browser.storage.local` alongside `defaultColor` (TRD §5.3),
not to `localStorage` as the mock does — the mock had no extension storage available.

### Undesigned surfaces

Not covered by the canvas. Each is resolved at its build step, not now.

| Surface | Step | Spec |
|---|---|---|
| Floating save bar (shadow DOM) | 5 | TRD §7.1 |
| Static HTML share export | 7 | TRD §12, PRD §8.4 |
| Backup folder picker and warning | 8 | TRD §13, PRD §9 screen 2 |
| Four onboarding screens | 9 | PRD §9 |

---

## 2026-08-20 — Extension root is `shelf/`

`manifest.json` lives in `shelf/`, not at the repo root, so PRD.md, TRD.md, BUILD_PLAN.md,
this file, `design/`, and `.claude/` are never packaged into a store submission. Matches
TRD §4.1's tree and lets §17's `xcrun safari-web-extension-converter shelf/` run unmodified.
