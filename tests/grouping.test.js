const assert = require('assert');
const grouping = require('../extension/grouping.js');

function tab(id, url, overrides = {}) {
  return {
    id,
    url,
    title: overrides.title || url,
    windowId: overrides.windowId || 1,
    index: overrides.index || id,
    active: !!overrides.active,
    groupId: overrides.groupId ?? grouping.TAB_GROUP_NONE,
  };
}

function labels(groups) {
  return groups.map(group => group.label);
}

{
  const groups = grouping.groupTabs([
    tab(1, 'https://github.com/'),
    tab(2, 'https://github.com/openai/codex'),
    tab(3, 'https://developer.mozilla.org/en-US/'),
  ], [], {});

  assert.deepStrictEqual(labels(groups), ['Homepages', 'Developer Mozilla', 'Github']);
  assert.strictEqual(groups[0].kind, 'homepages');
  assert.strictEqual(groups[1].kind, 'domain');
}

{
  const groups = grouping.groupTabs([
    tab(1, 'https://developer.mozilla.org/en-US/'),
  ], [], {});

  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].type, 'smart');
  assert.deepStrictEqual(grouping.filterRenderableGroups(groups), []);
}

{
  const groups = grouping.groupTabs([
    tab(1, 'https://developer.mozilla.org/en-US/'),
    tab(2, 'https://developer.mozilla.org/en-US/docs/Mozilla'),
  ], [], {});

  assert.strictEqual(grouping.filterRenderableGroups(groups).length, 1);
  assert.strictEqual(grouping.filterRenderableGroups(groups)[0].label, 'Developer Mozilla');
}

{
  const groups = grouping.groupTabs([
    tab(1, 'http://localhost:5173/', { title: 'Vite app' }),
    tab(2, 'http://127.0.0.1:8000/health'),
    tab(3, 'file:///Users/me/report.html'),
  ], [], {});

  assert.deepStrictEqual(labels(groups), ['Local/dev', 'Local files']);
  assert.strictEqual(groups[0].tabs.length, 2);
  assert.deepStrictEqual(groups[0].sites, ['127.0.0.1', 'localhost']);
}

{
  const groups = grouping.groupTabs([
    tab(1, 'https://example.com/a', { groupId: 10 }),
    tab(2, 'https://example.org/b', { groupId: 10 }),
    tab(3, 'https://news.ycombinator.com/'),
  ], [
    { id: 10, windowId: 1, title: 'Research', color: 'blue', collapsed: false },
  ], {});

  assert.strictEqual(groups[0].type, 'firefox');
  assert.strictEqual(groups[0].label, 'Research');
  assert.deepStrictEqual(groups[0].sites, ['example.com', 'example.org']);
  assert.strictEqual(groups[1].label, 'News Ycombinator');
}

{
  const groups = grouping.groupTabs([
    tab(1, 'https://example.com/a', { groupId: 10 }),
  ], [
    { id: 10, windowId: 1, title: 'Solo group', color: 'blue', collapsed: false },
  ], {});

  const renderable = grouping.filterRenderableGroups(groups);
  assert.strictEqual(renderable.length, 1);
  assert.strictEqual(renderable[0].type, 'firefox');
  assert.strictEqual(renderable[0].label, 'Solo group');
}

{
  const groups = grouping.groupTabs([
    tab(1, 'https://docs.example.com/a'),
    tab(2, 'https://docs.example.com/b'),
    tab(3, 'https://app.example.com/'),
  ], [], {
    customGroups: [
      {
        hostnameEndsWith: '.example.com',
        pathPrefix: '/a',
        groupKey: 'example-docs-a',
        groupLabel: 'Example docs A',
      },
    ],
  });

  assert.strictEqual(groups[0].label, 'Example docs A');
  assert.strictEqual(groups[0].type, 'smart');
  assert.ok(labels(groups).includes('Docs Example'));
  assert.ok(labels(groups).includes('App Example'));
}

{
  const [group] = grouping.groupTabs([
    tab(1, 'https://example.com/a#top', { active: true }),
    tab(2, 'https://example.com/a/'),
    tab(3, 'https://example.com/b'),
    tab(4, 'https://example.com/a?query=1'),
  ], [], {});

  assert.strictEqual(group.duplicates.duplicateExtras, 1);
  assert.deepStrictEqual(group.duplicates.duplicateUrls, ['https://example.com/a']);
}

console.log('grouping tests ok');
