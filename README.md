# Tab Out

**Keep tabs on your tabs.**

Tab Out is a Firefox extension that replaces your new tab page with a dense dashboard of everything you have open. It shows native Firefox tab groups when they exist, adds smart groups for common workflows, and lets you clean up tabs without leaving the new tab page.

No server. No account. No external API calls. Just a Firefox extension.

---

## Install with a coding agent

Send your coding agent (Claude Code, Codex, etc.) this repo and say **"install this"**:

```text
https://github.com/knbsilva/tab-out-firefox
```

The agent will walk you through loading it in Firefox. Takes about 1 minute.

---

## Features

- **Live refresh** updates the dashboard when Firefox tabs, tab groups, bookmarks, or saved tabs change
- **Firefox tab groups** show native group title, color, collapsed state, and member sites
- **Smart groups** collect homepages, local/dev pages, local files, custom rules, and domains
- **Create Firefox groups** from a smart Tab Out group
- **Omnibox alias** type `to` in the address bar to open or focus Tab Out
- **Saved tabs** stores links inside Tab Out storage; Firefox bookmarks are shown separately and can be copied into Saved tabs
- **Duplicate detection** flags when you have the same page open twice, with one-click cleanup
- **Click any tab to jump to it** across Firefox windows, no new tab opened
- **Save for later** bookmark tabs to a checklist before closing them
- **Development logs** record refreshes and actions under `__tabOutDevLogs`
- **100% local** your data never leaves your machine
- **Pure Firefox extension** no server, no Node.js, no npm, no setup beyond loading the add-on

---

## Manual Setup

**1. Clone the repo**

```bash
git clone https://github.com/knbsilva/tab-out-firefox.git
cd tab-out-firefox
```

**2. Load the Firefox extension for testing**

1. Open Firefox and go to `about:debugging#/runtime/this-firefox`
2. Click **Load Temporary Add-on...**
3. Select `extension/manifest.json`
4. Open a new tab

You'll see Tab Out.

Temporary add-ons are removed when Firefox restarts. For another test session, load `extension/manifest.json` again from `about:debugging#/runtime/this-firefox`.

---

## How it works

```text
You open a new tab
  -> Tab Out shows native Firefox groups and smart groups
  -> The dashboard refreshes as Firefox changes
  -> Click any tab title to jump to it
  -> Save tabs and sites into Tab Out storage
  -> Create native Firefox groups from smart groups
```

Everything runs inside the Firefox extension. No external server, no API calls, no data sent anywhere. Saved tabs, saved groups and UI state are stored in `browser.storage.local`; Firefox bookmarks are read separately and are not exported with Tab Out data.

---

## Tech stack

| What | How |
|------|-----|
| Extension | Firefox WebExtensions Manifest V3 |
| Storage | browser.storage.local |
| Firefox bookmarks view | browser.bookmarks |
| Tab groups | browser.tabGroups + browser.tabs.group |
| Address bar alias | browser.omnibox (`to`) |
| Background | Firefox event page |
| Tests | Node.js syntax checks + pure grouping tests |

---

## License

MIT
