/* Tab Out - Firefox dashboard app */

'use strict';

const {
  TAB_GROUP_NONE,
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
  sanitizeImportPayload,
} = globalThis.TabOutData;

const BOOKMARK_FOLDER_TITLE = 'Tab Out';
const BOOKMARK_FOLDER_KEY = 'tabOutBookmarkFolderId';
const DEFERRED_KEY = 'deferred';
const SAVED_GROUPS_KEY = 'tabOutSavedGroups';
const GROUP_ALIASES_KEY = 'tabOutGroupAliases';
const UI_STATE_KEY = 'tabOutUiState';
const DEV_LOG_KEY = '__tabOutDevLogs';
const DEV_LOG_LIMIT = 300;

const ICONS = {
  star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.76 5.59 6.17.9-4.47 4.35 1.06 6.14L12 17.08l-5.52 2.9 1.06-6.14-4.47-4.35 6.17-.9L12 3Z"/></svg>',
  bookmark: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 4.75A2.75 2.75 0 0 1 8.75 2h6.5A2.75 2.75 0 0 1 18 4.75V21l-6-3.4L6 21V4.75Z"/></svg>',
  close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>',
  focus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 19 14-14M9 5h10v10"/></svg>',
  group: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11A2.5 2.5 0 0 1 20 7.5v9a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5v-9Zm3-5h10"/></svg>',
};

const state = {
  allTabs: [],
  realTabs: [],
  firefoxGroups: [],
  groups: [],
  deferredActive: [],
  deferredArchived: [],
  bookmarkIndex: new Map(),
  allBookmarks: [],
  tabOutBookmarks: [],
  tabOutBookmarkFolderId: null,
  savedGroups: [],
  groupAliases: {},
  ui: {
    view: 'groups',
    filter: 'all',
    query: '',
    bookmarkQuery: '',
    bookmarkMode: 'tabout',
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

function normalizeView(value) {
  return ['groups', 'saved', 'saved-groups', 'favorites', 'data'].includes(value)
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
  if (!['tabout', 'all'].includes(state.ui.bookmarkMode)) {
    state.ui.bookmarkMode = 'tabout';
  }
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
      if (folder && !folder.url) {
        state.tabOutBookmarkFolderId = folder.id;
        return folder.id;
      }
    } catch {
      // Folder was probably deleted. Recreate below.
    }
  }

  const tree = await browser.bookmarks.getTree();
  const folders = flattenBookmarks(tree).filter(node => !node.url && node.title === BOOKMARK_FOLDER_TITLE);
  const existing = folders.find(node => node.id !== 'root________') || folders[0];
  if (existing) {
    state.tabOutBookmarkFolderId = existing.id;
    await browser.storage.local.set({ [BOOKMARK_FOLDER_KEY]: existing.id });
    return existing.id;
  }

  const parent = await findWritableBookmarkParent();
  if (!parent) throw new Error('No writable bookmark parent found');

  const created = await browser.bookmarks.create({
    parentId: parent.id,
    title: BOOKMARK_FOLDER_TITLE,
  });
  state.tabOutBookmarkFolderId = created.id;
  await browser.storage.local.set({ [BOOKMARK_FOLDER_KEY]: created.id });
  return created.id;
}

async function fetchBookmarks() {
  if (!browser.bookmarks) return;

  const folderId = await ensureBookmarkFolder();
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

  try {
    state.tabOutBookmarks = (await browser.bookmarks.getChildren(folderId))
      .filter(node => node.url)
      .map(node => ({
        ...node,
        folderPath: BOOKMARK_FOLDER_TITLE,
      }))
      .sort((a, b) => (b.dateAdded || 0) - (a.dateAdded || 0));
  } catch {
    state.tabOutBookmarks = [];
  }
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
  const { [DEFERRED_KEY]: deferred = [] } = await browser.storage.local.get(DEFERRED_KEY);
  const next = Array.isArray(deferred) ? [...deferred] : [];
  const saved = {
    id: Date.now().toString(),
    url: tab.url,
    title: tab.title || tab.url,
    savedAt: new Date().toISOString(),
    completed: false,
    dismissed: false,
  };
  next.push(saved);
  await persistDeferred(next, 'saved.add');
  devLog('saved.add', { id: saved.id, url: tab.url });
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
  const tabOutBookmark = bookmarks.find(node => node.parentId === state.tabOutBookmarkFolderId);
  return {
    bookmarked: bookmarks.length > 0,
    external: bookmarks.some(node => node.parentId !== state.tabOutBookmarkFolderId),
    tabOutBookmark,
  };
}

