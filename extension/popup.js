/* Tab Out toolbar popup */

'use strict';

function $(id) {
  return document.getElementById(id);
}

function setText(id, value) {
  const node = $(id);
  if (node) node.textContent = String(value);
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

async function sendMessageOrThrow(message) {
  const response = await browser.runtime.sendMessage(message);
  if (!response || !response.ok) {
    throw new Error((response && response.error) || 'Action failed');
  }
  return response;
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
  if (action === 'favorite-group') {
    const response = await sendMessageOrThrow({ type: 'tab-out:favorite-active-group' });
    const result = response.result || {};
    setText('popupStatus', `Saved group: ${result.title || 'current group'}`);
    await loadSummary();
    return;
  }

  if (action === 'favorite-tab') {
    const response = await sendMessageOrThrow({ type: 'tab-out:favorite-active-tab' });
    const result = response.result || {};
    setText('popupStatus', result.alreadyExists ? 'Already in Saved tabs' : 'Saved tab/site');
    await loadSummary();
    return;
  }

  if (action === 'open-view') {
    await browser.runtime.sendMessage({
      type: 'tab-out:open-dashboard',
      view: button.dataset.view || 'groups',
    });
    window.close();
    return;
  }

  if (action === 'export-data') {
    const response = await sendMessageOrThrow({ type: 'tab-out:export-data' });
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    downloadJsonFile(response.payload, `tab-out-data-${stamp}.json`);
    setText('popupStatus', 'Exported Tab Out data');
    return;
  }

  if (action === 'choose-import-data') {
    const input = $('popupImportFile');
    if (input) input.click();
  }
}

async function handleChange(event) {
  const input = event.target;
  if (input.id !== 'popupImportFile') return;
  const [file] = input.files || [];
  if (!file) return;

  const payload = await readJsonFile(file);
  const confirmed = window.confirm('Import Tab Out data and replace saved tabs, archive, saved groups, aliases and UI state? Firefox bookmarks will not be changed.');
  if (!confirmed) {
    input.value = '';
    return;
  }
  await sendMessageOrThrow({ type: 'tab-out:import-data', payload });
  setText('popupStatus', 'Imported Tab Out data');
  input.value = '';
  await loadSummary();
}

document.addEventListener('click', event => {
  handleClick(event).catch(error => {
    console.warn('[tab-out:popup] action failed', error);
    setText('popupStatus', error.message || 'Action failed');
  });
});

document.addEventListener('change', event => {
  handleChange(event).catch(error => {
    console.warn('[tab-out:popup] import failed', error);
    setText('popupStatus', 'Import failed');
  });
});

loadSummary().catch(error => {
  console.warn('[tab-out:popup] summary failed', error);
  setText('popupStatus', 'Summary unavailable');
});
