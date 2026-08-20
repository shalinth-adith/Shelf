# Product Requirements Document

**Product:** Shelf
**One-liner:** Keep every passage worth keeping — on your own machine.
**Platforms:** Chrome, Safari (macOS)
**Status:** v0.2 — scoped for build
**Supersedes:** v0.1. The product is a clipping log, not an annotation layer. See §5.
**Companion:** TRD v0.2

---

## 1. The problem

You read something good, the specific paragraph that mattered lands, and six months later you cannot find it again.

Bookmarks don't help — they save the page, not the passage, and the page is where the sentence goes to hide. Copying into a notes app loses the source and the date. And the tools built to fix this asked for your reading history in exchange.

That trade turned out badly. Mozilla shut Pocket down on 8 July 2025 and deleted all remaining user data on 8 October 2025. Users had three months to export or lose eighteen years of saves. Anyone who missed the window lost everything.

**The job:** capture the sentence, keep the source and the moment, make it findable forever, and never put it anywhere you don't control.

---

## 2. Why now

1. **The category lost its default.** Pocket's shutdown displaced a large, motivated user base who now distrust hosted services specifically. "It's on your machine" reads differently in 2026 than it did in 2020.
2. **Local-first is practical in an extension.** IndexedDB with persistent storage, the File System Access API, and client-side search are all mature enough that the cloud isn't load-bearing here.
3. **Clips are tiny.** ~500 bytes each. A decade of heavy use is a few megabytes. There is no technical reason this needs a server.

---

## 3. Target users

**Primary — the rabbit-hole reader.** Reads 10–40 substantial things a week: essays, papers, docs, long threads. Wants the specific paragraph back later, not the tab. Currently splitting this across bookmarks, Notes.app, and a Notion page they stopped updating.

**Secondary — the privacy-conscious refugee.** Left or lost a hosted tool. Actively prefers no account. Runs their own sync via Dropbox or Syncthing and considers that a feature. Small, vocal, and the source of early word-of-mouth.

**Not the target (v1):** teams needing shared annotation, students annotating PDFs, mobile-first readers.

---

## 4. Positioning

| Alternative | Does well | Gap |
|---|---|---|
| Browser bookmarks | Free, native, zero friction | Saves pages, not passages. No notes, no search |
| Curius | Elegant highlighting, fun social layer | Account required; reading history on their server |
| Raindrop / Instapaper | Mature, polished, cross-device | Hosted — you're renting your own archive |
| Readwise | Best-in-class recall | Expensive; heavyweight if you just want to find things |
| Notes app + copy-paste | Already installed | Loses source, date, and structure |

**Our position:** the ownership of self-hosting without running anything, and the passage rather than the page.

**The honest trade:** no cross-device sync out of the box, no social discovery, and reading on a phone isn't served.

---

## 5. What this is, precisely

**A clipping log.** Select text → save → it appears in a chronological list with its source and the moment you took it.

**Not an annotation layer.** v1 does not repaint highlights on the page when you return. The value is the collection; you read your clips in the shelf, not in situ. This removed the single largest and riskiest component of the project.

The capture still records the surrounding text (TRD §6), so on-page highlighting stays possible later — and would apply retroactively to every clip ever saved. It costs ~100 bytes and no engineering time. It is a deliberately cheap option, not a commitment.

---

## 6. Principles

1. **Your data outlives the product.** Plain JSON and readable HTML, exportable at all times. If this is abandoned tomorrow, nothing is lost. Design as if it will be.
2. **Saving costs nothing.** One click. No dialog, no required tagging. Organisation is optional and retroactive.
3. **Nothing leaves the machine without an explicit act.** No background sync, no telemetry, no "anonymous usage data." Sharing is a deliberate export, never a default state.
4. **Never guess at content.** If the extension can't identify what to save, it saves nothing rather than scraping page furniture. Empty reads as intentional; nav labels read as broken.
5. **Don't hijack the browser.** No new tab takeover, no UI injected on pages you didn't ask about.

---

## 7. User stories

### P0 — cannot ship without

| # | Story |
|---|---|
| U1 | Select text on any page and save it in one click |
| U2 | See everything I've saved in one list, newest first, grouped by day |
| U3 | See **when** each passage was saved |
| U4 | Search across all my clips and find the right passage |
| U5 | Get back to the page a clip came from |
| U6 | Export everything as a file so I'm never locked in |
| U7 | Be told plainly that this is local-only and what happens if I lose the machine |

### P1 — should have

| # | Story |
|---|---|
| U8 | Attach a note to a clip explaining why it mattered |
| U9 | Colour-code clips to distinguish kinds of passage |
| U10 | Point the extension at a folder and have it back itself up |
| U11 | Publish a chosen subset as a single HTML file to share |
| U12 | Save and open the shelf by keyboard, without the mouse |
| U13 | Copy a clip with its citation as Markdown |

### P2 — later

| # | Story |
|---|---|
| U14 | Import a Pocket or other export file |
| U15 | Have a random old clip resurfaced to me |
| U16 | See clips highlighted on the page when I return |
| U17 | Sync between machines |

---

## 8. Core flows

### 8.1 Save

Select text → a small bar appears at the selection → click **Save**. Done. Optionally click a colour instead of Save to set it in one action.

**Requirement:** the clip is written before any confirmation renders. Nothing is lost if the user immediately navigates away.

**Requirement:** the bar never appears on selections inside inputs, textareas, or editable regions.

