/* Dev tool. Lives outside shelf/ and is never packaged. */
// Paste into the SERVICE WORKER console to seed clips for the step-6 perf check.
// Uses PLACEHOLDER_ text so every seeded record is greppable and obviously not real.
(async (n = 200) => {
  const DOMAINS = ['aeon.co','arxiv.org','github.com','wikipedia.org','nautil.us',
                   'longreads.com','lrb.co.uk','newyorker.com','worksinprogress.co',
                   'notes.andymatuschak.org','publicdomainreview.org','developer.mozilla.org'];
  const WORDS = ('a collection is not hoard it argument about what deserves persist data '
    + 'ownership and real time collaboration are mutually exclusive readers copied passages '
    + 'worth remembering into single volume kept for life margin only place book where reader '
    + 'allowed answer back note that says one thing can be linked from anywhere').split(' ');
  const pick = (a, i) => a[i % a.length];
  const sentence = (seed, len) =>
    Array.from({ length: len }, (_, i) => pick(WORDS, seed * 7 + i * 13)).join(' ');

  let ok = 0;
  for (let i = 0; i < n; i++) {
    const domain = pick(DOMAINS, i);
    // Spread across ~30 days so day grouping and the sticky columns get exercised.
    const savedAt = Date.now() - i * 3.6e6 * (1 + (i % 5));
    const isPage = i % 4 === 3;               // every 4th is a page-save, no passage (D3)
    const canonicalUrl = `https://${domain}/PLACEHOLDER_${i}`;
    await shelfDb.addClip({
      id: crypto.randomUUID(),
      text: isPage ? '' : 'PLACEHOLDER_ ' + sentence(i, 14 + (i % 22)),
      note: i % 3 === 0 ? 'PLACEHOLDER_note ' + sentence(i + 5, 7) : '',
      color: 'yellow',
      url: canonicalUrl,
      canonicalUrl,
      urlHash: (i.toString(16).padStart(8, '0') + 'ab').padEnd(32, '0'),
      normalizeVersion: 1,
      domain,
      title: 'PLACEHOLDER_ ' + sentence(i + 2, 6),
      context: { prefix: '', suffix: '' },
      seconds: null,
      savedAt,
      isPublic: false,
    });
    ok++;
  }
  console.log(`seeded ${ok}; total now ${await shelfDb.countClips()}`);
})(200);
