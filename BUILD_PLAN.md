# Build Plan

**Product:** Shelf
**Derived from:** TRD §18 build order
**Rule:** each step has an acceptance check. **Do not advance on a failing check.**

**Read [DECISIONS.md](DECISIONS.md) first.** Where PRD, TRD, and the design canvas
(`design/Shelf Library.dc.html`) disagree, DECISIONS.md is authoritative.

Steps are gated. One step is built, its check is run, and only then does the next begin.
Nothing is written ahead of its step — a file written early cannot be verified by the check
that was supposed to catch it being wrong.

---

## Status

| # | Step | State |
|---|---|---|
| 1 | Manifest, icons, empty worker | ✅ loads unpacked, worker boots |
| 2 | `db.js` | ✅ record round-tripped in worker console |
| 3 | `util.js` | ✅ 19 tests, 41 URL pairs |
| — | Safari quota probe | ⤵ deferred to step 10 (see note) |
| 4 | `background.js` | ✅ context menu saved on non-granted youtube.com |
| 5 | `content.js` | ✅ bar renders and saves on medium.com |
| 6 | `shelf.js` | ✅ renders; perf number outstanding |
| 7 | `export.js` | ⏳ awaiting file:// check |
| 8 | Backup | ⏳ awaiting acceptance check |
| 9 | Popup + onboarding | — |
| 10 | Safari conversion | — |

---

## Standing constraints

These hold at every step. A step that would violate one stops and asks first.

- **No build step.** Vanilla ES modules, no bundler, no framework, no runtime npm
  dependencies. `shelf/` loads unpacked as-is. (TRD §3)
- **`@types/chrome` is the only dependency**, dev-only, for editor support.
- **Zero network requests.** No `fetch`, no `XMLHttpRequest`, no remote fonts, no favicon
  fetching. Enforced by CSP `connect-src 'none'`. (TRD §14)
- **`content.js` is a classic script.** Content scripts cannot be ES modules. (TRD §4)
- **Never broad host permissions at install.** `optional_host_permissions` only, granted
  per site at runtime. (TRD §9)
- **Never guess at content.** If the excerpt ladder finds nothing, save nothing. Never fall
  through to `body.innerText`. (PRD §6.4, TRD §7.3)

---

## Step 1 — Manifest, icons, empty worker

**Deliverable:** the extension loads. No behaviour.

**Files:** `shelf/manifest.json`, `shelf/icons/{16,32,48,128}.png`, `shelf/src/background.js`

Establishes three things that are expensive to retrofit: the file layout, the permission
posture (§9), and the zero-network CSP (§14). The manifest references only files that exist
— no `default_popup`, `options_page`, `content_scripts`, or `commands` until their steps.

**Check:** loads via `chrome://extensions` → Load unpacked with no errors; worker console
shows the boot log; the extension card does **not** claim access to all websites.

---

## Step 2 — `db.js`

**Deliverable:** IndexedDB wrapper. Database `shelf`, version 1. `clips` store keyed on
`id` with indexes on `savedAt` and `urlHash`; `meta` store keyed on `key`. (TRD §5)

Connection caching must reset on `onclose` and `onversionchange` per §10.

**Check:** add and read back a record from the service worker console.

---

## Step 3 — `util.js`

**Deliverable:** pure helpers, no DOM. URL normalization is the load-bearing one — lowercase
scheme and host, strip `www.`, drop tracking params, sort the rest, strip trailing slash,
strip fragment except on a hash-routed allowlist. **Versioned from day one** so a future
rule change can trigger a migration rather than silently orphaning every stored `urlHash`.
(TRD §5.4)

Also: `sha256` → first 32 hex chars, whitespace collapse, relative/absolute time
formatting, HTML escaping.

**Check:** a fixture table of ~30 URL pairs passes. — `npm test`, 41 pairs, 19 tests.

Tests run on Node's built-in runner with no dependencies, from `test/` at the repo
root so nothing test-related is ever packaged. `npm test` is the only npm script;
`@types/chrome` is the only entry in devDependencies and there are no dependencies.

---

## Safari quota probe (between 3 and 4)

Not a feature — a measurement, taken before anything is built on top of the assumption.
Insert 500 realistic clips, log `navigator.storage.estimate()`, find where writes fail.
`unlimitedStorage` may not be honoured on Safari. Verify `showDirectoryPicker` availability
in the same pass, since step 8 depends on it. (TRD §17)

**Check:** ceiling measured and written down before more is built on it.

**Deferred to step 10** (2026-08-20, user direction: finish Chrome first). Two reasons
it is safe to move: it needs the Safari + Xcode toolchain that step 10 sets up anyway,
and D2 removed the risk it was sized for. The probe assumed thumbnails; with letter
avatars at ~500 bytes per clip, 5,000 clips is 2.5MB — far from any plausible ceiling.
Still run before Safari submission, not skipped.

