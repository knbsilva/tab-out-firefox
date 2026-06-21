/* Tab Out toolbar popup */

'use strict';

function $(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const node = $(id);
  if (node) node.textContent = String(value);
}

async function loadSummary() {
  const response = await browser.runtime.sendMessage({ type: 'tab-out:popup-summary' });
  if (!response || !response.ok) {
    setText('popupStatus', 'Summary unavailable');
    return;
  }

  const summary = response.summary || {};
  setText('popupTabs', summary.tabs || 0);
  setText('popupSaved', summary.saved || 0);
  setText('popupGroups', summary.savedGroups || 0);
  setText('popupFavorites', summary.favorites || 0);
  setText('popupStatus', `${summary.archived || 0} archived`);
}

async function handleClick(event) {
  const button = event.target.closest('[data-action]');
  if (!button) return;

  const action = button.dataset.action;
  if (action === 'open-view') {
    await browser.runtime.sendMessage({
      type: 'tab-out:open-dashboard',
      view: button.dataset.view || 'groups',
    });
    window.close();
    return;
  }

  if (action === 'refresh') {
    await browser.runtime.sendMessage({ type: 'tab-out:refresh-dashboard' });
    await loadSummary();
  }
}

document.addEventListener('click', event => {
  handleClick(event).catch(error => {
    console.warn('[tab-out:popup] action failed', error);
    setText('popupStatus', 'Action failed');
  });
});

loadSummary().catch(error => {
  console.warn('[tab-out:popup] summary failed', error);
  setText('popupStatus', 'Summary unavailable');
});
