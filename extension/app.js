/* Tab Out - Firefox dashboard app */

'use strict';

const {
  TAB_GROUP_NONE,
  filterRenderableGroups,
  groupTabs,
  isUserFacingTabUrl,
  normalizeUrlKey,
  siteFromUrl,
} = globalThis.TabOutGrouping;

const {
  applyGroupAliases,
  clearCompletedDeferred,
  createGroupSnapshot,
  filterBookmarks,
  flattenBookmarkTree,
  normalizeSavedGroups,
} = globalThis.TabOutSavedGroups;

const {
  EXPORT_KEYS,
  buildExportPayload,
  createSavedItemsFromBookmarks,
  filterDuplicateUrlItems,
  sanitizeImportPayload,
} = globalThis.TabOutData;

const DEFERRED_KEY = 'deferred';
const SAVED_GROUPS_KEY = 'tabOutSavedGroups';
const GROUP_ALIASES_KEY = 'tabOutGroupAliases';
const UI_STATE_KEY = 'tabOutUiState';
const DEV_LOG_KEY = '__tabOutDevLogs';
const DEV_LOG_LIMIT = 300;

const state = {
  allTabs: [],
  realTabs: [],
  firefoxGroups: [],
  groups: [],
  deferredActive: [],
  deferredArchived: [],
  bookmarkIndex: new Map(),
  allBookmarks: [],
  savedGroups: [],
  groupAliases: {},
  ui: {
    view: 'groups',
    groupFilter: 'all',
    tabFilter: '',
    listFilter: '',
    query: '',
    bookmarkQuery: '',
    archiveQuery: '',
    archiveOpen: false,
    expandedGroups: {},
    expandedSavedGroups: {},
  },
  refreshTimer: null,
  refreshInFlight: false,
  pendingReason: null,
};

let logQueue = Promise.resolve();

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function attr(value) {
  return escapeHtml(value);
}

function safeHref(url) {
  return isUserFacingTabUrl(url) ? url : '#';
}

function clearElement(element) {
  while (element && element.firstChild) {
    element.removeChild(element.firstChild);
  }
}

function createNode(tagName, className, text) {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function createActionButton(action, text, className, dataset = {}, title = '') {
  const button = createNode('button', className, text);
  button.type = 'button';
  button.dataset.action = action;
  for (const [key, value] of Object.entries(dataset)) {
    button.dataset[key] = String(value);
  }
  if (title) button.title = title;
  return button;
}

function createBadge(className, text) {
  return createNode('span', className, text);
}

function createDuplicateBadge(count, key) {
  const badge = createBadge('duplicate-badge', `${count}x`);
  if (key) badge.title = `Duplicate key: ${key}`;
  return badge;
}

function normalizeView(value) {
  if (value === 'favorites') return 'firefox-bookmarks';
  return ['groups', 'saved-groups', 'open-tabs', 'saved', 'firefox-bookmarks', 'data'].includes(value)
    ? value
    : 'groups';
}

function dashboardUrl(view) {
  const url = browser.runtime.getURL('index.html');
  return view ? `${url}#view=${encodeURIComponent(normalizeView(view))}` : url;
}

function urlKey(url) {
  return normalizeUrlKey(url);
}

function nowTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function devLog(event, details = {}) {
  const entry = {
    ts: new Date().toISOString(),
    source: 'dashboard',
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

function showToast(message) {
  const toast = $('toast');
  const text = $('toastText');
  if (!toast || !text) return;

  text.textContent = message;
  toast.classList.add('visible');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('visible'), 2200);
}

function timeAgo(isoString) {
  const time = new Date(isoString).getTime();
  if (!Number.isFinite(time)) return '';

  const seconds = Math.max(1, Math.floor((Date.now() - time) / 1000));
  if (seconds < 60) return 'now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d`;
  const months = Math.floor(days / 30);
  return `${months}mo`;
}

function simplifyTitle(title, url) {
  const raw = String(title || url || 'Untitled');
  return raw
    .replace(/\s[-|\u00b7]\s.*$/, '')
    .replace(/\(\d+\)\s*$/, '')
    .trim() || raw;
}

function tabDisplayTitle(tab) {
  const base = simplifyTitle(tab.title, tab.url);
  try {
    const parsed = new URL(tab.url);
    if (parsed.hostname === 'localhost' && parsed.port) return `${parsed.port} ${base}`;
  } catch {}
  return base;
}

function getTabById(tabId) {
  return state.allTabs.find(tab => tab.id === tabId);
}

function isTabOutUrl(url) {
  return String(url || '').startsWith(dashboardUrl());
}

function normalizeBrowserTab(tab) {
  return {
    id: tab.id,
    url: tab.url || tab.pendingUrl || '',
    title: tab.title || tab.url || 'Untitled',
    windowId: tab.windowId,
    active: !!tab.active,
    index: typeof tab.index === 'number' ? tab.index : 0,
    pinned: !!tab.pinned,
    discarded: !!tab.discarded,
    audible: !!tab.audible,
    groupId: typeof tab.groupId === 'number' ? tab.groupId : TAB_GROUP_NONE,
    favIconUrl: tab.favIconUrl || '',
    isTabOut: isTabOutUrl(tab.url),
  };
}

async function loadUiState() {
  const data = await browser.storage.local.get(UI_STATE_KEY);
  if (data[UI_STATE_KEY] && typeof data[UI_STATE_KEY] === 'object') {
    state.ui = { ...state.ui, ...data[UI_STATE_KEY] };
  }
  state.ui.view = normalizeView(new URLSearchParams(location.hash.slice(1)).get('view') || state.ui.view);
  const legacyFilter = state.ui.filter;
  if (!['firefox', 'smart'].includes(state.ui.groupFilter)) state.ui.groupFilter = 'all';
  if (['firefox', 'smart'].includes(legacyFilter) && state.ui.groupFilter === 'all') {
    state.ui.groupFilter = legacyFilter;
  }
  state.ui.tabFilter = state.ui.tabFilter || (legacyFilter === 'duplicates' ? 'duplicates' : '');
  if (!['', 'duplicates'].includes(state.ui.tabFilter)) state.ui.tabFilter = '';
  state.ui.listFilter = state.ui.listFilter || '';
  if (!['', 'duplicates'].includes(state.ui.listFilter)) state.ui.listFilter = '';
  delete state.ui.filter;
  delete state.ui.bookmarkMode;
  if (!state.ui.expandedGroups || typeof state.ui.expandedGroups !== 'object') {
    state.ui.expandedGroups = {};
  }
  if (!state.ui.expandedSavedGroups || typeof state.ui.expandedSavedGroups !== 'object') {
    state.ui.expandedSavedGroups = {};
  }

  const search = $('globalSearch');
  if (search) search.value = state.ui.query || '';
  const bookmarkSearch = $('bookmarkSearch');
  if (bookmarkSearch) bookmarkSearch.value = state.ui.bookmarkQuery || '';
  const archiveSearch = $('archiveSearch');
  if (archiveSearch) archiveSearch.value = state.ui.archiveQuery || '';
}

async function persistUiState() {
  await browser.storage.local.set({ [UI_STATE_KEY]: state.ui });
}

function downloadJsonFile(payload, filename) {
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        resolve(JSON.parse(String(reader.result || '{}')));
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsText(file);
  });
}

async function exportTabOutData() {
  const storage = await browser.storage.local.get(EXPORT_KEYS);
  const payload = buildExportPayload(storage);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  downloadJsonFile(payload, `tab-out-data-${stamp}.json`);
  devLog('data.export', { keys: EXPORT_KEYS });
  showToast('Exported Tab Out data');
}

async function importTabOutData(file) {
  if (!file) return;
  const payload = await readJsonFile(file);
  const data = sanitizeImportPayload(payload);
  const confirmed = window.confirm('Import Tab Out data and replace saved tabs, archive, saved groups, aliases and UI state? Firefox bookmarks will not be changed.');
  if (!confirmed) return;

  await browser.storage.local.set(data);
  devLog('data.import', {
    deferred: data.deferred.length,
    savedGroups: data.tabOutSavedGroups.length,
    aliases: Object.keys(data.tabOutGroupAliases).length,
  });
  showToast('Imported Tab Out data');
  await loadUiState();
  scheduleRefresh('data.import');
}

