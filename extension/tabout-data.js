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

  return {
    EXPORT_KEYS,
    EXPORT_SCHEMA_VERSION,
    buildExportPayload,
    sanitizeImportPayload,
  };
});
