# AGENTS.md -- Tab Out: Firefox Setup & Onboarding Guide for Coding Agents

You're installing **Tab Out** for the user. Your job is not just to set it up -- it's to get them excited about using it.

---

## Step 0 -- Introduce the product

Before doing anything technical, tell the user what they're about to get:

> **Tab Out** replaces your Firefox new tab page with a clean dashboard of everything you have open, grouped by native Firefox groups and smart Tab Out groups.
>
> Here's what makes it great:
> - **See all your open tabs at a glance** grouped by Firefox groups and smart Tab Out groups
> - **Live refresh** keeps the dashboard in sync as tabs, groups, bookmarks, and saved tabs change
> - **Create Firefox groups** from smart groups like Homepages, local/dev, local files, and domains
> - **Duplicate detection** flags when you have the same page open twice
> - **Click any tab title to jump to it** even across different Firefox windows
> - **Save for later** send individual tabs to a local checklist before closing them
> - **Saved tabs** stores links in Tab Out storage, with Firefox bookmarks shown separately for copy/migration
> - **Address bar alias** type `to` to open or focus Tab Out
> - **100% local** no server, no accounts, no data sent anywhere
>
> It's just a Firefox extension. Setup takes about 1 minute.

---

## Step 1 -- Clone the repo

```bash
git clone https://github.com/knbsilva/tab-out-firefox.git
cd tab-out-firefox
```

---

## Step 2 -- Install the Firefox extension for testing

This is the one step that requires manual action from the user. Make it as easy as possible.

**First**, print the full path to the `manifest.json` file:

```bash
echo "Manifest file: $(cd extension && pwd)/manifest.json"
```

**Then**, copy the `manifest.json` path to their clipboard:

- macOS: `(cd extension && printf "%s/manifest.json" "$(pwd)") | pbcopy && echo "Manifest path copied to clipboard"`
- Linux: `(cd extension && printf "%s/manifest.json" "$(pwd)") | xclip -selection clipboard 2>/dev/null || echo "Manifest file: $(pwd)/manifest.json"`
- Windows PowerShell: `(Resolve-Path extension\manifest.json).Path | Set-Clipboard; "Manifest path copied to clipboard"`

**Then**, open Firefox's temporary add-on page:

- macOS: `open -a Firefox "about:debugging#/runtime/this-firefox"`
- Linux: `firefox "about:debugging#/runtime/this-firefox"`
- Windows PowerShell: `Start-Process firefox "about:debugging#/runtime/this-firefox"`

**Then**, walk the user through it step by step:

> I've copied the manifest file path to your clipboard. Now:
>
> 1. You should see Firefox's **This Firefox** debugging page.
> 2. Click **"Load Temporary Add-on..."**.
> 3. A file picker will open. **Press Cmd+Shift+G** (Mac) or **Ctrl+L** (Windows/Linux) to open the path bar, then **paste** the path I copied (Cmd+V / Ctrl+V) and press Enter.
> 4. Select `manifest.json` if needed, then click **Open**.
>
> You should see "Tab Out" appear in the temporary extensions list.

**Also**, open the file browser directly to the extension folder as a fallback:

- macOS: `open extension/`
- Linux: `xdg-open extension/`
- Windows PowerShell: `explorer extension\`

---

## Step 3 -- Show them around

Once the extension is loaded:

> You're all set! Open a **new tab** and you'll see Tab Out.
>
> Here's how it works:
> 1. **Your open tabs are grouped** by native Firefox groups and smart Tab Out groups.
> 2. **Homepages**, local/dev pages, local files, and domains get smart groups.
> 3. **Click any tab title** to jump directly to that tab.
> 4. **Click the X** next to any tab to close just that one.
> 5. **Click "Create Firefox group"** to turn a smart group into a native Firefox group.
> 6. **Duplicate tabs** are flagged with an amber badge. Click "Close duplicates" to keep one copy.
> 7. **Save a tab for later** or star it into Saved tabs.
> 8. Type **`to`** in the address bar to open or focus Tab Out.
>
> That's it! No server to run, no config files. Everything works right away.

---

## Key Facts

- Tab Out is a pure Firefox extension. No server, no Node.js, no npm.
- Saved tabs are stored in `browser.storage.local` (persists across sessions).
- Firefox bookmarks are viewed separately and can be copied into Saved tabs without changing browser bookmarks.
- Temporary add-ons are removed when Firefox restarts; reload `extension/manifest.json` for another test session.
- 100% local. No data is sent to any external service.
- To update: `cd tab-out-firefox && git pull`, then reload the temporary extension in `about:debugging#/runtime/this-firefox`.