async function persistDeferred(next, reason) {
  const normalized = Array.isArray(next) ? next : [];
  await browser.storage.local.set({ [DEFERRED_KEY]: normalized });
  const stored = await browser.storage.local.get(DEFERRED_KEY);
  const persisted = Array.isArray(stored[DEFERRED_KEY]) ? stored[DEFERRED_KEY] : [];
  devLog('storage.persist.deferred', {
    reason,
    requested: normalized.length,
    persisted: persisted.length,
    active: persisted.filter(item => item && !item.completed && !item.dismissed).length,
    archived: persisted.filter(item => item && item.completed && !item.dismissed).length,
  });
  return persisted;
}

async function fetchOpenTabs() {
  const tabs = await browser.tabs.query({});
  state.allTabs = tabs.map(normalizeBrowserTab);
  state.realTabs = state.allTabs.filter(tab => isUserFacingTabUrl(tab.url));
}

async function fetchFirefoxGroups() {
  if (!browser.tabGroups || !browser.tabGroups.query) {
    state.firefoxGroups = [];
    return;
  }

  try {
    state.firefoxGroups = await browser.tabGroups.query({});
  } catch (error) {
    devLog('tabGroups.query.failed', { message: error.message });
    state.firefoxGroups = [];
  }
}

async function fetchBookmarks() {
  if (!browser.bookmarks) {
    state.allBookmarks = [];
    state.bookmarkIndex = new Map();
    return;
  }

  const tree = await browser.bookmarks.getTree();
  const all = flattenBookmarkTree(tree);
  const index = new Map();
  for (const bookmark of all) {
    const key = urlKey(bookmark.url);
    if (!index.has(key)) index.set(key, []);
    index.get(key).push(bookmark);
  }
  state.allBookmarks = all;
  state.bookmarkIndex = index;
}

async function fetchSavedGroups() {
  const data = await browser.storage.local.get([SAVED_GROUPS_KEY, GROUP_ALIASES_KEY]);
  state.savedGroups = normalizeSavedGroups(data[SAVED_GROUPS_KEY]);
  state.groupAliases = data[GROUP_ALIASES_KEY] && typeof data[GROUP_ALIASES_KEY] === 'object'
    ? data[GROUP_ALIASES_KEY]
    : {};
  devLog('storage.read.savedGroups', {
    raw: Array.isArray(data[SAVED_GROUPS_KEY]) ? data[SAVED_GROUPS_KEY].length : 0,
    normalized: state.savedGroups.length,
    aliases: Object.keys(state.groupAliases).length,
  });
}

async function getSavedTabs() {
  const { [DEFERRED_KEY]: deferred = [] } = await browser.storage.local.get(DEFERRED_KEY);
  const visible = Array.isArray(deferred) ? deferred.filter(tab => !tab.dismissed) : [];
  state.deferredActive = visible.filter(tab => !tab.completed);
  state.deferredArchived = visible.filter(tab => tab.completed);
  devLog('storage.read.deferred', {
    raw: Array.isArray(deferred) ? deferred.length : 0,
    active: state.deferredActive.length,
    archived: state.deferredArchived.length,
  });
}

async function saveTabForLater(tab) {
  const saved = await saveItemToDeferred({
    url: tab.url,
    title: tab.title || tab.url,
    source: 'save-later',
  }, 'saved.add');
  return saved;
}

async function updateSavedTab(id, patch) {
  const { [DEFERRED_KEY]: deferred = [] } = await browser.storage.local.get(DEFERRED_KEY);
  const next = Array.isArray(deferred) ? deferred.map(item => ({ ...item })) : [];
  const item = next.find(tab => tab.id === id);
  if (!item) return;
  Object.assign(item, patch);
  await persistDeferred(next, 'saved.update');
}

function bookmarkStatusForUrl(url) {
  const bookmarks = state.bookmarkIndex.get(urlKey(url)) || [];
  return {
    bookmarked: bookmarks.length > 0,
    firefoxBookmarks: bookmarks,
  };
}

function savedStatusForUrl(url) {
  const key = urlKey(url);
  return state.deferredActive.find(item => urlKey(item.url) === key) || null;
}

async function saveItemToDeferred(item, reason) {
  if (!item || !isUserFacingTabUrl(item.url)) return null;
  const { [DEFERRED_KEY]: deferred = [] } = await browser.storage.local.get(DEFERRED_KEY);
  const next = Array.isArray(deferred) ? deferred.map(entry => ({ ...entry })) : [];
  const existing = next.find(entry => !entry.dismissed && !entry.completed && urlKey(entry.url) === urlKey(item.url));
  if (existing) return existing;

  const saved = {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    url: item.url,
    title: item.title || item.url,
    savedAt: new Date().toISOString(),
    completed: false,
    dismissed: false,
    source: item.source || reason || 'saved',
  };
  next.push(saved);
  await persistDeferred(next, reason || 'saved.add');
  devLog(reason || 'saved.add', { id: saved.id, url: saved.url });
  return saved;
}

async function migrateVisibleBookmarksToTabOut() {
  const queryResults = getFirefoxBookmarkBaseItems();
  const candidates = queryResults.filter(bookmark =>
    isUserFacingTabUrl(bookmark.url) &&
    !savedStatusForUrl(bookmark.url)
  );

  if (candidates.length === 0) {
    showToast('No Firefox bookmarks to save');
    return;
  }

  const confirmed = window.confirm(`Copy ${candidates.length} Firefox bookmark${candidates.length !== 1 ? 's' : ''} to Saved tabs? Existing browser bookmarks will stay unchanged.`);
  if (!confirmed) return;

  const { [DEFERRED_KEY]: deferred = [] } = await browser.storage.local.get(DEFERRED_KEY);
  const result = createSavedItemsFromBookmarks(candidates, deferred);
  await persistDeferred(result.next, 'saved.migrate-bookmarks');
  devLog('saved.migrate-bookmarks', { count: result.added.length });
  showToast(`Copied ${result.added.length} bookmark${result.added.length !== 1 ? 's' : ''} to Saved tabs`);
}

async function closeTabOutDupes() {
  const url = dashboardUrl();
  const tabs = await browser.tabs.query({});
  const dashboards = tabs.filter(tab => String(tab.url || '').startsWith(url));
  if (dashboards.length <= 1) return;

  const currentWindow = await browser.windows.getCurrent();
  const keep =
    dashboards.find(tab => tab.active && tab.windowId === currentWindow.id) ||
    dashboards.find(tab => tab.active) ||
    dashboards[0];
  const toClose = dashboards.filter(tab => tab.id !== keep.id).map(tab => tab.id);
  if (toClose.length > 0) await browser.tabs.remove(toClose);
  devLog('tabout.close-dupes', { closed: toClose.length });
}

async function focusTab(tabId) {
  const tab = getTabById(tabId);
  if (!tab || tab.id == null) return;
  await browser.tabs.update(tab.id, { active: true });
  if (tab.windowId != null) await browser.windows.update(tab.windowId, { focused: true });
  devLog('tab.focus', { tabId });
}

async function closeTabsByIds(tabIds) {
  const ids = tabIds.filter(id => Number.isInteger(id));
  if (ids.length === 0) return;
  await browser.tabs.remove(ids);
  devLog('tabs.close', { count: ids.length, tabIds: ids });
}

async function getLiveTabIdsForGroup(group) {
  if (!group) return [];

  if (group.type === 'firefox' && Number.isInteger(group.firefoxGroupId)) {
    try {
      const query = { groupId: group.firefoxGroupId };
      if (Number.isInteger(group.windowId)) query.windowId = group.windowId;
      const tabs = await browser.tabs.query(query);
      return tabs
        .filter(tab => isUserFacingTabUrl(tab.url || tab.pendingUrl))
        .map(tab => tab.id)
        .filter(id => Number.isInteger(id));
    } catch (error) {
      devLog('tabGroups.live-query.failed', {
        groupId: group.id,
        firefoxGroupId: group.firefoxGroupId,
        message: error.message,
      });
    }
  }

  return group.tabs.map(tab => tab.id).filter(id => Number.isInteger(id));
}

