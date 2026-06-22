const assert = require('assert');
const data = require('../extension/tabout-data.js');

{
  const payload = data.buildExportPayload({
    deferred: [{ id: 'saved-1' }],
    tabOutSavedGroups: [{ id: 'group-1' }],
    tabOutGroupAliases: { 'smart:homepages': 'Start' },
    tabOutUiState: { view: 'firefox-bookmarks' },
    tabOutBookmarkFolderId: 'browser-folder-id',
    __tabOutDevLogs: [{ event: 'debug' }],
    randomBrowserBookmarks: [{ url: 'https://example.com' }],
  }, '2026-06-21T12:00:00.000Z');

  assert.strictEqual(payload.schema_version, data.EXPORT_SCHEMA_VERSION);
  assert.deepStrictEqual(Object.keys(payload.data).sort(), data.EXPORT_KEYS.slice().sort());
  assert.strictEqual(payload.data.tabOutBookmarkFolderId, undefined);
  assert.strictEqual(payload.data.__tabOutDevLogs, undefined);
  assert.deepStrictEqual(payload.data.deferred, [{ id: 'saved-1' }]);
}

{
  const imported = data.sanitizeImportPayload({
    schema_version: data.EXPORT_SCHEMA_VERSION,
    data: {
      deferred: [{ id: 'saved-1' }],
      tabOutSavedGroups: 'bad',
      tabOutGroupAliases: null,
      tabOutUiState: { view: 'groups' },
      bookmarks: [{ url: 'https://example.com' }],
    },
  });

  assert.deepStrictEqual(imported.deferred, [{ id: 'saved-1' }]);
  assert.deepStrictEqual(imported.tabOutSavedGroups, []);
  assert.deepStrictEqual(imported.tabOutGroupAliases, {});
  assert.deepStrictEqual(imported.tabOutUiState, { view: 'groups' });
  assert.strictEqual(imported.bookmarks, undefined);
}

{
  const duplicates = data.filterDuplicateUrlItems([
    { url: 'https://example.com/a#top', title: 'A' },
    { url: 'https://example.com/a', title: 'A again' },
    { url: 'https://example.com/b', title: 'B' },
    { url: 'about:config', title: 'Internal' },
    { url: 'about:config', title: 'Internal again' },
  ]);

  assert.deepStrictEqual(duplicates.map(item => item.title), [
    'A',
    'A again',
    'Internal',
    'Internal again',
  ]);
}

{
  const result = data.createSavedItemsFromBookmarks([
    { url: 'https://example.com/a', title: 'A' },
    { url: 'https://example.com/a#section', title: 'A duplicate' },
    { url: 'https://example.com/b', title: 'B' },
    { url: 'about:config', title: 'Internal' },
  ], [
    { id: 'old-1', url: 'https://example.com/existing', completed: false, dismissed: false },
    { id: 'old-2', url: 'https://example.com/b', completed: false, dismissed: false },
  ], '2026-06-22T10:00:00.000Z');

  assert.strictEqual(result.next.length, 3);
  assert.deepStrictEqual(result.added.map(item => item.url), ['https://example.com/a']);
  assert.strictEqual(result.added[0].source, 'firefox-bookmark');
  assert.strictEqual(result.added[0].completed, false);
  assert.strictEqual(result.added[0].dismissed, false);
}

console.log('tabout data tests ok');
