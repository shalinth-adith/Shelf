# Shelf

**Keep every passage worth keeping — on your own machine.**

A local-first text clipper for Chrome (MV3) and Safari 17+. Select text on any page, click
Save, and the passage is stored in IndexedDB with its source and a timestamp. Open the
shelf to see everything grouped by day, searchable.

No account. No server. **No network requests of any kind.**

## Status

Pre-alpha. Building against the order in [TRD §18](TRD.md#18-build-order); progress in
[BUILD_PLAN.md](BUILD_PLAN.md).

## Hard constraints

These are load-bearing, not preferences:

- **No build step.** Vanilla ES modules, no bundler, no framework, no runtime npm
  dependencies. The source tree *is* the extension — `shelf/` loads unpacked directly.
- **`@types/chrome` is the only dependency**, dev-only, for editor support.
- **Zero network requests anywhere.** No `fetch`, no `XMLHttpRequest`, no remote fonts, no
  favicon fetching. Enforced by CSP `connect-src 'none'` on extension pages.
- **`content.js` is a classic script**, never an ES module.
- **Never request broad host permissions at install.** Optional, per-site only.

## Layout

```
shelf/          <- the extension; Load unpacked points HERE
PRD.md          product requirements
TRD.md          technical requirements
BUILD_PLAN.md   build order and acceptance checks
```

## Running it

Chrome: `chrome://extensions` → enable **Developer mode** → **Load unpacked** → select
`shelf/`.

Safari: `xcrun safari-web-extension-converter shelf/ --project-location ../shelf-safari
--app-name Shelf --macos-only`, then Safari → Develop → **Allow Unsigned Extensions**
(resets every quit).

## Your data

Everything lives in this browser profile's IndexedDB. Nothing is uploaded, ever. Lose the
machine without a backup and the clips go with it — which is why the backup folder is set
up during onboarding.
