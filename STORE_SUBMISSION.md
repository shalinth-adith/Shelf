# Chrome Web Store submission

Everything needed to publish Shelf, plus the copy to paste into each field.

**Package:** `./tools/pack.sh` → `dist/shelf-<version>.zip` (156 KB)

---

## 0. Before you start

| Requirement | Status |
|---|---|
| Google account with **2-Step Verification on** | Required. The dashboard refuses without it |
| Developer registration fee | **US$5, one time, non-refundable.** Covers the account, not per extension |
| A **publicly reachable** privacy policy URL | Required. Draft is in §5 — the repo is private, so it needs hosting |
| 1–5 screenshots at **1280×800** or 640×400 | Required. See §4 |

Dashboard: https://chrome.google.com/webstore/devconsole

---

## 1. Build and upload

```bash
npm test          # 92 tests must pass
./tools/pack.sh   # -> dist/shelf-1.0.0.zip
```

Then **New item → upload the zip**. It must contain `manifest.json` at the archive root,
which `pack.sh` guarantees by zipping the *contents* of `shelf/` rather than the folder.

**Version can never go backwards or repeat.** Bump `manifest.json` before every upload,
including resubmissions after a rejection.

---

## 2. Store listing

**Name** — `Shelf`
*(Trademark check is still open — PRD §14 Q1. Do it before submitting; a rename after
launch loses the listing URL and every review.)*

**Summary** (132 char limit)

```
Save the passage, not the tab. A local-first clipper — no account, no server, no network requests at all.
```

**Category** — Productivity → Workflow & Planning
**Language** — English

**Detailed description**

```
You read something good, the specific paragraph that mattered lands, and six months
later you cannot find it again.

Bookmarks don't help — they save the page, not the passage. Copying into a notes app
loses the source and the date. And the tools built to fix this asked for your reading
history in exchange.

Shelf is a clipping log. Select text on any page, save it in one click, and the passage
is kept with its source and the moment you took it. Open your shelf to see everything,
grouped by day and searchable.

Everything stays on your machine.

• No account. Nothing to sign up for.
• No server. Your clips are never uploaded, because there is nowhere to upload them to.
• No network requests — at all. Not for fonts, not for icons, not for analytics.
  The typefaces ship inside the extension. Site icons are drawn, not fetched.
• No AI features, because they would mean sending your reading somewhere.

What you can do

• Select text on any page and save it in one click
• Right-click → Save selection to Shelf — works on every site, with no permission
• See everything you have saved in one list, newest first, grouped by day
• Search across every passage, note, title and site
• Attach a note explaining why a passage mattered
• Colour-code clips to tell kinds of passage apart
• Copy any clip as Markdown, citation included
• Back up to a folder you choose — point it at Dropbox or iCloud and you get sync
• Publish a chosen subset as one self-contained HTML file you can email or host

Your data outlives this extension

Backups are written as two files: plain JSON that restores your library exactly, and a
readable HTML page that opens in any browser with or without Shelf. If this extension
disappears tomorrow, nothing you saved is lost. That is the point.

Site access

Right-click saving works everywhere with no permission. The floating save bar needs
permission per site, granted one site at a time from the toolbar button. Shelf never asks
for access to all your sites, and never asks at install.
```

---

## 3. Privacy tab — the part that gets extensions rejected

**Single purpose** (one sentence, must match what the code does)

```
Save selected passages of text from web pages into local browser storage, and browse,
search and export them later.
```

**Permission justifications.** Each is required, and vague answers are the most common
cause of rejection. These are specific on purpose.

| Permission | Justification to paste |
|---|---|
| `storage` | Stores two small preferences: the light/dark theme choice and the default clip colour. No passage text is stored here. |
| `unlimitedStorage` | Clips live in IndexedDB. Without this, Chrome can evict the database under storage pressure — and because Shelf has no server, eviction means the user's entire saved library is permanently lost. |
| `activeTab` | When the user clicks the toolbar button or presses the save shortcut, Shelf reads the current page's title and meta description in order to save it. Access is granted by that click and lasts only for that action. |
| `scripting` | Registers the text-selection save bar on sites the user has explicitly allowed, and reads the page's meta description when saving a whole page. No script is injected into any site the user has not granted. |
| `contextMenus` | Adds "Save selection to Shelf" to the right-click menu. This is the only save path that works without any host permission, so it is what the extension falls back to everywhere else. |
| `host_permissions` (optional) | Requested per site, only when the user clicks "Allow Shelf on <site>" in the popup. Never requested at install, and never for all sites at once. Used solely to display the save bar when text is selected on that site. |

