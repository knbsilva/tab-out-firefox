/**
 * Firefox background events for Tab Out.
 *
 * Keeps the toolbar badge current, exposes the "to" omnibox alias, broadcasts
 * live refresh signals to dashboard pages, and records development-only logs.
 */

'use strict';

const DASHBOARD_FILE = 'index.html';
const BOOKMARK_FOLDER_TITLE = 'Tab Out';
const BOOKMARK_FOLDER_KEY = 'tabOutBookmarkFolderId';
const SAVED_GROUPS_KEY = 'tabOutSavedGroups';
const DEV_LOG_KEY = '__tabOutDevLogs';
const UI_STATE_KEY = 'tabOutUiState';
const DEV_LOG_LIMIT = 300;

const Grouping = globalThis.TabOutGrouping;
const SavedGroups = globalThis.TabOutSavedGroups;
const DataTools = globalThis.TabOutData;

let logQueue = Promise.resolve();

function isUserFacingTabUrl(url) {
  if (!url) return false;

  try {
    return ['http:', 'https:', 'file:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

function normalizeView(value) {
  return ['groups', 'saved', 'saved-groups', 'favorites', 'data'].includes(value)
    ? value
    : 'groups';
}

function dashboardUrl(view) {
  const url = browser.runtime.getURL(DASHBOARD_FILE);
  return view ? `${url}#view=${encodeURIComponent(normalizeView(view))}` : url;
}

function devLog(event, details = {}) {
  const entry = {
    ts: new Date().toISOString(),
    source: 'background',
    event,
    details,
  };

  console.log('[tab-out:dev]', event, details);

  logQueue = logQueue
    .then(async () => {
      const data = await browser.storage.local.get(DEV_LOG_KEY);
      const logs = Array.isArray(data[DEV_LOG_KEY]) ? data[DEV_LOG_KEY] : [];
      logs.push(entry);
      await browser.storage.local.set({ [DEV_LOG_KEY]: logs.slice(-DEV_LOG_LIMIT) });
    })
    .catch(error => {
      console.warn('[tab-out:dev] failed to persist log', error);
    });
}

async function updateBadge() {
  try {
    const tabs = await browser.tabs.query({});
    const count = tabs.filter(tab => isUserFacingTabUrl(tab.url)).length;

    await browser.action.setBadgeText({ text: count > 0 ? String(count) : '' });

    if (count === 0) return;

    const color = count <= 10
      ? '#2f7d55'
      : count <= 20
        ? '#b7791f'
        : '#b54747';

    await browser.action.setBadgeBackgroundColor({ color });
  } catch (error) {
    console.warn('[tab-out:dev] badge update failed', error);
    browser.action.setBadgeText({ text: '' });
  }
}

async function notifyDashboard(reason, details = {}) {
  devLog(reason, details);
  await updateBadge();

  try {
    await browser.runtime.sendMessage({
      type: 'tab-out:refresh',
      reason,
      details,
      ts: Date.now(),
    });
  } catch {
    // No dashboard page may be open. The next new tab will render fresh state.
  }
}

async function openOrFocusDashboard(view, source = 'dashboard') {
  const url = dashboardUrl(view);
  const baseUrl = dashboardUrl();
  const tabs = await browser.tabs.query({});
  const existing = tabs.find(tab => String(tab.url || '').startsWith(baseUrl));

  if (existing && existing.id != null) {
    const update = { active: true };
    if (view) update.url = url;
    await browser.tabs.update(existing.id, update);
    if (existing.windowId != null) {
      await browser.windows.update(existing.windowId, { focused: true });
    }
    devLog(`${source}.focus-dashboard`, { tabId: existing.id, windowId: existing.windowId, view: normalizeView(view) });
    return;
  }

  const tab = await browser.tabs.create({ url });
  devLog(`${source}.open-dashboard`, { tabId: tab.id, windowId: tab.windowId, view: normalizeView(view) });
}

function countBookmarkNodes(nodes) {
  let count = 0;
  for (const node of nodes || []) {
    if (node.url) count += 1;
    if (node.children) count += countBookmarkNodes(node.children);
  }
  return count;
}

function flattenBookmarks(nodes, out = []) {
  for (const node of nodes || []) {
    out.push(node);
    if (node.children) flattenBookmarks(node.children, out);
  }
  return out;
}

async function findWritableBookmarkParent() {
  const tree = await browser.bookmarks.getTree();
  const rootChildren = (tree[0] && tree[0].children) || [];
  return rootChildren.find(node => node.type === 'folder' && !node.unmodifiable) ||
    rootChildren.find(node => node.type === 'folder') ||
    null;
}

async function ensureBookmarkFolder() {
  const stored = await browser.storage.local.get(BOOKMARK_FOLDER_KEY);
  if (stored[BOOKMARK_FOLDER_KEY]) {
    try {
      const [folder] = await browser.bookmarks.get(stored[BOOKMARK_FOLDER_KEY]);
      if (folder && !folder.url) return folder.id;
    } catch {
      // Folder was deleted. Recreate below.
    }
  }

  const tree = await browser.bookmarks.getTree();
  const folders = flattenBookmarks(tree).filter(node => !node.url && node.title === BOOKMARK_FOLDER_TITLE);
  const existing = folders.find(node => node.id !== 'root________') || folders[0];
  if (existing) {
    await browser.storage.local.set({ [BOOKMARK_FOLDER_KEY]: existing.id });
    return existing.id;
  }

  const parent = await findWritableBookmarkParent();
  if (!parent) throw new Error('No writable bookmark parent found');
  const created = await browser.bookmarks.create({ parentId: parent.id, title: BOOKMARK_FOLDER_TITLE });
  await browser.storage.local.set({ [BOOKMARK_FOLDER_KEY]: created.id });
  return created.id;
}

async function getActiveUserTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab || !isUserFacingTabUrl(tab.url)) {
    throw new Error('Open a regular web tab first');
  }
  return tab;
}

async function favoriteActiveTab() {
  const tab = await getActiveUserTab();
  const folderId = await ensureBookmarkFolder();
  const existing = (await browser.bookmarks.getChildren(folderId))
    .find(node => node.url === tab.url);

  if (existing) {
    devLog('popup.favorite-tab.exists', { url: tab.url });
    return { alreadyExists: true, title: existing.title || tab.title || tab.url };
  }

  const bookmark = await browser.bookmarks.create({
    parentId: folderId,
    title: tab.title || tab.url,
    url: tab.url,
  });
  devLog('popup.favorite-tab.created', { bookmarkId: bookmark.id, url: tab.url });
  return { alreadyExists: false, title: bookmark.title || tab.title || tab.url };
}

async function favoriteActiveGroup() {
  if (!Grouping || !SavedGroups) throw new Error('Grouping helpers unavailable');

  const activeTab = await getActiveUserTab();
  const tabs = await browser.tabs.query({});
  const firefoxGroups = browser.tabGroups && browser.tabGroups.query
    ? await browser.tabGroups.query({})
    : [];
  const stored = await browser.storage.local.get(['tabOutGroupAliases', SAVED_GROUPS_KEY]);
  const aliases = stored.tabOutGroupAliases && typeof stored.tabOutGroupAliases === 'object'
    ? stored.tabOutGroupAliases
    : {};
  const groups = SavedGroups.applyGroupAliases(
    Grouping.groupTabs(tabs, firefoxGroups, { extensionUrl: dashboardUrl() }),
    aliases
  );
  const group = groups.find(item => item.tabs.some(tab => tab.id === activeTab.id));
  if (!group) throw new Error('No Tab Out group found for active tab');

  const snapshot = SavedGroups.createGroupSnapshot(group);
  if (!snapshot) throw new Error('No restorable tabs in active group');

  const savedGroups = SavedGroups.normalizeSavedGroups(stored[SAVED_GROUPS_KEY]);
  const next = SavedGroups.normalizeSavedGroups([snapshot, ...savedGroups]);
  await browser.storage.local.set({ [SAVED_GROUPS_KEY]: next });
  devLog('popup.favorite-group.created', { snapshotId: snapshot.id, title: snapshot.title, tabCount: snapshot.tabs.length });
  return { title: snapshot.title, tabCount: snapshot.tabs.length };
}

async function exportTabOutData() {
  const storage = await browser.storage.local.get(DataTools.EXPORT_KEYS);
  const payload = DataTools.buildExportPayload(storage);
  devLog('data.export.popup', { keys: DataTools.EXPORT_KEYS });
  return payload;
}

async function importTabOutData(payload) {
  const data = DataTools.sanitizeImportPayload(payload);
  await browser.storage.local.set(data);
  devLog('data.import.popup', {
    deferred: data.deferred.length,
    savedGroups: data.tabOutSavedGroups.length,
    aliases: Object.keys(data.tabOutGroupAliases).length,
  });
  await notifyDashboard('data.import.popup');
  return { ok: true };
}

async function getPopupSummary() {
  const tabs = await browser.tabs.query({});
  const storage = await browser.storage.local.get(['deferred', 'tabOutSavedGroups']);
  const deferred = Array.isArray(storage.deferred) ? storage.deferred : [];
  const savedGroups = Array.isArray(storage.tabOutSavedGroups) ? storage.tabOutSavedGroups : [];
  let favorites = 0;

  if (browser.bookmarks && browser.bookmarks.getTree) {
    try {
      favorites = countBookmarkNodes(await browser.bookmarks.getTree());
    } catch (error) {
      devLog('popup.summary.bookmarks-failed', { message: error.message });
    }
  }

  return {
    tabs: tabs.filter(tab => isUserFacingTabUrl(tab.url)).length,
    saved: deferred.filter(item => item && !item.completed && !item.dismissed).length,
    archived: deferred.filter(item => item && item.completed && !item.dismissed).length,
    savedGroups: savedGroups.length,
    favorites,
  };
}

function registerTabListeners() {
  const tabEvents = [
    ['tabs.created', browser.tabs.onCreated],
    ['tabs.removed', browser.tabs.onRemoved],
    ['tabs.updated', browser.tabs.onUpdated],
    ['tabs.moved', browser.tabs.onMoved],
    ['tabs.attached', browser.tabs.onAttached],
    ['tabs.detached', browser.tabs.onDetached],
    ['tabs.activated', browser.tabs.onActivated],
  ];

  for (const [reason, eventTarget] of tabEvents) {
    if (!eventTarget || !eventTarget.addListener) continue;
    eventTarget.addListener((...args) => {
      notifyDashboard(reason, { args });
    });
  }
}

function registerTabGroupListeners() {
  if (!browser.tabGroups) return;

  const groupEvents = [
    ['tabGroups.created', browser.tabGroups.onCreated],
    ['tabGroups.moved', browser.tabGroups.onMoved],
    ['tabGroups.removed', browser.tabGroups.onRemoved],
    ['tabGroups.updated', browser.tabGroups.onUpdated],
  ];

  for (const [reason, eventTarget] of groupEvents) {
    if (!eventTarget || !eventTarget.addListener) continue;
    eventTarget.addListener((...args) => {
      notifyDashboard(reason, { args });
    });
  }
}

function registerBookmarkListeners() {
  if (!browser.bookmarks) return;

  const bookmarkEvents = [
    ['bookmarks.created', browser.bookmarks.onCreated],
    ['bookmarks.removed', browser.bookmarks.onRemoved],
    ['bookmarks.changed', browser.bookmarks.onChanged],
    ['bookmarks.moved', browser.bookmarks.onMoved],
  ];

  for (const [reason, eventTarget] of bookmarkEvents) {
    if (!eventTarget || !eventTarget.addListener) continue;
    eventTarget.addListener((...args) => {
      notifyDashboard(reason, { args });
    });
  }
}

function registerStorageListener() {
  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    const changedKeys = Object.keys(changes);
    if (changedKeys.every(key => key === DEV_LOG_KEY || key === UI_STATE_KEY)) return;
    notifyDashboard('storage.changed', { changedKeys });
  });
}