**Requirement:** right-click → "Save selection to Shelf" works on every site, including ones never granted access. This is the path that always works.

### 8.2 Review

The shelf, opened from the toolbar icon or keyboard shortcut. Reverse-chronological, grouped by day, with a continuous timeline down the left and each clip pinned at its own time.

**Requirement:** relative time under 24 hours ("2h"), clock time for today, absolute date beyond that, full timestamp on hover. "When did I read this" must always be answerable.

**Requirement:** the passage itself is the largest element on the row. The source is secondary. This is a list of sentences, not a list of links.

### 8.3 Retrieve

A single search field, filtering as you type across passage text, notes, titles and domains. Matching terms are marked in the results.

**Requirement:** results show the matching passage, not just the link. Finding the sentence is the whole job.

### 8.4 Share

Mark clips to share individually, then export. Produces one self-contained HTML file — email it, put it on GitHub Pages, open it from disk.

**Requirement:** the export dialog states the exact clip count and site tally before confirming. Full-corpus export is never the default and requires an explicit selection.

**Rationale:** an accidentally published reading history is the worst thing this product could do to someone. The confirmation is a safety mechanism, not a formality.

---

## 9. First run

Four screens maximum. Its job is expectation-setting — the two things most likely to cause angry churn are both expectation failures.

1. **What this is.** One sentence, one illustration of a saved passage.
2. **Where your data lives.** Plainly: this machine, nowhere else, no account. **And:** lose the machine without a backup and the clips go with it. Set up the backup folder here — pointing it at a Dropbox or iCloud folder also gets sync for free. This is the most important screen.
3. **Site access.** Right-click saving works everywhere. The floating bar needs permission per site. Offer a one-click grant.
4. **Done.** Show the keyboard shortcuts. Save the onboarding page itself as the first clip so the shelf isn't empty.

**Requirement:** screen 2 is not skippable without either configuring a backup or explicitly dismissing a "you have no backup" warning.

---

## 10. Measuring success — and the constraint

**There is no telemetry, by principle.** DAU, retention and feature usage will never be known. This is a real cost of the central promise and is accepted deliberately rather than quietly worked around.

| Signal | Source | v1 target |
|---|---|---|
| Installs | Store dashboards | 1,000 across both stores in 90 days |
| Retention proxy | CWS uninstall rate | < 40% at 30 days |
| Rating | Store reviews | ≥ 4.3 with 25+ reviews |
| Failure signal | Reviews and issues mentioning lost clips | Zero unresolved reports of data loss |
| Dogfooding | Our own daily use | Both of us using it as the only tool by step 6 |

**Explicitly rejected:** opt-in analytics, "help us improve" prompts, any phone-home. The absence is the product.

---

## 11. Out of scope for v1

| Item | Why |
|---|---|
| On-page highlight repainting | Largest risk in the project; cut. Context is captured so it stays possible later |
| Cross-device sync | Contradicts the promise. Backup folder inside a synced directory covers most of the need |
| Tags | Search plus colours covers v1. Revisit if the list gets unwieldy |
| Social features | Requires a server and an identity system |
| New tab feed | Can't be cleanly disabled once enabled; broken on Safari; violates principle 5 |
| PDF clipping | Different capture model |
| Mobile | Needs the iOS target and a rethought selection UX |
| AI summarisation or auto-tagging | Would require sending content to a server, contradicting principle 3 |

The AI exclusion belongs in the store listing. For this audience it is a feature.

---

## 12. Product risks

| Risk | Impact | Mitigation |
|---|---|---|
| Permissions not granted, bar never appears, product looks broken | High — reads as a bug, generates bad reviews | Onboarding screen 3; context menu always works; one-click grant in popup |
| Machine lost, clips gone, we get blamed | High — and genuinely bad for them | Backup setup foregrounded at first run; escalating warning after 7 days |
| No sync is a dealbreaker for more people than expected | Medium — caps the market | Ship the backup-folder-in-Dropbox pattern as first-class advice, not a workaround |
| "No account, no cloud" reads as unfinished rather than principled | Medium | Listing leads with the promise, not the limitation |
| Accidental over-share via export | Low frequency, severe | Default-private flag, explicit count confirmation |

---

## 13. Release plan

**Phase 0 — Private.** Dogfood from step 6 onward. Bar to exit: neither of us has lost a clip in three weeks of daily use.

**Phase 1 — Friends.** 10–20 people, unpacked on Chrome. Goal is finding sites where the save bar misbehaves.

**Phase 2 — Chrome Web Store.** Public listing. Cheap and fast to iterate.

**Phase 3 — Safari App Store.** Deliberately behind Chrome; review is slower. Pipeline de-risked early, launch trails.

**Launch narrative:** lead with Pocket. "The service you trusted with eight years of reading deleted it on a Wednesday" opens better than any feature list, and it's true.

---

## 14. Open questions

1. **Name.** "Shelf" is a placeholder — needs a trademark check.
2. **Free or paid?** Zero marginal cost per user makes free sustainable. A one-time price would fund the Safari $99/year. Leaning free for v1 to maximise distribution; revisit before Safari launch.
3. **Colours: fixed five or user-defined?** Fixed assumed.
4. **Does the shelf need pagination?** Assumed no below ~2,000 clips. Measure at step 6.
5. **Should saving a page with no selection exist at all**, or is selection-only cleaner? The excerpt ladder exists to make it safe, but the simpler product might just refuse.
