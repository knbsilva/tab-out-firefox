/**
 * background.js - Firefox event page badge updates
 *
 * Keeps the toolbar badge showing the current open tab count.
 * The badge counts user-facing tabs and skips Firefox internal pages.
 *
 * Color coding gives a quick at-a-glance health signal:
 *   Green  (#3d7a4a) -> 1-10 tabs  (focused, manageable)
 *   Amber  (#b8892e) -> 11-20 tabs (getting busy)
 *   Red    (#b35a5a) -> 21+ tabs   (time to cull!)
 */

function isUserFacingTabUrl(url) {
  if (!url) return false;

  try {
    return ['http:', 'https:', 'file:'].includes(new URL(url).protocol);
  } catch {
    return false;
  }
}

// ─── Badge updater ────────────────────────────────────────────────────────────

/**
 * updateBadge()
 *
 * Counts open user-facing tabs and updates the extension's toolbar badge.
 */
async function updateBadge() {
  try {
    const tabs = await browser.tabs.query({});

    const count = tabs.filter(t => isUserFacingTabUrl(t.url)).length;

    // Don't show "0" — an empty badge is cleaner
    await browser.action.setBadgeText({ text: count > 0 ? String(count) : '' });

    if (count === 0) return;

    // Pick badge color based on workload level
    let color;
    if (count <= 10) {
      color = '#3d7a4a'; // Green — you're in control
    } else if (count <= 20) {
      color = '#b8892e'; // Amber — things are piling up
    } else {
      color = '#b35a5a'; // Red — time to focus and close some tabs
    }

    await browser.action.setBadgeBackgroundColor({ color });

  } catch {
    // If something goes wrong, clear the badge rather than show stale data
    browser.action.setBadgeText({ text: '' });
  }
}

// ─── Event listeners ──────────────────────────────────────────────────────────

// Update badge when the extension is first installed
browser.runtime.onInstalled.addListener(() => {
  updateBadge();
});

// Update badge when Firefox starts up
browser.runtime.onStartup.addListener(() => {
  updateBadge();
});

// Update badge whenever a tab is opened
browser.tabs.onCreated.addListener(() => {
  updateBadge();
});

// Update badge whenever a tab is closed
browser.tabs.onRemoved.addListener(() => {
  updateBadge();
});

// Update badge when a tab's URL changes
browser.tabs.onUpdated.addListener(() => {
  updateBadge();
});

// ─── Initial run ─────────────────────────────────────────────────────────────

// Run once immediately when the service worker first loads
updateBadge();
