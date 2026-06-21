/**
 * Firefox background events for Tab Out.
 *
 * Keeps the toolbar badge current, exposes the "to" omnibox alias, broadcasts
 * live refresh signals to dashboard pages, and records development-only logs.
 */

'use strict';

const DASHBOARD_FILE = 'index.html';
const DEV_LOG_KEY = '__tabOutDevLogs';
const UI_STATE_KEY = 'tabOutUiState';
const DEV_LOG_LIMIT = 300;

let logQueue = Promise.resolve();

function isUserFacingTabUrl(url) {
  if (!url) return false;

  try {
    return ['http:', 'https:', 'file:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

function dashboardUrl() {
  return browser.runtime.getURL(DASHBOARD_FILE);
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

async function openOrFocusDashboard() {
  const url = dashboardUrl();
  const tabs = await browser.tabs.query({});
  const existing = tabs.find(tab => tab.url === url);

  if (existing && existing.id != null) {
    await browser.tabs.update(existing.id, { active: true });
    if (existing.windowId != null) {
      await browser.windows.update(existing.windowId, { focused: true });
    }
    devLog('omnibox.focus-dashboard', { tabId: existing.id, windowId: existing.windowId });
    return;
  }

  const tab = await browser.tabs.create({ url });
  devLog('omnibox.open-dashboard', { tabId: tab.id, windowId: tab.windowId });
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
    openOrFocusDashboard().catch(error => {
      devLog('omnibox.error', { message: error.message });
    });
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

updateBadge();
