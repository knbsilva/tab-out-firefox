const assert = require('assert');
const savedGroups = require('../extension/saved-groups.js');

function tab(id, url, overrides = {}) {
  return {
    id,
    url,
    title: overrides.title || url,
    windowId: overrides.windowId || 1,
    index: overrides.index ?? id,
    active: !!overrides.active,
    pinned: !!overrides.pinned,
  };
}

{
  const snapshot = savedGroups.createGroupSnapshot({
    id: 'firefox:1:7',
    type: 'firefox',
    label: 'Research',
    color: 'blue',
    collapsed: true,
    windowId: 1,
    firefoxGroupId: 7,
    tabs: [
      tab(3, 'https://example.com/c', { index: 3 }),
      tab(1, 'https://example.com/a', { index: 1, active: true, pinned: true }),
      tab(2, 'https://developer.mozilla.org/docs', { index: 2 }),
    ],
  }, {
    id: 'snapshot-1',
    now: '2026-06-21T12:00:00.000Z',
  });

  assert.strictEqual(snapshot.id, 'snapshot-1');
  assert.strictEqual(snapshot.source, 'firefox');
  assert.strictEqual(snapshot.title, 'Research');
  assert.strictEqual(snapshot.color, 'blue');
  assert.strictEqual(snapshot.collapsed, true);
  assert.strictEqual(snapshot.firefoxGroupId, 7);
  assert.deepStrictEqual(snapshot.tabs.map(item => item.url), [
    'https://example.com/a',
    'https://developer.mozilla.org/docs',
    'https://example.com/c',
  ]);
  assert.strictEqual(snapshot.tabs[0].active, true);
  assert.strictEqual(snapshot.tabs[0].pinned, true);
  assert.deepStrictEqual(snapshot.sites, ['developer.mozilla.org', 'example.com']);
}

{
  const snapshot = savedGroups.createGroupSnapshot({
    id: 'smart:domain:example.com',
    type: 'smart',
    label: 'Example',
    tabs: [
      tab(1, 'about:config'),
      tab(2, 'moz-extension://abc/index.html'),
      tab(3, 'file:///C:/tmp/report.html'),
      tab(4, 'https://example.com/valid'),
    ],
  }, {
    id: 'snapshot-2',
    now: '2026-06-21T12:00:00.000Z',
  });

  assert.deepStrictEqual(snapshot.tabs.map(item => item.url), [
    'file:///C:/tmp/report.html',
    'https://example.com/valid',
  ]);
}

{
  const groups = savedGroups.applyGroupAliases([
    { id: 'smart:homepages', label: 'Homepages', type: 'smart' },
    { id: 'firefox:1:9', label: 'Work', type: 'firefox' },
  ], {
    'smart:homepages': 'Daily starts',
  });

  assert.strictEqual(groups[0].label, 'Daily starts');
  assert.strictEqual(groups[0].originalLabel, 'Homepages');
  assert.strictEqual(groups[1].label, 'Work');
}

{
  const result = savedGroups.clearCompletedDeferred([
    { id: '1', completed: false },
    { id: '2', completed: true },
    { id: '3', completed: true, dismissed: true },
  ]);

  assert.strictEqual(result.removed, 2);
  assert.deepStrictEqual(result.next.map(item => item.id), ['1']);
}

{
  const bookmarks = savedGroups.flattenBookmarkTree([
    {
      id: 'root',
      title: '',
      children: [
        {
          id: 'menu',
          title: 'Bookmarks Menu',
          children: [
            {
              id: 'folder',
              title: 'Docs',
              children: [
                {
                  id: 'bookmark-1',
                  parentId: 'folder',
                  title: 'MDN tabs',
                  url: 'https://developer.mozilla.org/docs/Mozilla/Add-ons/WebExtensions/API/tabs',
                  dateAdded: 10,
                },
              ],
            },
          ],
        },
        {
          id: 'toolbar',
          title: 'Bookmarks Toolbar',
          children: [
            {
              id: 'bookmark-2',
              parentId: 'toolbar',
              title: 'GitHub',
              url: 'https://github.com/',
              dateAdded: 20,
            },
          ],
        },
      ],
    },
  ]);

  assert.deepStrictEqual(bookmarks.map(item => item.title), ['GitHub', 'MDN tabs']);
  assert.strictEqual(bookmarks[1].folderPath, 'Bookmarks Menu / Docs');
  assert.deepStrictEqual(savedGroups.filterBookmarks(bookmarks, 'docs').map(item => item.title), ['MDN tabs']);
}

console.log('saved groups tests ok');
