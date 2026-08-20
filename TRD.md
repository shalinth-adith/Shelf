# Technical Requirements Document

**Product:** Shelf
**Type:** Browser extension — local-first text clipping
**Targets:** Chrome (MV3), Safari 17+ (Web Extension, macOS)
**Status:** v0.2 — scoped for build
**Supersedes:** v0.1, which specified on-page highlight restoration. That is cut. See §6.

---

## 1. Summary

Select text on any webpage, click Save, and the passage is written to local storage with a timestamp. Open the shelf to see everything clipped, grouped by day, searchable.

No account, no server, no network requests. Sharing is a static HTML file generated on demand.

---

## 2. Scope

**In:** selection capture, local storage, day-grouped timeline, search, notes, colours, static HTML export, JSON backup/restore, per-site permissions.

**Out:** on-page highlight repainting (§6), sync, tags, full article text extraction, PDF, new tab override, AI features.

---

## 3. Stack decision — no build step

Vanilla ES modules, zero runtime dependencies, no bundler. The source tree *is* the extension; `load unpacked` points directly at it.

Rationale: the app is ~1,200 lines. A bundler adds a `dist/` indirection that complicates Safari conversion and buys nothing. MV3 forbids remote code regardless, so everything would be bundled anyway.

`@types/chrome` is a dev-only dependency for editor support. Nothing is installed at runtime.

---

## 4. Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│ content.js      │────▶│  background.js   │◀────│  shelf.html/js  │
│ (per tab)       │     │  (service worker)│     │  (extension pg) │
│                 │     └────────┬─────────┘     └────────┬────────┘
│ shadow-DOM bar  │              │                        │
│ selection watch │              ▼                        │
│ capture         │       ┌─────────────┐                 │
└─────────────────┘       │  IndexedDB  │◀────────────────┘
                          └─────────────┘
                                 ▲
                          ┌──────┴──────┐
                          │  popup.html │
                          └─────────────┘
```

**content.js** — classic script (content scripts cannot be ES modules). Watches selection, renders the save bar in a closed shadow root, sends captures to the worker. Holds no durable state. Never modifies the page.

**background.js** — ES module service worker. Owns every write. Handles commands, context menu, and runtime content-script registration.

**shelf.html/js** — the library. Reads IndexedDB directly. Renders, searches, exports, backs up.

**popup.html/js** — per-site permission state, save-page action, recent clips.

### 4.1 File tree

```
shelf/
├── manifest.json
├── icons/            16, 32, 48, 128 px
└── src/
    ├── db.js         IndexedDB wrapper
    ├── util.js       pure helpers, no DOM
    ├── background.js service worker
    ├── content.js    classic IIFE
    ├── theme.css     design tokens
    ├── popup.html/js
    ├── shelf.html/css/js
    └── export.js     static HTML generator