function registerOmnibox() {
  if (!browser.omnibox) return;

  browser.omnibox.setDefaultSuggestion({
    description: 'Open Tab Out dashboard',
  });

  browser.omnibox.onInputStarted.addListener(() => {
    devLog('omnibox.input-started');
  });

  browser.omnibox.onInputChanged.addListener((text, suggest) => {
    suggest([
      {
        content: text || 'open',
        description: 'Open Tab Out dashboard',
      },
    ]);
  });

  browser.omnibox.onInputEntered.addListener(() => {
    openOrFocusDashboard('groups', 'omnibox').catch(error => {
      devLog('omnibox.error', { message: error.message });
    });
  });
}

function registerRuntimeMessages() {
  browser.runtime.onMessage.addListener(message => {
    if (!message || typeof message !== 'object') return false;

    if (message.type === 'tab-out:open-dashboard') {
      return openOrFocusDashboard(message.view, 'popup')
        .then(() => ({ ok: true }))
        .catch(error => {
          devLog('popup.open-dashboard.failed', { message: error.message });
          return { ok: false, error: error.message };
        });
    }

    if (message.type === 'tab-out:popup-summary') {
      return getPopupSummary()
        .then(summary => ({ ok: true, summary }))
        .catch(error => {
          devLog('popup.summary.failed', { message: error.message });
          return { ok: false, error: error.message };
        });
    }

    if (message.type === 'tab-out:refresh-dashboard') {
      return notifyDashboard('popup.refresh')
        .then(() => ({ ok: true }))
        .catch(error => {
          devLog('popup.refresh.failed', { message: error.message });
          return { ok: false, error: error.message };
        });
    }

    if (message.type === 'tab-out:favorite-active-tab') {
      return favoriteActiveTab()
        .then(result => ({ ok: true, result }))
        .catch(error => {
          devLog('popup.favorite-tab.failed', { message: error.message });
          return { ok: false, error: error.message };
        });
    }

    if (message.type === 'tab-out:favorite-active-group') {
      return favoriteActiveGroup()
        .then(result => ({ ok: true, result }))
        .catch(error => {
          devLog('popup.favorite-group.failed', { message: error.message });
          return { ok: false, error: error.message };
        });
    }

    if (message.type === 'tab-out:export-data') {
      return exportTabOutData()
        .then(payload => ({ ok: true, payload }))
        .catch(error => {
          devLog('data.export.failed', { message: error.message });
          return { ok: false, error: error.message };
        });
    }

    if (message.type === 'tab-out:import-data') {
      return importTabOutData(message.payload)
        .then(result => ({ ok: true, result }))
        .catch(error => {
          devLog('data.import.failed', { message: error.message });
          return { ok: false, error: error.message };
        });
    }

    return false;
  });
}

browser.runtime.onInstalled.addListener(() => {
  notifyDashboard('runtime.installed');
});

browser.runtime.onStartup.addListener(() => {
  notifyDashboard('runtime.startup');
});

registerTabListeners();
registerTabGroupListeners();
registerBookmarkListeners();
registerStorageListener();
registerOmnibox();
registerRuntimeMessages();

updateBadge();