async function closeGroup(group) {
  devLog('group.close.start', {
    groupId: group.id,
    type: group.type,
    firefoxGroupId: group.firefoxGroupId,
    renderedTabs: group.tabs.length,
  });

  try {
    const tabIds = await getLiveTabIdsForGroup(group);
    if (tabIds.length === 0) {
      devLog('group.close.no-live-tabs', { groupId: group.id, type: group.type });
      showToast('No live tabs found for this group');
      return false;
    }

    await closeTabsByIds(tabIds);
    devLog('group.close.success', { groupId: group.id, type: group.type, closed: tabIds.length });
    showToast(`Closed ${tabIds.length} tab${tabIds.length !== 1 ? 's' : ''}`);
    return true;
  } catch (error) {
    devLog('group.close.failed', { groupId: group.id, type: group.type, message: error.message });
    showToast('Could not close group');
    return false;
  }
}

async function createFirefoxGroup(groupId) {
  const group = state.groups.find(item => item.id === groupId);
  if (!group || group.type !== 'smart') return;
  if (!browser.tabs.group || !browser.tabGroups || !browser.tabGroups.update) {
    showToast('Firefox tab groups API is not available');
    return;
  }

  const tabIds = group.tabs.map(tab => tab.id).filter(id => Number.isInteger(id));
  if (tabIds.length === 0) return;

  const firefoxGroupId = await browser.tabs.group({ tabIds });
  await browser.tabGroups.update(firefoxGroupId, {
    title: group.label,
    color: pickGroupColor(group.kind),
  });
  devLog('tabGroups.create-from-smart', { groupId, firefoxGroupId, tabCount: tabIds.length });
  showToast(`Created Firefox group: ${group.label}`);
}

async function persistSavedGroups(groups) {
  const normalized = normalizeSavedGroups(groups);
  await browser.storage.local.set({ [SAVED_GROUPS_KEY]: normalized });
  const stored = await browser.storage.local.get(SAVED_GROUPS_KEY);
  state.savedGroups = normalizeSavedGroups(stored[SAVED_GROUPS_KEY]);
  devLog('storage.persist.savedGroups', {
    requested: normalized.length,
    persisted: state.savedGroups.length,
  });
}

async function persistGroupAliases(aliases) {
  state.groupAliases = aliases && typeof aliases === 'object' ? aliases : {};
  await browser.storage.local.set({ [GROUP_ALIASES_KEY]: state.groupAliases });
}

async function saveGroupSnapshot(groupId, options = {}) {
  const group = state.groups.find(item => item.id === groupId);
  if (!group) return;

  if (options.closeAfter) {
    const confirmed = window.confirm(`Save "${group.label}" and close ${group.tabs.length} tab${group.tabs.length !== 1 ? 's' : ''}?`);
    if (!confirmed) return;
  }

  const snapshot = createGroupSnapshot(group);
  if (!snapshot) {
    showToast('No restorable tabs in this group');
    return;
  }

  await persistSavedGroups([snapshot, ...state.savedGroups]);
  devLog('savedGroups.save', {
    snapshotId: snapshot.id,
    groupId,
    closeAfter: !!options.closeAfter,
    tabCount: snapshot.tabs.length,
  });

  if (options.closeAfter) {
    const liveTabIds = await getLiveTabIdsForGroup(group);
    if (liveTabIds.length > 0) await closeTabsByIds(liveTabIds);
    devLog('savedGroups.save-close.closed', { groupId, snapshotId: snapshot.id, closed: liveTabIds.length });
    showToast(liveTabIds.length > 0
      ? `Saved and closed ${liveTabIds.length} tab${liveTabIds.length !== 1 ? 's' : ''}`
      : 'Saved group; no live tabs found to close');
  } else {
    showToast(`Saved group: ${snapshot.title}`);
  }
}

async function restoreSavedGroup(snapshotId) {
  const snapshot = state.savedGroups.find(item => item.id === snapshotId);
  if (!snapshot || !snapshot.tabs.length) return;
  if (!browser.tabs.group || !browser.tabGroups || !browser.tabGroups.update) {
    showToast('Firefox tab groups API is not available');
    return;
  }

  const createdTabs = [];
  for (const item of snapshot.tabs) {
    const created = await browser.tabs.create({
      url: item.url,
      active: false,
    });
    createdTabs.push({
      id: created.id,
      active: !!item.active,
      pinned: !!item.pinned,
    });
  }

  const tabIds = createdTabs.map(tab => tab.id).filter(id => Number.isInteger(id));
  if (tabIds.length === 0) return;

  const firefoxGroupId = await browser.tabs.group({ tabIds });
  const update = {
    title: snapshot.title,
    collapsed: !!snapshot.collapsed,
  };
  if (snapshot.color) update.color = snapshot.color;
  await browser.tabGroups.update(firefoxGroupId, update);

  for (const tab of createdTabs.filter(item => item.pinned)) {
    try {
      await browser.tabs.update(tab.id, { pinned: true });
    } catch (error) {
      devLog('savedGroups.restore.pin-failed', { snapshotId, tabId: tab.id, message: error.message });
    }
  }

  const activeTab = createdTabs.find(tab => tab.active) || createdTabs[0];
  if (activeTab) await browser.tabs.update(activeTab.id, { active: true });

  devLog('savedGroups.restore', { snapshotId, firefoxGroupId, tabCount: tabIds.length });
  showToast(`Restored group: ${snapshot.title}`);
}

async function deleteSavedGroup(snapshotId) {
  const snapshot = state.savedGroups.find(item => item.id === snapshotId);
  if (!snapshot) return;
  const confirmed = window.confirm(`Delete saved group "${snapshot.title}"?`);
  if (!confirmed) return;

  await persistSavedGroups(state.savedGroups.filter(item => item.id !== snapshotId));
  devLog('savedGroups.delete', { snapshotId });
  showToast('Saved group deleted');
}

async function renameGroup(groupId) {
  const group = state.groups.find(item => item.id === groupId);
  if (!group) return;

  const nextTitle = window.prompt('Group name', group.label);
  if (nextTitle == null) return;
  const trimmed = nextTitle.trim();
  if (!trimmed || trimmed === group.label) return;

  if (group.type === 'firefox') {
    if (!browser.tabGroups || !browser.tabGroups.update || !Number.isInteger(group.firefoxGroupId)) {
      showToast('Firefox group rename is not available');
      return;
    }

    await browser.tabGroups.update(group.firefoxGroupId, { title: trimmed });
    const aliases = { ...state.groupAliases };
    delete aliases[group.id];
    await persistGroupAliases(aliases);
    devLog('tabGroups.rename', { groupId, firefoxGroupId: group.firefoxGroupId, title: trimmed });
    showToast(`Renamed group: ${trimmed}`);
    return;
  }

  const aliases = { ...state.groupAliases };
  const originalLabel = group.originalLabel || group.label;
  if (trimmed === originalLabel) {
    delete aliases[group.id];
  } else {
    aliases[group.id] = trimmed;
  }
  await persistGroupAliases(aliases);
  buildGroups();
  renderGroups();
  renderStats('rename');
  devLog('groups.rename-alias', { groupId, title: trimmed });
  showToast(`Renamed group: ${trimmed}`);
}

async function clearArchive() {
  if (state.deferredArchived.length === 0) return;
  const confirmed = window.confirm(`Clear ${state.deferredArchived.length} archived item${state.deferredArchived.length !== 1 ? 's' : ''}?`);
  if (!confirmed) return;

  const { [DEFERRED_KEY]: deferred = [] } = await browser.storage.local.get(DEFERRED_KEY);
  const result = clearCompletedDeferred(deferred);
  await persistDeferred(result.next, 'archive.clear');
  devLog('archive.clear', { removed: result.removed });
  showToast(`Cleared ${result.removed} archived item${result.removed !== 1 ? 's' : ''}`);
}