```

### 4.2 Cross-browser

One source tree. `xcrun safari-web-extension-converter shelf/` produces the Safari Xcode project. Browser divergence goes behind a single capability check, never scattered `isChrome` branches.

---

## 5. Data model

IndexedDB, database `shelf`, version 1.

### 5.1 `clips` store — keyPath `id`

```ts
{
  id:           string;   // crypto.randomUUID()
  text:         string;   // selected passage, whitespace-collapsed
  note:         string;   // user annotation, default ''
  color:        'yellow'|'green'|'blue'|'pink'|'purple';
  url:          string;   // source, including media timestamp if any
  canonicalUrl: string;
  urlHash:      string;   // sha-256 of canonicalUrl, first 32 hex chars
  domain:       string;
  title:        string;
  context:      { prefix: string; suffix: string };  // see §6
  seconds:      number | null;   // media position at capture
  savedAt:      number;          // epoch ms
  isPublic:     boolean;         // export inclusion, default false
}
```

Indexes: `savedAt`, `urlHash`.

### 5.2 `meta` store — keyPath `key`

`{ key, value }`. Holds `installedAt`, `backupDir` (a `FileSystemDirectoryHandle`, structured-cloneable), `lastBackupAt`.

### 5.3 Settings

`browser.storage.local` only, for small values read from every surface: `defaultColor`.

### 5.4 URL normalization

Pure, versioned function with a fixture test table. Rules: lowercase scheme and host, strip `www.`, drop tracking params (`utm_*`, `fbclid`, `gclid`, `msclkid`, `igshid`, `ref_src`, …), sort remaining params, strip trailing slash, strip fragment except on a hash-routed allowlist.

**Load-bearing.** If the rules change, stored `urlHash` values stop matching. Version it from day one so a future change can trigger a migration.

---

## 6. What was cut, and the hedge

v0.1 specified re-finding clipped text on a revisited page and repainting the highlight — a six-tier selector fallback with fuzzy matching, a MutationObserver retry loop, and a 25-page mutation corpus to test it. That was the largest and riskiest component in the project.

**It is cut.** The value of this product is the collection, not the page. Clips are read in the shelf, not in situ.

**The hedge:** capture still records 32 characters of `prefix` and `suffix` around every selection, straight off the `Range`. Costs ~100 bytes and no engineering time. Unused in v1.

The asymmetry that justifies it: if repainting is ever added, stored context makes it work **retroactively on every clip ever saved**. Omit it and highlighting would only ever work for clips made after that release, with the entire back catalogue permanently unpaintable. Cheap to store, impossible to backfill.

---

## 7. Capture

### 7.1 Selection

Content script watches `mouseup` (debounced 10ms) and `selectionchange`. A selection qualifies if non-collapsed, ≥2 characters after whitespace collapse, and not inside `input`, `textarea`, or `[contenteditable]`.

The save bar renders in a **closed shadow root**. Non-negotiable: page CSS will otherwise destroy it. `mousedown` handlers must call `preventDefault()` or clicking the bar collapses the selection before the click handler fires.

Guard against double injection with `window.__shelfLoaded`.

### 7.2 Media position

If a `<video>` is present with `currentTime > 1`, store integer seconds and append the site's time parameter to the saved URL (`?t=8s` on YouTube). Clicking the clip returns to the moment.

### 7.3 Page-level saves — the excerpt ladder

When saving with no selection, resolve the excerpt in this order:

1. `og:description` → `twitter:description` → `meta[name="description"]`
2. JSON-LD `description` or `articleBody`
3. `<article>` innerText, if longer than 200 characters
4. **Nothing.** Empty excerpt.

**Never fall through to `body.innerText`.** On app-shell pages it captures navigation labels, sidebar recommendations, and subscriber counts. An empty excerpt reads as intentional; scraped chrome reads as broken.

---

## 8. Message protocol

All writes route through the service worker. Only the worker and the shelf page touch IndexedDB.

| Message | Direction | Payload | Returns |
|---|---|---|---|
| `SAVE_CLIP` | content/popup → SW | `{text, color, url, title, context, seconds}` | `{ok, id, pageCount}` |
| `PAGE_STATE` | popup → SW | `{url}` | `{ok, pageCount, total, granted}` |
| `CAPTURE_SELECTION` | SW → content | — | `{ok, reason?}` |
| `PING` | SW → content | — | `{ok}` (presence probe) |

---

## 9. Permissions

```json
"permissions": ["storage", "unlimitedStorage", "activeTab", "scripting", "contextMenus"],
"optional_host_permissions": ["http://*/*", "https://*/*"]
```

**Never request broad host access at install.** Safari's model forces per-site granting regardless, and install-time `<all_urls>` pushes Chrome Web Store submission into the slow review tier.

Content scripts are registered at runtime via `chrome.scripting.registerContentScripts`, matched to whatever origins the user has granted. Re-sync on `onStartup`, `permissions.onAdded`, and `permissions.onRemoved`. Unregister before registering or duplicate-id errors throw.

### 9.1 Degradation contract

| Granted | Save bar | Keyboard shortcut | Context menu |
|---|---|---|---|
| Site granted | ✅ | ✅ | ✅ |
| Not granted | ❌ | ❌ (badge `!`) | ✅ |

The context menu works everywhere because `info.selectionText` arrives with the click, independent of host permissions. **It is the universal fallback and should be the first save path built.**

Note: `chrome.commands` other than `_execute_action` do not grant `activeTab`, so the keyboard shortcut cannot request permission on its own.

---

## 10. Service worker lifetime

MV3 workers terminate after ~30s idle.

- No module-scope mutable state that matters.
- Cache the IndexedDB connection but reset it in `onclose` and `onversionchange` — a stale handle throws.
- No `setTimeout` beyond a few seconds; use `chrome.alarms`.

---

## 11. Search

Linear scan over an in-memory array, AND-matching lowercase tokens against `text + note + title + domain`.

No search index. At ~500 bytes per clip, 5,000 clips is 2.5MB in memory and filters in well under 10ms. Add MiniSearch only when measurement shows a problem.

---

## 12. Export

One self-contained HTML file: inline `<style>`, inline JSON payload, inline filter script. **Zero external requests** — verify with an empty network tab.

**Escape `</script>` inside the inlined JSON** (`\u003c`) or the payload breaks out of its own tag.

**Determinism:** identical input produces byte-identical output. Sort by `savedAt` descending, stable key order, no timestamps in output except an optional `generatedAt`. Makes committing an export to a Pages repo produce clean diffs.

**Scope safety:** default is `isPublic` clips only. Full-corpus export requires explicit selection and displays a count-and-domain-tally warning first. An accidentally published reading history is the worst outcome available in this product.

---

## 13. Backup

File System Access API. Handle persisted in `meta`, written as `shelf-backup.json`.

Handles lose permission across browser restarts: `queryPermission()` then `requestPermission()`, and only from a user gesture. **This is why auto-backup runs on shelf open**, not in the service worker — a worker cannot obtain a gesture.

Runs automatically when the shelf opens if the last backup is older than 12 hours. Manual "Back up now" and JSON download always available.

If `showDirectoryPicker` is unavailable (verify on Safari), degrade to manual JSON download and say so in the settings copy.

---

## 14. Privacy

- **Zero network requests.** Enforce with CSP `connect-src 'none'` on extension pages and a lint rule banning `fetch`/`XMLHttpRequest`. A testable invariant, not a promise.
- No remote code; everything bundled. Required by MV3 and App Store review.
- No telemetry, analytics, or crash reporting. Both listings declare no data collection.
- **No favicons** — fetching one is a network request. Letter avatars with a domain-derived hue instead.
- Escape all page-derived strings before inlining into export HTML.

---

## 15. Performance budgets

| Operation | Budget |
|---|---|
| Content script idle cost, no selection | < 3ms |
| Save bar appears after selection | < 60ms |
| Save write round-trip | < 80ms |
| Search, 5,000 clips | < 20ms |
| Shelf first render, 500 clips | < 200ms |
| Export, 500 clips | < 1s |

---

## 16. Testing

**Unit** — URL normalization (~30 fixture pairs), time formatting, export determinism, HTML escaping.

**Manual script:**
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

**Safari** — no automation available. Run the checklist manually before each submission.

---

## 17. Safari

```
xcrun safari-web-extension-converter shelf/ \
  --project-location ../shelf-safari --app-name Shelf --macos-only
