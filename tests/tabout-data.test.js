const assert = require('assert');
const data = require('../extension/tabout-data.js');

{
  const payload = data.buildExportPayload({
    deferred: [{ id: 'saved-1' }],
    tabOutSavedGroups: [{ id: 'group-1' }],
    tabOutGroupAliases: { 'smart:homepages': 'Start' },
    tabOutUiState: { view: 'favorites' },
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

console.log('tabout data tests ok');