async function deleteFirefoxBookmark(bookmarkId) {
  const bookmark = state.allBookmarks.find(item => item.id === bookmarkId);
  if (!bookmark) return false;

  const confirmed = window.confirm(`Delete Firefox bookmark "${bookmark.title || bookmark.url}"? Saved tabs in Tab Out will not be changed.`);
  if (!confirmed) return false;

  devLog('bookmark.delete.start', { bookmarkId, url: bookmark.url });
  try {
    await browser.bookmarks.remove(bookmarkId);
    devLog('bookmark.delete.success', { bookmarkId, url: bookmark.url });
    showToast('Firefox bookmark deleted');
    return true;
  } catch (error) {
    devLog('bookmark.delete.failed', { bookmarkId, url: bookmark.url, message: error.message });
    showToast('Could not delete Firefox bookmark');
    return false;
  }
}

function pickGroupColor(kind) {
  if (kind === 'homepages') return 'blue';
  if (kind === 'local-dev') return 'green';
  if (kind === 'local-files') return 'grey';
  if (kind === 'custom') return 'purple';
  return 'cyan';
}

async function closeDuplicates(groupId) {
  const group = state.groups.find(item => item.id === groupId);
  if (!group) return;

  const toClose = [];
  for (const key of group.duplicates.duplicateUrls) {
    const matching = group.tabs.filter(tab => urlKey(tab.url) === key);
    const keep = matching.find(tab => tab.active) || matching[0];
    for (const tab of matching) {
      if (tab.id !== keep.id) toClose.push(tab.id);
    }
  }

  devLog('duplicates.close.start', {
    groupId,
    duplicateExtras: toClose.length,
    duplicateKeys: group.duplicates.duplicateUrls.slice(0, 10),
  });
  await closeTabsByIds(toClose);
  devLog('duplicates.close.success', { groupId, closed: toClose.length });
  showToast(`Closed ${toClose.length} duplicate${toClose.length !== 1 ? 's' : ''}`);
}

function buildGroups() {
  const landingPagePatterns = typeof LOCAL_LANDING_PAGE_PATTERNS !== 'undefined'
    ? LOCAL_LANDING_PAGE_PATTERNS
    : [];
  const customGroups = typeof LOCAL_CUSTOM_GROUPS !== 'undefined'
    ? LOCAL_CUSTOM_GROUPS
    : [];

  const groups = groupTabs(state.allTabs, state.firefoxGroups, {
    extensionUrl: dashboardUrl(),
    landingPagePatterns,
    customGroups,
  });
  state.groups = applyGroupAliases(groups, state.groupAliases);
  const renderableGroups = getRenderableGroups();
  devLog('groups.build', {
    groups: state.groups.length,
    renderableGroups: renderableGroups.length,
    firefox: state.groups.filter(group => group.type === 'firefox').length,
    smart: state.groups.filter(group => group.type === 'smart').length,
    renderableFirefox: renderableGroups.filter(group => group.type === 'firefox').length,
    renderableSmart: renderableGroups.filter(group => group.type === 'smart').length,
  });
}

function scheduleRefresh(reason) {
  state.pendingReason = reason;
  clearTimeout(state.refreshTimer);
  state.refreshTimer = setTimeout(() => {
    refreshDashboard(state.pendingReason || 'scheduled');
  }, 150);
}

async function refreshDashboard(reason = 'manual') {
  if (state.refreshInFlight) {
    scheduleRefresh(reason);
    return;
  }

  state.refreshInFlight = true;
  try {
    devLog('refresh.start', { reason });
    await fetchOpenTabs();
    await fetchFirefoxGroups();
    await getSavedTabs();
    await fetchBookmarks();
    await fetchSavedGroups();
    buildGroups();
    renderDashboard(reason);
    devLog('refresh.complete', {
      reason,
      tabs: state.realTabs.length,
      groups: state.groups.length,
      renderableGroups: getRenderableGroups().length,
      bookmarks: state.allBookmarks.length,
      savedGroups: state.savedGroups.length,
    });
  } catch (error) {
    console.error('[tab-out] refresh failed', error);
    devLog('refresh.failed', { reason, message: error.message });
    showToast('Refresh failed');
  } finally {
    state.refreshInFlight = false;
  }
}

function filterGroups() {
  const query = (state.ui.query || '').trim().toLowerCase();
  let groups = getRenderableGroups();

  if (state.ui.groupFilter === 'firefox') groups = groups.filter(group => group.type === 'firefox');
  if (state.ui.groupFilter === 'smart') groups = groups.filter(group => group.type === 'smart');
  if (state.ui.tabFilter === 'duplicates') groups = groups.filter(group => group.duplicates.duplicateExtras > 0);

  if (!query) return groups;

  return groups
    .map(group => ({
      ...group,
      tabs: group.tabs.filter(tab => {
        const haystack = [
          tab.title,
          tab.url,
          group.label,
          ...group.sites,
        ].join(' ').toLowerCase();
        return haystack.includes(query);
      }),
    }))
    .filter(group =>
      group.tabs.length > 0 ||
      group.label.toLowerCase().includes(query) ||
      group.sites.some(site => site.toLowerCase().includes(query))
    );
}

function getRenderableGroups() {
  return filterRenderableGroups(state.groups, { minSmartTabs: 2 });
}

function getRenderableGroupForTab(tab) {
  if (!tab) return null;
  return getRenderableGroups().find(group => group.tabs.some(item => item.id === tab.id)) || null;
}

function getGroupLabelForTab(tab) {
  const group = getRenderableGroupForTab(tab);
  if (!group) return '';
  return group.type === 'firefox'
    ? `Firefox group: ${group.label}`
    : `Tab Out group: ${group.label}`;
}

function filterSavedGroupsForDisplay() {
  const query = (state.ui.query || '').trim().toLowerCase();
  let groups = [...state.savedGroups];

  if (state.ui.groupFilter === 'firefox') groups = groups.filter(group => group.source === 'firefox');
  if (state.ui.groupFilter === 'smart') groups = groups.filter(group => group.source === 'smart');
  if (state.ui.tabFilter === 'duplicates') groups = groups.filter(group => getDuplicateUrlKeys(group.tabs).size > 0);

  if (!query) return groups;

  return groups
    .map(group => ({
      ...group,
      tabs: group.tabs.filter(tab => {
        const haystack = [
          tab.title,
          tab.url,
          tab.site,
          group.title,
          ...group.sites,
        ].join(' ').toLowerCase();
        return haystack.includes(query);
      }),
    }))
    .filter(group =>
      group.tabs.length > 0 ||
      group.title.toLowerCase().includes(query) ||
      group.sites.some(site => site.toLowerCase().includes(query))
    );
}

function getDuplicateUrlKeys(items) {
  const counts = getUrlCounts(items);
  return new Set(Object.entries(counts).filter(([, count]) => count > 1).map(([key]) => key));
}

function getDuplicateExtras(items) {
  const counts = getUrlCounts(items);
  return Object.values(counts).reduce((sum, count) => sum + Math.max(0, count - 1), 0);
}

