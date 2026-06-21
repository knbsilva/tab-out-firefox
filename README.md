# Tab Out

**Keep tabs on your tabs.**

Tab Out is a Firefox extension that replaces your new tab page with a dashboard of everything you have open. Tabs are grouped by domain, with homepages (Gmail, X, LinkedIn, etc.) pulled into their own group. Close tabs with a satisfying swoosh + confetti.

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

- **See all your tabs at a glance** on a clean grid, grouped by domain
- **Homepages group** pulls Gmail inbox, X home, YouTube, LinkedIn, GitHub homepages into one card
- **Close tabs with style** with swoosh sound + confetti burst
- **Duplicate detection** flags when you have the same page open twice, with one-click cleanup
- **Click any tab to jump to it** across Firefox windows, no new tab opened
- **Save for later** bookmark tabs to a checklist before closing them
- **Localhost grouping** shows port numbers next to each tab so you can tell your local projects apart
- **Expandable groups** show the first 8 tabs with a clickable "+N more"
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
  -> Tab Out shows your open tabs grouped by domain
  -> Homepages (Gmail, X, etc.) get their own group at the top
  -> Click any tab title to jump to it
  -> Close groups you're done with (swoosh + confetti)
  -> Save tabs for later before closing them
```

Everything runs inside the Firefox extension. No external server, no API calls, no data sent anywhere. Saved tabs are stored in `browser.storage.local`.

---

## Tech stack

| What | How |
|------|-----|
| Extension | Firefox WebExtensions Manifest V3 |
| Storage | browser.storage.local |
| Background | Firefox event page |
| Sound | Web Audio API (synthesized, no files) |
| Animations | CSS transitions + JS confetti particles |

---

## License

MIT

---

Built by [Zara](https://x.com/zarazhangrui)