```

Development requires Xcode plus Safari → Develop → **Allow Unsigned Extensions** (resets on every quit). The $99/year Apple Developer account is needed to ship, not to develop.

**Measure the storage ceiling early.** Insert 500 realistic clips, log `navigator.storage.estimate()`, find where writes fail. `unlimitedStorage` may not be honoured. At ~500 bytes per clip this is far less likely to bite than it would have with full article text, but verify rather than assume.

Verify `showDirectoryPicker` availability in the same pass.

---

## 18. Build order

Each step has an acceptance check. Do not advance on a failing check.

| # | Step | Check |
|---|---|---|
| 1 | Manifest, icons, empty worker | Loads unpacked with no errors |
| 2 | `db.js` | Add and read a record from the worker console |
| 3 | `util.js` | Fixture table of ~30 URL pairs passes |
| — | **Safari quota probe** | Ceiling measured before more is built on it |
| 4 | `background.js` | Context menu saves on a non-granted site |
| 5 | `content.js` | Bar appears, positions correctly at viewport edges, saves |
| 6 | `shelf.js` | 200 seeded clips render < 200ms; `/` focuses search |
| 7 | `export.js` | Zero network requests; identical input → identical bytes |
| 8 | Backup | Folder picked, file written, survives restart |
| 9 | Popup + onboarding | Backup warning unavoidable on first run |
| 10 | Safari conversion | Runs in Safari; manual checklist passes |

---

## 19. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Users don't grant permissions, bar never appears, reads as broken | High | Onboarding screen; context menu always works; popup one-click grant |
| Machine loss with no backup | High | Backup setup foregrounded in onboarding; escalating warning after 7 days |
| Safari storage ceiling lower than expected | Low | Measured before build; clips are small |
| Accidental full-corpus export | Low frequency, severe | Default-private flag, explicit warning with counts |
| Shadow-DOM bar breaks on hostile page CSS | Low | Closed shadow root, `all: initial` on host |