function getUrlCounts(items) {
  const counts = {};
  for (const item of items || []) {
    const key = urlKey(item.url);
    if (!key) continue;
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function filterDuplicateItems(items) {
  return filterDuplicateUrlItems(items);
}

function filterListItems(items) {
  if (state.ui.listFilter === 'duplicates') return filterDuplicateItems(items);
  return items;
}

function searchItems(items, query) {
  const needle = (query || '').trim().toLowerCase();
  const source = Array.isArray(items) ? items : [];
  if (!needle) return source;

  return source.filter(item => {
    const haystack = [
      item.title,
      item.url,
      item.folderPath,
      item.site || siteFromUrl(item.url),
      item.source,
    ].join(' ').toLowerCase();
    return haystack.includes(needle);
  });
}

function getOpenTabBaseItems() {
  return searchItems(state.realTabs, state.ui.query);
}

function getSavedTabBaseItems() {
  return searchItems(state.deferredActive, state.ui.query);
}

function getFirefoxBookmarkBaseItems() {
  return searchItems(filterBookmarks(state.allBookmarks, state.ui.bookmarkQuery), state.ui.query);
}

function getCurrentTabBaseItems() {
  if (state.ui.view === 'saved') return getSavedTabBaseItems();
  if (state.ui.view === 'firefox-bookmarks') return getFirefoxBookmarkBaseItems();
  return getOpenTabBaseItems();
}

function renderDashboard(reason) {
  renderStats(reason);
  renderTabOutDupeBanner();
  renderViewButtons();
  renderFilterButtons();
  renderGroups();
  renderOpenTabsPanel();
  renderSavedPanel();
  renderSavedGroupsPanel();
  renderBookmarksPanel();
  renderActiveView();
}

function renderStats(reason) {
  const groups = getRenderableGroups();
  const groupFilterBase = state.ui.view === 'saved-groups' ? state.savedGroups : groups;
  const firefoxCount = state.ui.view === 'saved-groups'
    ? groupFilterBase.filter(group => group.source === 'firefox').length
    : groupFilterBase.filter(group => group.type === 'firefox').length;
  const smartCount = state.ui.view === 'saved-groups'
    ? groupFilterBase.filter(group => group.source === 'smart').length
    : groupFilterBase.filter(group => group.type === 'smart').length;
  const duplicateGroups = state.ui.view === 'saved-groups'
    ? groupFilterBase.reduce((sum, group) => sum + getDuplicateExtras(group.tabs), 0)
    : groupFilterBase.reduce((sum, group) => sum + group.duplicates.duplicateExtras, 0);
  const duplicateTabItems = getDuplicateExtras(getCurrentTabBaseItems());

  $('statTabs').textContent = state.realTabs.length;
  $('statGroups').textContent = groups.length;
  $('statBookmarks').textContent = state.allBookmarks.length;
  $('countAll').textContent = groups.length;
  $('countFirefox').textContent = firefoxCount;
  $('countSmart').textContent = smartCount;
  $('countDuplicates').textContent = duplicateGroups;
  $('countOpenTabs').textContent = state.realTabs.length;
  $('countSaved').textContent = state.deferredActive.length;
  $('countSavedGroups').textContent = state.savedGroups.length;
  $('countFirefoxBookmarks').textContent = state.allBookmarks.length;
  $('countTabDuplicates').textContent = duplicateTabItems;
  $('lastRefresh').textContent = nowTime();

  const summary = $('groupsSummary');
  if (summary) {
    summary.textContent = `${groups.length} groups from ${state.realTabs.length} tabs. Last update: ${reason}.`;
  }
}

function renderFilterButtons() {
  document.querySelectorAll('[data-filter]').forEach(button => {
    const filter = button.dataset.filter;
    const active = filter === 'duplicates'
      ? state.ui.tabFilter === 'duplicates'
      : state.ui.groupFilter === filter;
    button.classList.toggle('active', active);
  });
  document.querySelectorAll('[data-tab-filter]').forEach(button => {
    button.classList.toggle('active', button.dataset.tabFilter === state.ui.listFilter);
  });
}

function renderViewButtons() {
  document.querySelectorAll('[data-view]').forEach(button => {
    button.classList.toggle('active', button.dataset.view === state.ui.view);
  });
}

function renderActiveView() {
  document.querySelectorAll('[data-view-panel]').forEach(panel => {
    panel.hidden = panel.dataset.viewPanel !== state.ui.view;
  });

  const groupFilters = $('groupFilterSection') || $('groupFilterRow');
  const isGroupView = state.ui.view === 'groups' || state.ui.view === 'saved-groups';
  const isTabView = ['open-tabs', 'saved', 'firefox-bookmarks'].includes(state.ui.view);
  if (groupFilters) groupFilters.hidden = !isGroupView;
  const tabFilters = $('tabFilterSection');
  if (tabFilters) tabFilters.hidden = !isGroupView;
  const listFilters = $('listFilterSection');
  if (listFilters) listFilters.hidden = !isTabView;
}

function renderTabOutDupeBanner() {
  const banner = $('tabOutDupeBanner');
  const count = $('tabOutDupeCount');
  if (!banner || !count) return;

  const tabOutTabs = state.allTabs.filter(tab => tab.isTabOut);
  if (tabOutTabs.length > 1) {
    count.textContent = tabOutTabs.length;
    banner.hidden = false;
  } else {
    banner.hidden = true;
  }
}

function renderGroups() {
  const groups = filterGroups();
  const list = $('groupsList');
  const empty = $('emptyGroups');
  if (!list || !empty) return;

  if (groups.length === 0) {
    clearElement(list);
    renderGroupsEmptyState(empty);
    empty.hidden = false;
    return;
  }

  empty.hidden = true;
  clearElement(list);
  for (const group of groups) {
    list.appendChild(renderGroupNode(group));
  }
}

function renderGroupsEmptyState(empty) {
  const title = empty.querySelector('strong');
  const detail = empty.querySelector('span');
  const filtersActive = state.ui.groupFilter !== 'all' || state.ui.tabFilter === 'duplicates' || !!state.ui.query;

  if (title) {
    title.textContent = filtersActive ? 'No groups match the current filters' : 'No open tab groups';
  }
  if (detail) {
    detail.textContent = filtersActive
      ? 'Clear the group filters or search to see other Firefox and Tab Out groups.'
      : 'Open Firefox groups or at least two related tabs for Tab Out groups to appear here.';
  }
}

function renderGroupNode(group) {
  const duplicateExtras = group.duplicates.duplicateExtras;
  const isExpanded = state.ui.expandedGroups[group.id] !== false;
  const typeLabel = group.type === 'firefox' ? 'Firefox' : smartKindLabel(group.kind);
  const card = createNode('article', `group-card${group.color ? ` group-color-${group.color}` : ''}`);
  card.dataset.groupId = group.id;

  const header = createNode('header', 'group-header');
  const collapse = createActionButton('toggle-group', isExpanded ? '-' : '+', 'collapse-btn', { groupId: group.id }, 'Collapse group');
  header.appendChild(collapse);

  const titleBlock = createNode('div', 'group-title-block');
  const titleRow = createNode('div', 'group-title-row');
  titleRow.appendChild(createNode('h3', '', group.label));
  titleRow.appendChild(createBadge(`type-badge ${group.type}`, typeLabel));
  if (group.collapsed) titleRow.appendChild(createBadge('meta-badge', 'collapsed in Firefox'));
  if (duplicateExtras) {
    titleRow.appendChild(createBadge('duplicate-badge', `${duplicateExtras} duplicate${duplicateExtras !== 1 ? 's' : ''}`));
  }

  const siteStrip = createNode('div', 'site-strip');
  for (const site of group.sites.slice(0, 5)) {
    siteStrip.appendChild(createBadge('', site));
  }
  if (group.sites.length > 5) {
    siteStrip.appendChild(createBadge('', `+${group.sites.length - 5}`));
  }
  titleBlock.appendChild(titleRow);
  titleBlock.appendChild(siteStrip);
  header.appendChild(titleBlock);

  const actions = createNode('div', 'group-actions');
  if (group.type === 'smart') {
    actions.appendChild(createActionButton('create-firefox-group', 'Create Firefox group', 'subtle-btn', { groupId: group.id }));
  }
  actions.appendChild(createActionButton('rename-group', 'Rename', 'subtle-btn', { groupId: group.id }));
  actions.appendChild(createActionButton('save-group', 'Save group', 'subtle-btn', { groupId: group.id }));
  actions.appendChild(createActionButton('save-close-group', 'Save + close', 'danger-btn', { groupId: group.id }));
  if (duplicateExtras) {
    actions.appendChild(createActionButton('close-duplicates', 'Close duplicates', 'subtle-btn', { groupId: group.id }));
  }
  actions.appendChild(createActionButton('close-group', `Close ${group.tabs.length}`, 'danger-btn', { groupId: group.id }));
  header.appendChild(actions);

  const tabList = createNode('div', 'tab-list');
  tabList.hidden = !isExpanded;
  for (const tab of group.tabs) {
    tabList.appendChild(renderTabRowNode(tab, group));
  }

  card.appendChild(header);
  card.appendChild(tabList);
  return card;
}

function smartKindLabel(kind) {
  if (kind === 'homepages') return 'Homepages';
  if (kind === 'local-dev') return 'Local/dev';
  if (kind === 'local-files') return 'Files';
  if (kind === 'custom') return 'Rule';
  return 'Domain';
}

function renderTabRowNode(tab, group) {
  const saved = savedStatusForUrl(tab.url);
  const bookmark = bookmarkStatusForUrl(tab.url);
  const duplicateKey = urlKey(tab.url);
  const count = group.duplicates.urlCounts[duplicateKey] || 1;
  const title = tabDisplayTitle(tab);
  const site = siteFromUrl(tab.url);
  const row = createNode('div', `tab-row ${tab.active ? 'active-tab' : ''}`);
  row.dataset.tabId = String(tab.id);

  const main = createActionButton('focus-tab', '', 'tab-main', { tabId: tab.id }, tab.url);
  main.appendChild(createNode('span', 'tab-title', title));
  main.appendChild(createNode('span', 'tab-url', site));
  row.appendChild(main);

  const badges = createNode('div', 'tab-badges');
  if (tab.pinned) badges.appendChild(createBadge('meta-badge', 'pinned'));
  if (tab.discarded) badges.appendChild(createBadge('meta-badge', 'discarded'));
  if (count > 1) badges.appendChild(createDuplicateBadge(count, duplicateKey));
  if (saved) badges.appendChild(createBadge('meta-badge', 'saved'));
  if (bookmark.bookmarked) badges.appendChild(createBadge('meta-badge', 'Firefox bookmark'));
  row.appendChild(badges);

  const actions = createNode('div', 'tab-actions');
  actions.appendChild(createActionButton('save-later', 'Save + close', 'subtle-btn compact-save-btn', { tabId: tab.id }, 'Save to Saved tabs and close'));
  actions.appendChild(createActionButton('focus-tab', 'Go', 'icon-only', { tabId: tab.id }, 'Focus tab'));
  actions.appendChild(createActionButton('close-tab', 'X', 'icon-only danger', { tabId: tab.id }, 'Close tab'));
  row.appendChild(actions);

  return row;
}

function renderOpenTabsPanel() {
  const baseTabs = getOpenTabBaseItems();
  const tabs = filterListItems(baseTabs);
  const counts = getUrlCounts(baseTabs);
  const list = $('openTabsList');
  const empty = $('openTabsEmpty');
  const count = $('openTabCount');
  if (!list || !empty || !count) return;

  count.textContent = tabs.length;
  clearElement(list);
  if (tabs.length === 0) {
    empty.textContent = state.ui.listFilter === 'duplicates' ? 'No duplicate open tabs.' : 'No open web tabs.';
    empty.hidden = false;
    return;
  }

  empty.hidden = true;
  for (const tab of tabs) {
    list.appendChild(renderOpenTabNode(tab, counts[urlKey(tab.url)] || 1));
  }
}

function renderOpenTabNode(tab, duplicateCount) {
  const row = createNode('div', `tab-row open-tab-row ${tab.active ? 'active-tab' : ''}`);
  row.dataset.tabId = String(tab.id);
  const saved = savedStatusForUrl(tab.url);
  const bookmark = bookmarkStatusForUrl(tab.url);
  const groupLabel = getGroupLabelForTab(tab);
  const duplicateKey = urlKey(tab.url);

  const main = createActionButton('focus-tab', '', 'tab-main', { tabId: tab.id }, tab.url);
  main.appendChild(createNode('span', 'tab-title', tabDisplayTitle(tab)));
  main.appendChild(createNode('span', 'tab-url', siteFromUrl(tab.url)));
  row.appendChild(main);

  const badges = createNode('div', 'tab-badges');
  if (tab.pinned) badges.appendChild(createBadge('meta-badge', 'pinned'));
  if (tab.discarded) badges.appendChild(createBadge('meta-badge', 'discarded'));
  if (duplicateCount > 1) badges.appendChild(createDuplicateBadge(duplicateCount, duplicateKey));
  if (groupLabel) badges.appendChild(createBadge('meta-badge', groupLabel));
  if (saved) badges.appendChild(createBadge('meta-badge', 'saved'));
  if (bookmark.bookmarked) badges.appendChild(createBadge('meta-badge', 'Firefox bookmark'));
  row.appendChild(badges);

  const actions = createNode('div', 'tab-actions');
  actions.appendChild(createActionButton('save-later', 'Save + close', 'subtle-btn compact-save-btn', { tabId: tab.id }, 'Save to Saved tabs and close'));
  actions.appendChild(createActionButton('focus-tab', 'Go', 'icon-only', { tabId: tab.id }, 'Focus tab'));
  actions.appendChild(createActionButton('close-tab', 'X', 'icon-only danger', { tabId: tab.id }, 'Close tab'));
  row.appendChild(actions);
  return row;
}

function renderSavedPanel() {
  const baseActive = getSavedTabBaseItems();
  const active = filterListItems(baseActive);
  const activeCounts = getUrlCounts(baseActive);
  const archived = state.deferredArchived;
  const list = $('deferredList');
  const empty = $('deferredEmpty');
  const count = $('deferredCount');
  const archiveCount = $('archiveCount');
  const archiveBody = $('archiveBody');
  const archiveList = $('archiveList');
  const clearArchiveButton = $('clearArchiveButton');

  count.textContent = active.length;
  archiveCount.textContent = archived.length ? `(${archived.length})` : '';
  if (clearArchiveButton) clearArchiveButton.disabled = archived.length === 0;

  if (active.length === 0) {
    clearElement(list);
    empty.textContent = state.ui.listFilter === 'duplicates' ? 'No duplicate saved tabs.' : 'Nothing saved.';
    empty.hidden = false;
  } else {
    empty.hidden = true;
    clearElement(list);
    for (const item of active) {
      list.appendChild(renderSavedItemNode(item, activeCounts[urlKey(item.url)] || 1));
    }
  }

  archiveBody.hidden = !state.ui.archiveOpen;
  const query = (state.ui.archiveQuery || '').toLowerCase();
  const archiveItems = query
    ? archived.filter(item => `${item.title || ''} ${item.url || ''}`.toLowerCase().includes(query))
    : archived;
  clearElement(archiveList);
  if (archiveItems.length === 0) {
    archiveList.appendChild(createNode('div', 'empty-inline', 'No archived results.'));
  } else {
    for (const item of archiveItems) {
      archiveList.appendChild(renderArchiveItemNode(item));
    }
  }
}

function renderSavedGroupsPanel() {
  const list = $('savedGroupList');
  const empty = $('savedGroupEmpty');
  const count = $('savedGroupCount');
  if (!list || !empty || !count) return;
  const groups = filterSavedGroupsForDisplay();

  count.textContent = groups.length;
  clearElement(list);

  if (groups.length === 0) {
    empty.textContent = state.ui.tabFilter === 'duplicates' ? 'No saved groups with duplicate tabs.' : 'No saved groups yet.';
    empty.hidden = false;
    return;
  }

  empty.hidden = true;
  for (const snapshot of groups) {
    list.appendChild(renderSavedGroupNode(snapshot));
  }
}

function renderSavedGroupNode(snapshot) {
  const row = createNode('div', 'saved-group-row');
  row.dataset.snapshotId = snapshot.id;
  const isExpanded = state.ui.expandedSavedGroups[snapshot.id] === true;

  const summary = createNode('div', 'saved-group-summary');
  summary.appendChild(createActionButton('toggle-saved-group', isExpanded ? '-' : '+', 'collapse-btn', { snapshotId: snapshot.id }, 'Show saved group tabs'));

  const main = createNode('div', 'saved-group-main');
  main.appendChild(createNode('span', '', snapshot.title));
  const sites = snapshot.sites && snapshot.sites.length
    ? ` - ${snapshot.sites.slice(0, 3).join(', ')}${snapshot.sites.length > 3 ? ` +${snapshot.sites.length - 3}` : ''}`
    : '';
  main.appendChild(createNode('small', '', `${snapshot.tabs.length} tab${snapshot.tabs.length !== 1 ? 's' : ''} - ${timeAgo(snapshot.createdAt)}${sites}`));
  summary.appendChild(main);

  const actions = createNode('div', 'saved-group-actions');
  actions.appendChild(createActionButton('restore-saved-group', 'Restore', 'subtle-btn', { snapshotId: snapshot.id }));
  actions.appendChild(createActionButton('delete-saved-group', 'X', 'icon-only danger', { snapshotId: snapshot.id }, 'Delete saved group'));
  summary.appendChild(actions);
  row.appendChild(summary);

  if (isExpanded) {
    const tabs = createNode('div', 'saved-group-tabs');
    for (const tab of snapshot.tabs) {
      const item = createNode('div', 'saved-group-tab');
      const link = createNode('a', '', tab.title || tab.url);
      link.href = safeHref(tab.url);
      link.target = '_blank';
      link.rel = 'noopener';
      link.title = tab.url || '';
      item.appendChild(link);
      item.appendChild(createNode('span', '', tab.site || siteFromUrl(tab.url)));
      tabs.appendChild(item);
    }
    row.appendChild(tabs);
  }
  return row;
}

function renderSavedItemNode(item, duplicateCount = 1) {
  const row = createNode('div', 'saved-row');
  row.dataset.deferredId = item.id;
  row.appendChild(createActionButton('check-deferred', '', 'check-btn', { deferredId: item.id }, 'Mark done'));

  const link = createNode('a', '', item.title || item.url);
  link.href = safeHref(item.url);
  link.target = '_blank';
  link.rel = 'noopener';
  link.title = item.url || '';
  row.appendChild(link);

  if (duplicateCount > 1) row.appendChild(createDuplicateBadge(duplicateCount, urlKey(item.url)));
  row.appendChild(createActionButton('dismiss-deferred', 'X', 'icon-only danger', { deferredId: item.id }, 'Dismiss'));
  return row;
}

function renderArchiveItemNode(item) {
  const ago = item.completedAt ? timeAgo(item.completedAt) : timeAgo(item.savedAt);
  const row = createNode('div', 'archive-row');
  const link = createNode('a', '', item.title || item.url);
  link.href = safeHref(item.url);
  link.target = '_blank';
  link.rel = 'noopener';
  link.title = item.url || '';
  row.appendChild(link);
  row.appendChild(createNode('span', '', ago));
  return row;
}

function renderBookmarksPanel() {
  const list = $('bookmarkList');
  const empty = $('bookmarkEmpty');
  const count = $('bookmarkCount');
  const search = $('bookmarkSearch');
  const migrateButton = $('migrateBookmarksButton');
  const baseBookmarks = getFirefoxBookmarkBaseItems();
  const bookmarks = filterListItems(baseBookmarks);
  const bookmarkCounts = getUrlCounts(baseBookmarks);
  const migrationCandidates = baseBookmarks.filter(bookmark =>
    isUserFacingTabUrl(bookmark.url) &&
    !savedStatusForUrl(bookmark.url)
  );

  if (search) search.placeholder = 'Search Firefox bookmarks';
  if (migrateButton) {
    migrateButton.disabled = migrationCandidates.length === 0;
    migrateButton.textContent = migrationCandidates.length
      ? `Copy ${migrationCandidates.length} Firefox result${migrationCandidates.length !== 1 ? 's' : ''} to Saved tabs`
      : 'No Firefox results to copy';
  }

  count.textContent = bookmarks.length;
  if (bookmarks.length === 0) {
    clearElement(list);
    empty.textContent = state.ui.listFilter === 'duplicates' ? 'No duplicate Firefox bookmarks.' : 'No Firefox bookmarks found.';
    empty.hidden = false;
    return;
  }

  empty.hidden = true;
  clearElement(list);
  for (const bookmark of bookmarks) {
    list.appendChild(renderBookmarkNode(bookmark, bookmarkCounts[urlKey(bookmark.url)] || 1));
  }
}

function renderBookmarkNode(bookmark, duplicateCount = 1) {
  const row = createNode('div', 'bookmark-row');
  row.dataset.bookmarkId = bookmark.id;
  const saved = savedStatusForUrl(bookmark.url);

  const main = createActionButton('open-bookmark', '', 'bookmark-main', { url: bookmark.url }, bookmark.url);
  main.appendChild(createNode('span', '', bookmark.title || bookmark.url));
  const folderPath = bookmark.folderPath ? ` - ${bookmark.folderPath}` : '';
  main.appendChild(createNode('small', '', `${siteFromUrl(bookmark.url)}${folderPath}`));
  row.appendChild(main);

  const actions = createNode('div', 'bookmark-actions');
  if (duplicateCount > 1) actions.appendChild(createDuplicateBadge(duplicateCount, urlKey(bookmark.url)));
  const copyButton = createActionButton('copy-bookmark-to-saved', saved ? 'Saved' : 'Save', 'subtle-btn', { bookmarkId: bookmark.id }, saved ? 'Already in Saved tabs' : 'Copy to Saved tabs');
  copyButton.disabled = !!saved;
  actions.appendChild(copyButton);
  actions.appendChild(createActionButton('delete-firefox-bookmark', 'Delete', 'danger-btn', { bookmarkId: bookmark.id }, 'Delete Firefox bookmark'));
  row.appendChild(actions);
  return row;
}

async function handleClick(event) {
  const actionEl = event.target.closest('[data-action]');
  if (!actionEl) return;

  const action = actionEl.dataset.action;
  const tabId = Number(actionEl.dataset.tabId);
  const groupId = actionEl.dataset.groupId;

  try {
    if (action === 'manual-refresh') {
      await refreshDashboard('manual');
      showToast('Refreshed');
      return;
    }

    if (action === 'set-view') {
      const previousView = state.ui.view;
      state.ui.view = normalizeView(actionEl.dataset.view);
      history.replaceState(null, '', `#view=${state.ui.view}`);
      await persistUiState();
      devLog('ui.view.change', { from: previousView, to: state.ui.view });
      renderDashboard('view');
      return;
    }

    if (action === 'set-filter') {
      const filter = actionEl.dataset.filter || '';
      if (filter === 'duplicates') {
        state.ui.tabFilter = state.ui.tabFilter === 'duplicates' ? '' : 'duplicates';
      } else if (filter === 'firefox' || filter === 'smart') {
        state.ui.groupFilter = state.ui.groupFilter === filter ? 'all' : filter;
      }
      await persistUiState();
      devLog('ui.group-filter.change', {
        requested: filter,
        groupFilter: state.ui.groupFilter,
        tabFilter: state.ui.tabFilter,
      });
      renderDashboard('filter');
      return;
    }

    if (action === 'set-tab-filter') {
      const filter = actionEl.dataset.tabFilter || '';
      state.ui.listFilter = state.ui.listFilter === filter ? '' : filter;
      await persistUiState();
      devLog('ui.tab-filter.change', { requested: filter, listFilter: state.ui.listFilter });
      renderDashboard('tab-filter');
      return;
    }

    if (action === 'toggle-group') {
      state.ui.expandedGroups[groupId] = state.ui.expandedGroups[groupId] === false;
      await persistUiState();
      renderGroups();
      return;
    }

    if (action === 'toggle-saved-group') {
      const snapshotId = actionEl.dataset.snapshotId;
      state.ui.expandedSavedGroups[snapshotId] = state.ui.expandedSavedGroups[snapshotId] !== true;
      await persistUiState();
      renderSavedGroupsPanel();
      return;
    }

    if (action === 'focus-tab') {
      await focusTab(tabId);
      return;
    }

    if (action === 'close-tab') {
      await closeTabsByIds([tabId]);
      showToast('Tab closed');
      scheduleRefresh('action.close-tab');
      return;
    }

    if (action === 'save-later') {
      const tab = getTabById(tabId);
      if (!tab) return;
      await saveTabForLater(tab);
      await closeTabsByIds([tabId]);
      showToast('Saved for later');
      scheduleRefresh('action.save-later');
      return;
    }

    if (action === 'close-group') {
      const group = state.groups.find(item => item.id === groupId);
      if (!group) return;
      try {
        await closeGroup(group);
      } finally {
        scheduleRefresh('action.close-group');
      }
      return;
    }

    if (action === 'create-firefox-group') {
      try {
        await createFirefoxGroup(groupId);
      } finally {
        scheduleRefresh('action.create-firefox-group');
      }
      return;
    }

    if (action === 'rename-group') {
      try {
        await renameGroup(groupId);
      } finally {
        scheduleRefresh('action.rename-group');
      }
      return;
    }

    if (action === 'save-group') {
      await saveGroupSnapshot(groupId);
      renderSavedGroupsPanel();
      return;
    }

    if (action === 'save-close-group') {
      try {
        await saveGroupSnapshot(groupId, { closeAfter: true });
      } finally {
        scheduleRefresh('action.save-close-group');
      }
      return;
    }

    if (action === 'close-duplicates') {
      try {
        await closeDuplicates(groupId);
      } finally {
        scheduleRefresh('action.close-duplicates');
      }
      return;
    }

    if (action === 'close-all-open-tabs') {
      await closeTabsByIds(state.realTabs.map(tab => tab.id));
      showToast('All web tabs closed');
      scheduleRefresh('action.close-all-open-tabs');
      return;
    }

    if (action === 'close-tabout-dupes') {
      await closeTabOutDupes();
      showToast('Closed extra Tab Out tabs');
      scheduleRefresh('action.close-tabout-dupes');
      return;
    }

    if (action === 'check-deferred') {
      await updateSavedTab(actionEl.dataset.deferredId, {
        completed: true,
        completedAt: new Date().toISOString(),
      });
      scheduleRefresh('action.check-deferred');
      return;
    }

    if (action === 'dismiss-deferred') {
      await updateSavedTab(actionEl.dataset.deferredId, { dismissed: true });
      scheduleRefresh('action.dismiss-deferred');
      return;
    }

    if (action === 'toggle-archive') {
      state.ui.archiveOpen = !state.ui.archiveOpen;
      await persistUiState();
      renderSavedPanel();
      return;
    }

    if (action === 'clear-archive') {
      await clearArchive();
      scheduleRefresh('action.clear-archive');
      return;
    }

    if (action === 'restore-saved-group') {
      await restoreSavedGroup(actionEl.dataset.snapshotId);
      scheduleRefresh('action.restore-saved-group');
      return;
    }

    if (action === 'delete-saved-group') {
      await deleteSavedGroup(actionEl.dataset.snapshotId);
      renderSavedGroupsPanel();
      return;
    }

    if (action === 'open-bookmark') {
      const url = actionEl.dataset.url;
      if (isUserFacingTabUrl(url)) await browser.tabs.create({ url });
      devLog('bookmark.open', { url });
      return;
    }

    if (action === 'copy-bookmark-to-saved') {
      const bookmarkId = actionEl.dataset.bookmarkId;
      const bookmark = state.allBookmarks.find(item => item.id === bookmarkId);
      if (!bookmark) return;
      await saveItemToDeferred({
        title: bookmark.title || bookmark.url,
        url: bookmark.url,
        source: 'firefox-bookmark',
      }, 'saved.copy-bookmark');
      showToast('Copied to Saved tabs');
      scheduleRefresh('action.copy-bookmark');
      return;
    }

    if (action === 'delete-firefox-bookmark') {
      const deleted = await deleteFirefoxBookmark(actionEl.dataset.bookmarkId);
      if (deleted) scheduleRefresh('action.delete-firefox-bookmark');
      return;
    }

    if (action === 'migrate-bookmarks') {
      await migrateVisibleBookmarksToTabOut();
      scheduleRefresh('action.migrate-bookmarks');
      return;
    }

    if (action === 'export-data') {
      await exportTabOutData();
      return;
    }

    if (action === 'choose-import-data') {
      const input = $('dataImportFile');
      if (input) input.click();
      return;
    }
  } catch (error) {
    console.error('[tab-out] action failed', action, error);
    devLog('action.failed', { action, message: error.message });
    showToast('Action failed');
  }
}

function handleInput(event) {
  const target = event.target;
  if (target.id === 'globalSearch') {
    state.ui.query = target.value;
    persistUiState();
    renderDashboard('search');
  }
  if (target.id === 'bookmarkSearch') {
    state.ui.bookmarkQuery = target.value;
    persistUiState();
    renderDashboard('bookmark-search');
  }
  if (target.id === 'archiveSearch') {
    state.ui.archiveQuery = target.value;
    persistUiState();
    renderSavedPanel();
  }
}

function handleChange(event) {
  const target = event.target;
  if (target.id === 'dataImportFile') {
    const [file] = target.files || [];
    importTabOutData(file)
      .catch(error => {
        console.error('[tab-out] import failed', error);
        devLog('data.import.failed', { message: error.message });
        showToast('Import failed');
      })
      .finally(() => {
        target.value = '';
      });
  }
}

function registerLiveRefreshListeners() {
  const tabsEvents = [
    ['tabs.created', browser.tabs.onCreated],
    ['tabs.removed', browser.tabs.onRemoved],
    ['tabs.updated', browser.tabs.onUpdated],
    ['tabs.moved', browser.tabs.onMoved],
    ['tabs.attached', browser.tabs.onAttached],
    ['tabs.detached', browser.tabs.onDetached],
    ['tabs.activated', browser.tabs.onActivated],
  ];

  for (const [reason, eventTarget] of tabsEvents) {
    if (!eventTarget || !eventTarget.addListener) continue;
    eventTarget.addListener(() => scheduleRefresh(reason));
  }

  if (browser.tabGroups) {
    const tabGroupEvents = [
      ['tabGroups.created', browser.tabGroups.onCreated],
      ['tabGroups.moved', browser.tabGroups.onMoved],
      ['tabGroups.removed', browser.tabGroups.onRemoved],
      ['tabGroups.updated', browser.tabGroups.onUpdated],
    ];
    for (const [reason, eventTarget] of tabGroupEvents) {
      if (!eventTarget || !eventTarget.addListener) continue;
      eventTarget.addListener(() => scheduleRefresh(reason));
    }
  }

  if (browser.bookmarks) {
    const bookmarkEvents = [
      ['bookmarks.created', browser.bookmarks.onCreated],
      ['bookmarks.removed', browser.bookmarks.onRemoved],
      ['bookmarks.changed', browser.bookmarks.onChanged],
      ['bookmarks.moved', browser.bookmarks.onMoved],
    ];
    for (const [reason, eventTarget] of bookmarkEvents) {
      if (!eventTarget || !eventTarget.addListener) continue;
      eventTarget.addListener(() => scheduleRefresh(reason));
    }
  }

  browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local') return;
    const keys = Object.keys(changes);
    if (keys.every(key => key === DEV_LOG_KEY || key === UI_STATE_KEY)) return;
    scheduleRefresh('storage.changed');
  });

  browser.runtime.onMessage.addListener(message => {
    if (message && message.type === 'tab-out:refresh') {
      scheduleRefresh(message.reason || 'runtime.message');
    }
  });
}

async function loadLocalConfig() {
  const configUrl = browser.runtime.getURL('config.local.js');

  try {
    const response = await fetch(configUrl, { cache: 'no-store' });
    if (!response.ok) return;
  } catch {
    return;
  }

  await new Promise(resolve => {
    const script = document.createElement('script');
    script.src = configUrl;
    script.onload = resolve;
    script.onerror = resolve;
    document.head.appendChild(script);
  });
}

async function init() {
  document.addEventListener('click', handleClick);
  document.addEventListener('input', handleInput);
  document.addEventListener('change', handleChange);
  window.addEventListener('hashchange', () => {
    state.ui.view = normalizeView(new URLSearchParams(location.hash.slice(1)).get('view'));
    persistUiState();
    renderDashboard('hash');
  });
  await loadLocalConfig();
  await loadUiState();
  registerLiveRefreshListeners();
  await refreshDashboard('initial');
}

init().catch(error => {
  console.error('[tab-out] init failed', error);
  devLog('init.failed', { message: error.message });
  showToast('Tab Out failed to start');
});