async function toggleBookmarkForTab(tab) {
  const status = bookmarkStatusForUrl(tab.url);

  if (status.tabOutBookmark) {
    await browser.bookmarks.remove(status.tabOutBookmark.id);
    devLog('bookmark.remove-tabout', { url: tab.url });
    showToast('Removed from Tab Out favorites');
    return;
  }

  const folderId = await ensureBookmarkFolder();
  await browser.bookmarks.create({
    parentId: folderId,
    title: tab.title || tab.url,
    url: tab.url,
  });
  devLog('bookmark.create-tabout', { url: tab.url, externalAlreadyExists: status.external });
  showToast(status.external ? 'Saved a Tab Out copy of this favorite' : 'Saved to favorites');
}

async function migrateVisibleBookmarksToTabOut() {
  const queryResults = filterBookmarks(state.allBookmarks, state.ui.bookmarkQuery);
  const candidates = queryResults.filter(bookmark =>
    bookmark.parentId !== state.tabOutBookmarkFolderId &&
    isUserFacingTabUrl(bookmark.url) &&
    !bookmarkStatusForUrl(bookmark.url).tabOutBookmark
  );

  if (candidates.length === 0) {
    showToast('No Firefox bookmarks to copy');
    return;
  }

  const confirmed = window.confirm(`Copy ${candidates.length} Firefox bookmark${candidates.length !== 1 ? 's' : ''} to Tab Out favorites? Existing browser bookmarks will stay unchanged.`);
  if (!confirmed) return;

  const folderId = await ensureBookmarkFolder();
  for (const bookmark of candidates) {
    await browser.bookmarks.create({
      parentId: folderId,
      title: bookmark.title || bookmark.url,
      url: bookmark.url,
    });
  }
  devLog('bookmark.migrate-to-tabout', { count: candidates.length });
  showToast(`Copied ${candidates.length} bookmark${candidates.length !== 1 ? 's' : ''} to Tab Out`);
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
    await closeTabsByIds(group.tabs.map(tab => tab.id));
    showToast(`Saved and closed ${snapshot.tabs.length} tabs`);
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
  for (const url of group.duplicates.duplicateUrls) {
    const matching = group.tabs.filter(tab => tab.url === url);
    const keep = matching.find(tab => tab.active) || matching[0];
    for (const tab of matching) {
      if (tab.id !== keep.id) toClose.push(tab.id);
    }
  }

  await closeTabsByIds(toClose);
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
  devLog('groups.build', {
    groups: state.groups.length,
    firefox: state.groups.filter(group => group.type === 'firefox').length,
    smart: state.groups.filter(group => group.type === 'smart').length,
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
  let groups = [...state.groups];

  if (state.ui.filter === 'firefox') groups = groups.filter(group => group.type === 'firefox');
  if (state.ui.filter === 'smart') groups = groups.filter(group => group.type === 'smart');
  if (state.ui.filter === 'duplicates') groups = groups.filter(group => group.duplicates.duplicateExtras > 0);
  if (state.ui.filter === 'bookmarked') {
    groups = groups
      .map(group => ({
        ...group,
        tabs: group.tabs.filter(tab => bookmarkStatusForUrl(tab.url).bookmarked),
      }))
      .filter(group => group.tabs.length > 0);
  }

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

function renderDashboard(reason) {
  renderStats(reason);
  renderTabOutDupeBanner();
  renderViewButtons();
  renderFilterButtons();
  renderGroups();
  renderSavedPanel();
  renderSavedGroupsPanel();
  renderBookmarksPanel();
  renderActiveView();
}

function renderStats(reason) {
  const groups = state.groups;
  const firefoxCount = groups.filter(group => group.type === 'firefox').length;
  const smartCount = groups.filter(group => group.type === 'smart').length;
  const duplicateGroups = groups.filter(group => group.duplicates.duplicateExtras > 0).length;
  const favoritedOpenTabs = state.realTabs.filter(tab => bookmarkStatusForUrl(tab.url).bookmarked).length;

  $('statTabs').textContent = state.realTabs.length;
  $('statGroups').textContent = groups.length;
  $('statBookmarks').textContent = state.allBookmarks.length;
  $('countAll').textContent = groups.length;
  $('countAllFilter').textContent = groups.length;
  $('countFirefox').textContent = firefoxCount;
  $('countSmart').textContent = smartCount;
  $('countDuplicates').textContent = duplicateGroups;
  $('countBookmarked').textContent = favoritedOpenTabs;
  $('countSaved').textContent = state.deferredActive.length;
  $('countSavedGroups').textContent = state.savedGroups.length;
  $('countFavorites').textContent = state.allBookmarks.length;
  $('lastRefresh').textContent = nowTime();

  const summary = $('groupsSummary');
  if (summary) {
    summary.textContent = `${groups.length} groups from ${state.realTabs.length} tabs. Last update: ${reason}.`;
  }
}

function renderFilterButtons() {
  document.querySelectorAll('.filter-btn').forEach(button => {
    button.classList.toggle('active', button.dataset.filter === state.ui.filter);
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
  if (groupFilters) groupFilters.hidden = state.ui.view !== 'groups';
  const tabFilters = $('tabFilterSection');
  if (tabFilters) tabFilters.hidden = state.ui.view !== 'groups';
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
    empty.hidden = false;
    return;
  }

  empty.hidden = true;
  clearElement(list);
  for (const group of groups) {
    list.appendChild(renderGroupNode(group));
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
  const bookmark = bookmarkStatusForUrl(tab.url);
  const count = group.duplicates.urlCounts[urlKey(tab.url)] || 1;
  const title = tabDisplayTitle(tab);
  const site = siteFromUrl(tab.url);
  const bookmarkTitle = bookmark.tabOutBookmark
    ? 'Remove from Tab Out favorites'
    : bookmark.external
      ? 'Also save in Tab Out favorites'
      : 'Save to favorites';
  const row = createNode('div', `tab-row ${tab.active ? 'active-tab' : ''}`);
  row.dataset.tabId = String(tab.id);

  const main = createActionButton('focus-tab', '', 'tab-main', { tabId: tab.id }, tab.url);
  main.appendChild(createNode('span', 'tab-title', title));
  main.appendChild(createNode('span', 'tab-url', site));
  row.appendChild(main);

  const badges = createNode('div', 'tab-badges');
  if (tab.pinned) badges.appendChild(createBadge('meta-badge', 'pinned'));
  if (tab.discarded) badges.appendChild(createBadge('meta-badge', 'discarded'));
  if (count > 1) badges.appendChild(createBadge('duplicate-badge', `${count}x`));
  if (bookmark.external && !bookmark.tabOutBookmark) badges.appendChild(createBadge('meta-badge', 'external fav'));
  row.appendChild(badges);

  const actions = createNode('div', 'tab-actions');
  actions.appendChild(createActionButton('toggle-bookmark', 'Star', `icon-only ${bookmark.bookmarked ? 'is-bookmarked' : ''}`, { tabId: tab.id }, bookmarkTitle));
  actions.appendChild(createActionButton('save-later', 'Save', 'icon-only', { tabId: tab.id }, 'Save for later and close'));
  actions.appendChild(createActionButton('focus-tab', 'Go', 'icon-only', { tabId: tab.id }, 'Focus tab'));
  actions.appendChild(createActionButton('close-tab', 'X', 'icon-only danger', { tabId: tab.id }, 'Close tab'));
  row.appendChild(actions);

  return row;
}

function renderSavedPanel() {
  const active = state.deferredActive;
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
    empty.hidden = false;
  } else {
    empty.hidden = true;
    clearElement(list);
    for (const item of active) {
      list.appendChild(renderSavedItemNode(item));
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

  count.textContent = state.savedGroups.length;
  clearElement(list);

  if (state.savedGroups.length === 0) {
    empty.hidden = false;
    return;
  }

  empty.hidden = true;
  for (const snapshot of state.savedGroups) {
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

function renderSavedItemNode(item) {
  const row = createNode('div', 'saved-row');
  row.dataset.deferredId = item.id;
  row.appendChild(createActionButton('check-deferred', '', 'check-btn', { deferredId: item.id }, 'Mark done'));

  const link = createNode('a', '', item.title || item.url);
  link.href = safeHref(item.url);
  link.target = '_blank';
  link.rel = 'noopener';
  link.title = item.url || '';
  row.appendChild(link);

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
  const mode = state.ui.bookmarkMode === 'all' ? 'all' : 'tabout';
  const source = mode === 'all' ? state.allBookmarks : state.tabOutBookmarks;
  const bookmarks = filterBookmarks(source, state.ui.bookmarkQuery);
  const migrationCandidates = mode === 'all'
    ? bookmarks.filter(bookmark =>
      bookmark.parentId !== state.tabOutBookmarkFolderId &&
      isUserFacingTabUrl(bookmark.url) &&
      !bookmarkStatusForUrl(bookmark.url).tabOutBookmark
    )
    : [];

  document.querySelectorAll('[data-bookmark-mode]').forEach(button => {
    button.classList.toggle('active', button.dataset.bookmarkMode === mode);
  });
  if (search) {
    search.placeholder = mode === 'all' ? 'Search Firefox bookmarks' : 'Search Tab Out favorites';
  }
  if (migrateButton) {
    migrateButton.hidden = mode !== 'all';
    migrateButton.disabled = migrationCandidates.length === 0;
    migrateButton.textContent = migrationCandidates.length
      ? `Copy ${migrationCandidates.length} Firefox result${migrationCandidates.length !== 1 ? 's' : ''} to Tab Out`
      : 'No Firefox results to copy';
  }

  count.textContent = source.length;
  if (bookmarks.length === 0) {
    clearElement(list);
    empty.textContent = mode === 'all' ? 'No Firefox bookmarks found.' : 'No Tab Out favorites yet.';
    empty.hidden = false;
    return;
  }

  empty.hidden = true;
  clearElement(list);
  for (const bookmark of bookmarks) {
    list.appendChild(renderBookmarkNode(bookmark, { removable: mode === 'tabout' }));
  }
}

function renderBookmarkNode(bookmark, options = {}) {
  const row = createNode('div', 'bookmark-row');
  row.dataset.bookmarkId = bookmark.id;

  const main = createActionButton('open-bookmark', '', 'bookmark-main', { url: bookmark.url }, bookmark.url);
  main.appendChild(createNode('span', '', bookmark.title || bookmark.url));
  const folderPath = bookmark.folderPath ? ` - ${bookmark.folderPath}` : '';
  main.appendChild(createNode('small', '', `${siteFromUrl(bookmark.url)}${folderPath}`));
  row.appendChild(main);
  if (options.removable) {
    row.appendChild(createActionButton('remove-tabout-bookmark', 'X', 'icon-only danger', { bookmarkId: bookmark.id }, 'Remove Tab Out favorite'));
  }
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
      state.ui.view = normalizeView(actionEl.dataset.view);
      history.replaceState(null, '', `#view=${state.ui.view}`);
      await persistUiState();
      renderDashboard('view');
      return;
    }

    if (action === 'set-filter') {
      state.ui.filter = actionEl.dataset.filter || 'all';
      await persistUiState();
      renderDashboard('filter');
      return;
    }

    if (action === 'set-bookmark-mode') {
      state.ui.bookmarkMode = actionEl.dataset.bookmarkMode === 'all' ? 'all' : 'tabout';
      await persistUiState();
      renderBookmarksPanel();
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

    if (action === 'toggle-bookmark') {
      const tab = getTabById(tabId);
      if (!tab) return;
      await toggleBookmarkForTab(tab);
      scheduleRefresh('action.toggle-bookmark');
      return;
    }

    if (action === 'close-group') {
      const group = state.groups.find(item => item.id === groupId);
      if (!group) return;
      await closeTabsByIds(group.tabs.map(tab => tab.id));
      showToast(`Closed ${group.tabs.length} tabs`);
      scheduleRefresh('action.close-group');
      return;
    }

    if (action === 'create-firefox-group') {
      await createFirefoxGroup(groupId);
      scheduleRefresh('action.create-firefox-group');
      return;
    }

    if (action === 'rename-group') {
      await renameGroup(groupId);
      scheduleRefresh('action.rename-group');
      return;
    }

    if (action === 'save-group') {
      await saveGroupSnapshot(groupId);
      renderSavedGroupsPanel();
      return;
    }

    if (action === 'save-close-group') {
      await saveGroupSnapshot(groupId, { closeAfter: true });
      scheduleRefresh('action.save-close-group');
      return;
    }

    if (action === 'close-duplicates') {
      await closeDuplicates(groupId);
      scheduleRefresh('action.close-duplicates');
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

    if (action === 'remove-tabout-bookmark') {
      const bookmarkId = actionEl.dataset.bookmarkId;
      const bookmark = state.tabOutBookmarks.find(item => item.id === bookmarkId);
      if (!bookmark) return;
      await browser.bookmarks.remove(bookmarkId);
      devLog('bookmark.remove-panel', { bookmarkId, url: bookmark.url });
      showToast('Removed favorite');
      scheduleRefresh('action.remove-bookmark');
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
    renderGroups();
    renderStats('search');
  }
  if (target.id === 'bookmarkSearch') {
    state.ui.bookmarkQuery = target.value;
    persistUiState();
    renderBookmarksPanel();
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
