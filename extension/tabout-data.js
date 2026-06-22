(function initTabOutData(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = api;
  }
  root.TabOutData = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function tabOutDataFactory() {
  'use strict';

  const EXPORT_SCHEMA_VERSION = 'tab-out-storage/v1';
  const EXPORT_KEYS = [
    'deferred',
    'tabOutSavedGroups',
    'tabOutGroupAliases',
    'tabOutUiState',
  ];

  function cloneJson(value, fallback) {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch {
      return fallback;
    }
  }

  function objectOnly(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function arrayOnly(value) {
    return Array.isArray(value) ? value : [];
  }

  function pickExportData(storage) {
    const source = objectOnly(storage);
    return {
      deferred: cloneJson(arrayOnly(source.deferred), []),
      tabOutSavedGroups: cloneJson(arrayOnly(source.tabOutSavedGroups), []),
      tabOutGroupAliases: cloneJson(objectOnly(source.tabOutGroupAliases), {}),
      tabOutUiState: cloneJson(objectOnly(source.tabOutUiState), {}),
    };
  }

  function buildExportPayload(storage, now = new Date().toISOString()) {
    return {
      schema_version: EXPORT_SCHEMA_VERSION,
      exportedAt: now,
      source: 'tab-out-firefox',
      data: pickExportData(storage),
    };
  }

  function readPayloadData(payload) {
    if (!payload || typeof payload !== 'object') return {};
    if (payload.schema_version === EXPORT_SCHEMA_VERSION) return objectOnly(payload.data);
    return objectOnly(payload);
  }

  function sanitizeImportPayload(payload) {
    return pickExportData(readPayloadData(payload));
  }

  function normalizeItemUrlKey(url) {
    if (!url) return '';

    try {
      const parsed = new URL(url);
      parsed.hash = '';
      return parsed.href.replace(/\/$/, '');
    } catch {
      return String(url || '').trim();
    }
  }

  function isUserFacingUrl(url) {
    if (!url) return false;

    try {
      return ['http:', 'https:', 'file:'].includes(new URL(url).protocol);
    } catch {
      return false;
    }
  }

  function getDuplicateUrlKeys(items) {
    const counts = {};
    for (const item of Array.isArray(items) ? items : []) {
      const key = normalizeItemUrlKey(item && item.url);
      if (!key) continue;
      counts[key] = (counts[key] || 0) + 1;
    }
    return new Set(Object.entries(counts).filter(([, count]) => count > 1).map(([key]) => key));
  }

  function filterDuplicateUrlItems(items) {
    const source = Array.isArray(items) ? items : [];
    const duplicates = getDuplicateUrlKeys(source);
    if (duplicates.size === 0) return [];
    return source.filter(item => duplicates.has(normalizeItemUrlKey(item && item.url)));
  }

  function createSavedItemsFromBookmarks(bookmarks, existingDeferred = [], now = new Date().toISOString()) {
    const next = cloneJson(arrayOnly(existingDeferred), []);
    const activeKeys = new Set(
      next
        .filter(item => item && !item.completed && !item.dismissed)
        .map(item => normalizeItemUrlKey(item.url))
        .filter(Boolean)
    );
    const added = [];

    for (const bookmark of arrayOnly(bookmarks)) {
      if (!bookmark || !isUserFacingUrl(bookmark.url)) continue;
      const key = normalizeItemUrlKey(bookmark.url);
      if (!key || activeKeys.has(key)) continue;

      const item = {
        id: `bookmark-${Date.parse(now) || Date.now()}-${added.length + 1}`,
        url: bookmark.url,
        title: bookmark.title || bookmark.url,
        savedAt: now,
        completed: false,
        dismissed: false,
        source: 'firefox-bookmark',
      };
      next.push(item);
      added.push(item);
      activeKeys.add(key);
    }

    return { next, added };
  }

  return {
    EXPORT_KEYS,
    EXPORT_SCHEMA_VERSION,
    buildExportPayload,
    createSavedItemsFromBookmarks,
    filterDuplicateUrlItems,
    getDuplicateUrlKeys,
    sanitizeImportPayload,
  };
});