---

## Step 4 — `background.js`

**Deliverable:** the service worker earns its keep. Context menu "Save selection to Shelf",
`SAVE_CLIP` and `PAGE_STATE` message handlers, runtime content-script registration synced
on `onStartup` / `permissions.onAdded` / `permissions.onRemoved` (unregister before
register or duplicate-id errors throw). (TRD §8, §9)

**The context menu is built first** because `info.selectionText` arrives with the click,
independent of host permissions. It is the one save path that works everywhere, and the
degradation contract in §9.1 rests on it.

**Check:** context menu saves a clip on a site that has **not** been granted access.

---

## Step 5 — `content.js`

**Deliverable:** the floating save bar. Classic IIFE, guarded by `window.__shelfLoaded`.
Selection watched via debounced `mouseup` + `selectionchange`; qualifies at ≥2 chars after
collapse and never inside `input`, `textarea`, or `[contenteditable]`. Renders in a
**closed shadow root** with `all: initial` on the host — page CSS will otherwise destroy it.
`mousedown` handlers must `preventDefault()` or the click collapses the selection before it
fires. Captures 32 chars of prefix/suffix off the `Range` (TRD §6) and media `currentTime`
if a `<video>` is playing (§7.2).

The clip is written **before** any confirmation renders — nothing is lost if the user
navigates away immediately. (PRD §8.1)

**Check:** bar appears, positions correctly at viewport edges, and saves.

---

## Step 6 — `shelf.js`

**Deliverable:** the library. Reverse-chronological, grouped by day, continuous timeline
down the left, each clip pinned at its own time. The passage is the largest element on the
row; the source is secondary. Search is a linear scan, AND-matching lowercase tokens
against `text + note + title + domain`, with matched terms marked — no index until
measurement demands one (TRD §11). Notes and colours land here.

No favicons. Letter avatars with a domain-derived hue. (TRD §14)

**Check:** 200 seeded clips render in < 200ms; `/` focuses search.

---

## Step 7 — `export.js`

**Deliverable:** one self-contained HTML file — inline style, inline JSON payload, inline
filter script. `</script>` inside the JSON must be escaped as `\u003c` or the payload
breaks out of its own tag. Deterministic: sort by `savedAt` descending, stable key order,
no timestamps in output. Default scope is `isPublic` clips only; full-corpus export needs
explicit selection and shows a count-and-domain tally first. (TRD §12, PRD §8.4)

**Check:** opened from `file://` it renders and filters with **zero network requests**;
identical input produces byte-identical output.

---

## Step 8 — Backup

**Deliverable:** File System Access API, handle persisted in `meta`, written as
`shelf-backup.json`. Runs automatically when the shelf opens if the last backup is older
than 12 hours — **on shelf open, not in the worker**, because handles lose permission
across restarts and `requestPermission()` needs a user gesture a worker cannot obtain.
Degrades to manual JSON download where `showDirectoryPicker` is unavailable. (TRD §13)

**Check:** folder picked, file written, survives a browser restart.

---

## Step 9 — Popup + onboarding

**Deliverable:** popup showing per-site permission state with one-click grant, save-page
action, recent clips. Onboarding is four screens; screen 2 (where your data lives) is not
skippable without either configuring a backup or explicitly dismissing a "you have no
backup" warning. The onboarding page saves itself as the first clip so the shelf isn't
empty. (PRD §9)

**Check:** the backup warning is unavoidable on first run.

---

## Step 10 — Safari conversion

```
xcrun safari-web-extension-converter shelf/ \
  --project-location ../shelf-safari --app-name Shelf --macos-only
```

Development needs Xcode plus Safari → Develop → Allow Unsigned Extensions (resets every
quit). The $99/year account is needed to ship, not to develop. (TRD §17)

**Check:** runs in Safari; the §16 manual checklist passes end to end.

---

## Manual checklist (run before each submission)

From TRD §16. No automation exists for Safari, so this is run by hand.

1. Fresh install → welcome screen
2. Context menu save on a **non-granted** site → record written
3. Grant one site → bar appears on selection
4. Save 5 clips across 3 domains → grouped under Today with times
5. Search → only matches, terms highlighted
6. Note persists across reload
7. Delete → undo restores
8. Mark 2 shared → export "marked" → exactly 2 in file
9. Export "everything" → warning shows correct counts
10. Open export from `file://` → renders, filters, **zero network requests**
11. Backup folder → JSON written → reimport into fresh profile → all clips return
12. Revoke permissions → bar gone, context menu still works

---

## Performance budgets (TRD §15)

| Operation | Budget |
|---|---|
| Content script idle cost, no selection | < 3ms |
| Save bar appears after selection | < 60ms |
| Save write round-trip | < 80ms |
| Search, 5,000 clips | < 20ms |
| Shelf first render, 500 clips | < 200ms |
| Export, 500 clips | < 1s |