**Remote code** — select **"No, I am not using remote code."**
Everything executes from files in the package. There are no CDN scripts, no `eval`, and
extension pages are pinned to `connect-src 'none'`.

**Data usage** — tick **nothing**, and declare all three certifications:

- Does **not** collect or use personally identifiable information
- Does **not** collect health, financial, authentication, personal communications,
  location, web history, or user activity
- Complies with the Developer Program Policies
- Does **not** sell or transfer user data to third parties
- Does **not** use or transfer data for purposes unrelated to the single purpose
- Does **not** use or transfer data to determine creditworthiness or for lending

All of the above are true because the extension makes no network requests. That claim is
testable: open an export from `file://` and the Network panel shows one entry, the
document itself.

---

## 4. Screenshots — 1280×800

Five, in this order. Take them on a shelf with 15–20 real clips across several sites,
in **light** theme, at a browser window sized to 1280×800.

1. **The shelf** — day-grouped timeline, a passage leading a row, notes visible
2. **The save bar** — mid-selection on an article, pill visible below the text
3. **The popup** — on an allowed site, showing title, note field, Save page
4. **Search** — a query typed, matches highlighted in terracotta
5. **The export dialog** — switched to "Everything", warning and site tally visible

Number 5 is worth including precisely because it advertises the restraint: it shows the
extension warning you before you publish anything.

Do not screenshot the seeded `PLACEHOLDER_` clips.

---

## 5. Privacy policy — needs a public URL

The repo is private, so this text has to be hosted somewhere reachable. Cheapest options:
a public GitHub Gist, a one-page public repo with GitHub Pages, or any static host.

```
Privacy Policy — Shelf

Last updated: 2026-08-21

Shelf does not collect any data.

Shelf makes no network requests of any kind. It has no server, no account system, no
analytics, no telemetry, and no crash reporting. It does not load fonts, icons, scripts
or any other resource from a remote location — everything it needs is contained in the
extension package.

What Shelf stores, and where

Passages you save, along with their source URL, page title, the time you saved them, and
any note or colour you add, are stored in your browser's local IndexedDB storage on your
own computer. Two small preferences — your theme choice and default clip colour — are
stored in your browser's extension storage. None of this is transmitted anywhere.

Files you create

If you set up a backup folder, Shelf writes two files into the folder you chose, on your
own machine. If you export, Shelf creates a file in your downloads folder. Shelf never
uploads these or any other file. What happens to them afterwards is entirely up to you.

Site access

Shelf requests access to a website only when you explicitly grant it, one site at a time.
It never requests access to all sites, and never requests any site access at install.
Granted access is used only to display the save bar when you select text.

Deleting your data

Removing the extension deletes everything Shelf has stored in your browser. Files you
exported or backed up to your own folders are yours and are not touched.

Contact: <your email>
```

---

## 6. Review

Extensions requesting broad host permissions at install go into a slower review tier.
Shelf deliberately requests none — `optional_host_permissions` only (TRD §9) — which is
one of the reasons that decision was made.

Expect a few days. Rejections arrive by email with a policy code; fix, bump the version,
and resubmit.

**Before submitting, run the TRD §16 checklist** in BUILD_PLAN.md. Ten of twelve are
verified; item 5 (search highlighting) and item 7 (undo shortcut) are outstanding.

---

## 7. After publishing

- The listing URL contains the extension ID, which is assigned at first publish and never
  changes. Keep it.
- Publishing can be limited to **unlisted** or a **trusted-tester** group first. PRD §13's
  Phase 1 is 10–20 friends, and unlisted is exactly that.
- Set up the store's email alerts, since PRD §10 rules out telemetry — reviews and the
  uninstall rate in the dashboard are the only signal that exists.
