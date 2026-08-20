/**
 * Manifest invariants. These are the constraints that are expensive to notice late:
 * a missing permission fails at runtime on a user's machine, and a stray host permission
 * or network call is a privacy regression that no unit test would otherwise catch.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const EXT = 'shelf';
const manifest = JSON.parse(readFileSync(join(EXT, 'manifest.json'), 'utf8'));

/** Every .js file we ship. */
function sourceFiles(dir = join(EXT, 'src')) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? sourceFiles(p) : extname(p) === '.js' ? [p] : [];
  });
}

/** Source with comments removed, so a chrome.* mentioned in prose isn't counted. */
function code(path) {
  return readFileSync(path, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/**
 * chrome.* namespaces available to every extension with no manifest entry.
 * `permissions` is here because requesting optional permissions cannot itself require
 * a permission — that would be circular.
 */
const NO_DECLARATION_NEEDED = new Set([
  'runtime', 'action', 'permissions', 'i18n', 'extension', 'test',
]);

/**
 * APIs we reach through HOST permissions rather than a named permission, with the
 * reason each is deliberate. Adding one of these to manifest.permissions would be the
 * easy fix and the wrong one — read the reason before touching this.
 */
const HOST_PERMISSION_GATED = {
  tabs:
    'chrome.tabs.query({url}) filters by URL using host permissions for those origins, ' +
    'and we only ever query the origins the user has already granted. Declaring the ' +
    '"tabs" permission instead would put "Read your browsing history" on the install ' +
    'screen of a product whose entire pitch is that it reads nothing.',
};

test('manifest declares every chrome API the source actually calls', () => {
  const declared = new Set(manifest.permissions ?? []);
  const missing = new Set();

  for (const file of sourceFiles()) {
    for (const [, ns] of code(file).matchAll(/\bchrome\.([a-zA-Z]+)\b/g)) {
      if (declared.has(ns)) continue;
      if (NO_DECLARATION_NEEDED.has(ns)) continue;
      if (ns in HOST_PERMISSION_GATED) continue;
      missing.add(`${ns} (${file})`);
    }
  }
  assert.deepEqual([...missing], [], 'undeclared chrome APIs');
});

test('never requests broad host access at install — TRD §9', () => {
  // The single most consequential line in the manifest. Broad host access at install
  // pushes Chrome Web Store review into the slow tier, and Safari forces per-site
  // granting regardless, so it buys nothing and costs weeks.
  assert.equal(manifest.host_permissions, undefined, 'host_permissions must not exist');
  assert.deepEqual(manifest.optional_host_permissions, ['http://*/*', 'https://*/*']);
});

test('extension pages cannot open a network connection — TRD §14', () => {
  const csp = manifest.content_security_policy?.extension_pages ?? '';
  assert.match(csp, /connect-src 'none'/, 'CSP must pin connect-src to none');
  assert.match(csp, /script-src 'self'/, 'no remote code — required by MV3 anyway');
});

test('no source file contains a network primitive', () => {
  const banned = /\bfetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|importScripts/;
  for (const file of sourceFiles()) {
    assert.doesNotMatch(code(file), banned, `network primitive in ${file}`);
  }
});

test('no source file references a remote origin', () => {
  // Catches remote fonts, CDN scripts, favicon fetching, and analytics endpoints.
  for (const file of sourceFiles()) {
    const hits = [...code(file).matchAll(/https?:\/\/[^\s'"`)]+/g)].map((m) => m[0]);
    assert.deepEqual(hits, [], `remote origin in ${file}`);
  }
});

test('every path the manifest names exists on disk', () => {
  const paths = new Set([
    ...Object.values(manifest.icons ?? {}),
    ...Object.values(manifest.action?.default_icon ?? {}),
    manifest.background?.service_worker,
    manifest.action?.default_popup,
    manifest.options_page,
  ].filter(Boolean));

  for (const p of paths) {
    assert.doesNotThrow(() => statSync(join(EXT, p)), `manifest names a missing file: ${p}`);
  }
});

test('content.js, if present, is never registered as a module', () => {
  // Content scripts cannot be ES modules. If this ever regresses it fails silently on
  // the page rather than loudly at load.
  const declared = manifest.content_scripts ?? [];
  for (const entry of declared) {
    assert.notEqual(entry.type, 'module', 'content scripts must be classic');
  }
});

test('host-permission-gated APIs stay out of manifest.permissions', () => {
  // The failure this guards against is someone hitting the undeclared-API test above and
  // "fixing" it by declaring the permission — which would silently add an install-time
  // warning that contradicts the product.
  const declared = new Set(manifest.permissions ?? []);
  for (const [api, reason] of Object.entries(HOST_PERMISSION_GATED)) {
    assert.ok(!declared.has(api), `"${api}" must not be declared. ${reason}`);
  }
});
