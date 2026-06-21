(function initSavedGroups(root, factory) {
  const api = factory(root.TabOutGrouping || {});
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.TabOutSavedGroups = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function savedGroupsFactory(grouping) {
  'use strict';

  function isRestorableUrl(url) {
    if (!url) return false;
    try {
      return ['http:', 'https:', 'file:'].includes(new URL(url).protocol);
    } catch {
      return false;
    }
  }

  function normalizeText(value, fallback) {
    const text = String(value || '').trim();
    return text || fallback;
  }

  function siteFromUrl(url) {
    if (grouping && typeof grouping.siteFromUrl === 'function') {
      return grouping.siteFromUrl(url);
    }

    try {
      const parsed = new URL(url);
      if (parsed.protocol === 'file:') return 'local-files';
      return parsed.hostname.replace(/^www\./, '') || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  function compareTabs(a, b) {
    return (
      ((a.windowId || 0) - (b.windowId || 0)) ||
      ((a.index || 0) - (b.index || 0)) ||
      ((a.id || 0) - (b.id || 0))
    );
  }

  function safeIdSegment(value) {
    return normalizeText(value, 'group')
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'group';
  }

  function makeSnapshotId(group, now) {
    const stamp = String(now || new Date().toISOString()).replace(/[^0-9a-z]/gi, '');
    return `saved-group:${safeIdSegment(group && (group.id || group.label))}:${stamp}`;
  }

  function uniqueSorted(values) {
    return Array.from(new Set(values.filter(Boolean))).sort((a, b) => a.localeCompare(b));
  }

  function createGroupSnapshot(group, options = {}) {
    if (!group || !Array.isArray(group.tabs)) return null;

    const now = options.now || new Date().toISOString();
    const tabs = group.tabs
      .filter(tab => isRestorableUrl(tab && tab.url))
      .slice()
      .sort(compareTabs)
      .map((tab, index) => ({
        url: tab.url,
        title: normalizeText(tab.title, tab.url),
        pinned: !!tab.pinned,
        active: !!tab.active,
        index: typeof tab.index === 'number' ? tab.index : index,
        site: siteFromUrl(tab.url),
      }));

    if (tabs.length === 0) return null;

    const snapshot = {
      id: options.id || makeSnapshotId(group, now),
      createdAt: now,
      updatedAt: now,
      source: group.type === 'firefox' ? 'firefox' : 'smart',
      groupId: normalizeText(group.id, ''),
      title: normalizeText(options.title || group.label, 'Saved group'),
      color: normalizeText(group.color, ''),
      collapsed: !!group.collapsed,
      tabs,
      sites: uniqueSorted(tabs.map(tab => tab.site)),
    };

    if (Number.isInteger(group.windowId)) snapshot.windowId = group.windowId;
    if (Number.isInteger(group.firefoxGroupId)) snapshot.firefoxGroupId = group.firefoxGroupId;

    return snapshot;
  }

  function normalizeSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return null;

    const tabs = Array.isArray(snapshot.tabs)
      ? snapshot.tabs
        .filter(tab => tab && isRestorableUrl(tab.url))
        .map((tab, index) => ({
          url: tab.url,
          title: normalizeText(tab.title, tab.url),
          pinned: !!tab.pinned,
          active: !!tab.active,
          index: typeof tab.index === 'number' ? tab.index : index,
          site: normalizeText(tab.site, siteFromUrl(tab.url)),
        }))
      : [];

    if (tabs.length === 0) return null;

    const createdAt = normalizeText(snapshot.createdAt, new Date().toISOString());
    const normalized = {
      id: normalizeText(snapshot.id, makeSnapshotId(snapshot, createdAt)),
      createdAt,
      updatedAt: normalizeText(snapshot.updatedAt, createdAt),
      source: snapshot.source === 'firefox' ? 'firefox' : 'smart',
      groupId: normalizeText(snapshot.groupId, ''),
      title: normalizeText(snapshot.title, 'Saved group'),
      color: normalizeText(snapshot.color, ''),
      collapsed: !!snapshot.collapsed,
      tabs,
      sites: uniqueSorted(Array.isArray(snapshot.sites) && snapshot.sites.length
        ? snapshot.sites.map(site => normalizeText(site, ''))
        : tabs.map(tab => tab.site)),
    };

    if (Number.isInteger(snapshot.windowId)) normalized.windowId = snapshot.windowId;
    if (Number.isInteger(snapshot.firefoxGroupId)) normalized.firefoxGroupId = snapshot.firefoxGroupId;

    return normalized;
  }

  function normalizeSavedGroups(value) {
    return (Array.isArray(value) ? value : [])
      .map(normalizeSnapshot)
      .filter(Boolean)
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  function clearCompletedDeferred(deferred) {
    const source = Array.isArray(deferred) ? deferred : [];
    const next = source.filter(item => !(item && item.completed));
    return {
      next,
      removed: source.length - next.length,
    };
  }

  function applyGroupAliases(groups, aliases) {
    const aliasMap = aliases && typeof aliases === 'object' ? aliases : {};
    return (Array.isArray(groups) ? groups : []).map(group => {
      const alias = normalizeText(aliasMap[group.id], '');
      if (!alias || alias === group.label) return group;
      return {
        ...group,
        label: alias,
        originalLabel: group.originalLabel || group.label,
        alias,
      };
    });
  }

  function flattenBookmarkTree(nodes, path = []) {
    const bookmarks = [];

    for (const node of nodes || []) {
      const title = normalizeText(node && node.title, '');
      if (node && node.url) {
        bookmarks.push({
          id: node.id,
          parentId: node.parentId,
          title: normalizeText(node.title, node.url),
          url: node.url,
          dateAdded: node.dateAdded || 0,
          folderPath: path.filter(Boolean).join(' / '),
        });
      }

      if (node && Array.isArray(node.children)) {
        const nextPath = node.url ? path : (title ? [...path, title] : path);
        bookmarks.push(...flattenBookmarkTree(node.children, nextPath));
      }
    }

    return bookmarks.sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0));
  }

  function filterBookmarks(bookmarks, query) {
    const needle = normalizeText(query, '').toLowerCase();
    if (!needle) return Array.isArray(bookmarks) ? bookmarks : [];

    return (Array.isArray(bookmarks) ? bookmarks : []).filter(bookmark =>
      [
        bookmark.title,
        bookmark.url,
        bookmark.folderPath,
      ].join(' ').toLowerCase().includes(needle)
    );
  }

  return {
    applyGroupAliases,
    clearCompletedDeferred,
    createGroupSnapshot,
    filterBookmarks,
    flattenBookmarkTree,
    isRestorableUrl,
    normalizeSavedGroups,
  };
});
