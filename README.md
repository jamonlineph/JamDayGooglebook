# JamDay — Tasks, Notes & Calendar for Googlebook

JamDay is a private, offline-first productivity app for **Googlebooks and Chromebooks**. It combines tasks, habits, notes and a calendar in one app.

It's an installable web app (PWA): people open it in Chrome, click **Install**, and it runs in its own window from the launcher and shelf, offline included. It also runs on Android, Windows, Mac and Linux in Chrome or Edge.

This repo contains two parts:

| Path | What it is |
|---|---|
| `app/` | The JamDay app (the PWA) |
| `index.html`, `docs.html`, `updates.html`, `roadmap.html`, `privacy.html`, `terms.html`, `contact.html`, `success.html`, `404.html`, `site/` | The website for jamday.app (homepage with Features, Pricing, FAQ and Download sections, plus Help & docs and the legal pages) |

There's no build step and no server. Everything is static files.

---

## Run it locally

```bash
npm start            # serves the repo at http://localhost:8080 (needs Python 3)
# website → http://localhost:8080/
# app     → http://localhost:8080/app/
npm test             # unit tests for the date parser, repeat rules, streaks and quick tokens (Node 20+)
```

Any static server works, for example `npx serve .`. The app must be served over `http://localhost` or HTTPS, not opened as a `file://` page.

## Deploy

**GitHub Pages:** `.github/workflows/pages.yml` runs the tests and deploys the whole repo on every push to `main`. To enable it, go to the repo's **Settings ▸ Pages ▸ Source** and choose **GitHub Actions**. To use your own domain such as `jamday.app`, add it under **Settings ▸ Pages**.

The files also work as-is on any static host, such as Netlify, Cloudflare Pages or Firebase Hosting.

**When you ship an app update:** change `VERSION` in `app/sw.js`. Installed copies then fetch the new files and switch to them the next time they open.

## Android app (APK)

`android/` wraps the same web app in a small native Android shell, so JamDay can be installed as a regular app on Android phones, tablets and Googlebooks.

```bash
npm run build:apk        # → dist/jamday-<version>.apk
# bump android:versionCode in android/AndroidManifest.xml for every update you ship
```

The build script uses the official Android SDK when `ANDROID_HOME` is set. Without it, it uses Ubuntu's packages:

```bash
sudo apt-get install openjdk-21-jdk android-sdk-platform-23 aapt dalvik-exchange zipalign apksigner zip
```

- **What the shell adds:**
  - The web app is bundled in the APK and served from `https://appassets.androidplatform.net/`, so it works fully offline.
  - Reminders are scheduled with Android's alarm service, so they fire even when the app is closed.
  - Exports open Android's "Save to…" dialog, and file pickers work.
  - The back button closes dialogs and panels first.
  - Links open in the right app, and the status bar follows the theme.
- **Signing:**
  - The first build creates a key in `android/keystore/`. The key is git-ignored, so keep a copy somewhere safe.
  - Android only installs an update over an existing install when it's signed with the same key. Uninstalling the app deletes its data.
  - To use your own key, set `KEYSTORE`, `KEYSTORE_PASS` and `KEY_ALIAS`.
- **Installing:**
  - On a phone or tablet, open the APK and allow "Install unknown apps" when asked.
  - On a Chromebook or Googlebook, apps normally come from the Play Store. Sideloading an APK needs developer mode or ADB.
  - The Play Store expects an Android App Bundle (`.aab`) signed with an upload key. That isn't part of this script yet.
- **Not available in the Android app:**
  - The Google Calendar and Drive connection. Google blocks its sign-in page inside embedded web views.
  - Use JamDay in Chrome for Google features, or move data between devices with backups.
- **MCP in the Android app:** the app connects to `ws://127.0.0.1:41823` on the same device. This works when the JamDay connector and your AI app run on that device, for example in Termux. On a Chromebook, Android apps have a separate localhost from the Linux environment, so use JamDay in Chrome for MCP there.
- **Reminders and restarts:** scheduled reminders are cleared when the device restarts, and they're set up again the next time JamDay opens.

## Things to fill in before launch

| What | Where |
|---|---|
| Support email (placeholder `hello@jamday.app`) | Search the website `.html` files for it |
| Checkout link for the **Get JamDay** button | `CHECKOUT_URL` in `site/site.js`. Until it's set, the button goes to the Contact page. |
| Shared Google OAuth client ID (optional) | `DEFAULT_CLIENT_ID` in `app/js/google.js`. With it set, users can connect Google Calendar and Drive without creating their own client ID. |
| Privacy policy and terms | `privacy.html` and `terms.html` are templates written to match how the app behaves. Have them reviewed before you publish. |

To set up the Google client: in Google Cloud Console, enable the Calendar API and the Drive API. Then create an **OAuth client ID** of type *Web application* and add your site's origin (for example `https://jamday.app`) under **Authorized JavaScript origins**.

---

## Features

### Calendar & events
- Day, 2-, 3- and 4-day, week and month views, with a "now" line.
- Drag to create an event, drag to move it, and drag its bottom edge to resize. Tasks can also be dragged onto days.
- Optional **Google Calendar** connection:
  - Reads about 2 weeks back and 3 months ahead from the calendars you choose.
  - Google events are held **in memory only**; they're never saved to the device.
  - Optional **two-way sync** creates, edits and deletes only the events made in JamDay, and can add **Google Meet** links.
- **Join** buttons for meetings. Events can have linked tasks and notes, folders, tags, colours, reminders, notes and attachments.
- Outlook and other calendars can be imported from `.ics` files.

### Tasks, reminders & habits
- Statuses (To do, In progress, Waiting, Done), priorities, a "when" date plus a separate deadline, subtasks, rich notes, people, folders and tags.
- **Flexible scheduling:** plan a task for a day, a week, a month or Someday.
- **Plain-language date picker:** "tomorrow 3pm", "next fri", "in 2 weeks", "this weekend", "every mon, wed and fri".
- **Quick tokens** when adding tasks: `@date`, `#tag`, `&folder`, `!priority` (`!` medium, `!!` high, `!!!` urgent) and `+person`.
- **Habits:** any task can repeat, with a full repeat editor, streaks, best streak and a 30-day completion rate. A 🔥 flame shows in Today, Upcoming and the calendar.
- Views: Inbox, Today, Upcoming, and a Tasks page with list (with grouping), **Kanban board** and calendar layouts.
- **Attachments** up to 100 MB each, with Quick Look previews.
- **Local notifications** for task reminders, event alerts, habit nudges and a daily summary. Each type can be turned on or off.

### Notes & documents
- A block editor with headings, bulleted, numbered and to-do lists, quotes, callouts, code, dividers, **images** and **tables**.
- The **slash menu works mid-line.** Markdown shortcuts also work (`#`, `-`, `1.`, `[]`, `>`, ```` ``` ````, `---`).
- **@ mentions** of tasks, events and notes become links, with backlinks.
- You can create tasks, subtasks, events and sub-notes inside a page.
- **Covers** from a built-in artwork gallery or your own image, and **icons** (emoji or uploaded).
- Folders, tags, pinning, and Markdown export.
- **On-device AI** rewrites and summarizes using Chrome's built-in model where available.

### Folders & tags
- Folders hold notes, tasks and events.
- Folder and tag pages show cards or a list, filter by type, and group by type, date or tag.
- Each tag has its own page, colour and icon.

### Quick Launcher
- Opens with **Alt+Space**, or **Ctrl+K**. The shortcut can be changed.
- Searches everything and creates tasks, events and notes from one line.
- Type `>` for commands, **Tab** for quick actions, and `#` `&` `@` to filter.

### Quick panel
This takes the place of a Mac menu-bar panel.
- Tabs for Today, Calendar, Tasks, Events and Notes.
- Three styles: a dropdown, a draggable floating window, or docked full-height on the left or right edge.
- Opens with **Ctrl+Alt+Space**, and can optionally open when the pointer touches the edge of the window.

### MCP — connect AI apps (optional, off by default)
AI apps that support the Model Context Protocol, such as Claude Desktop, Claude Code, Cursor and VS Code, can work with JamDay.

- **How it connects:** the AI app starts the **JamDay connector** (`app/mcp/jamday-mcp.mjs`). It's a single Node.js 18+ file with no dependencies. The connector relays tool calls over a local WebSocket (`ws://127.0.0.1:41823`, protected by a token) to the JamDay app, which must be open.
- **16 tools:**
  - Read: today's overview, search, and lists of tasks, events, notes, habits, folders and tags.
  - Change: create, update and complete tasks; create and update events and notes; move items to Trash.
- **You stay in control:**
  - Choose read-only or read & write.
  - Every change shows a notice with **Undo**. Rapid changes share one notice with "Undo all".
  - An activity log lists every request.
- **Setup:** open **MCP** in the sidebar, turn on "Allow MCP clients" and download the connector. Then copy the snippet for your AI app, which already includes your token. For Claude Code it's one command:
  ```bash
  claude mcp add jamday --env JAMDAY_TOKEN=<token> -- node /path/to/jamday-mcp.mjs
  ```
- **ChromeOS with the AI app in Linux:** turn on port forwarding for port 41823 under Settings ▸ About ChromeOS ▸ Developers ▸ Linux ▸ Port forwarding.
- **Tests:** `npm test` covers the connector's MCP handshake, relay and token check.

### Integrations & import
- **Google Drive app-data sync** across devices.
- Import:
  - JSON backups
  - **CSV** and **Excel** files (Todoist, Linear and spreadsheet exports)
  - **Markdown**
  - **PDF**
  - **.ics** calendar files
- Export: a JSON backup, tasks as CSV, and notes as Markdown.

### Customization & other
- Light, dark and **glass** themes, accent colours, density and text size.
- Show, hide and reorder sidebar sections. Configurable shortcuts.
- Trash with restore. Items are cleaned up automatically after 30 days.
- Built-in **demo content** and a **feature tour**.
- Works offline. Updates arrive through the service worker.

### Privacy
- No account. Data is stored in IndexedDB on the device.
- No analytics or telemetry.
- The app only uses the network for:
  - loading app updates
  - the optional Google connection
  - the optional MCP connection, which only goes to the connector on the same device
  - on-demand import helpers (the Excel and PDF readers come from cdnjs)

## How the original Mac app's design maps to a Googlebook

| Mac app (from the breakdown) | JamDay on Googlebook |
|---|---|
| Apple Calendar / Internet Accounts | Direct Google Calendar connection, plus `.ics` import |
| iCloud sync (CloudKit) | Google Drive app-data sync (optional) |
| macOS Keychain for Google tokens | Tokens kept in memory only |
| Menu bar panel | Quick panel (dropdown / floating / docked) |
| Apple Intelligence (on-device AI) | Chrome built-in AI (Gemini Nano), where the device supports it |
| Sparkle auto-updates | Service-worker updates |
| Apple Reminders / Notes / Todoist / Linear sync | CSV / Excel / Markdown import (Apple's apps aren't on ChromeOS) |
| Built-in local MCP server | JamDay MCP connector: a small local Node.js helper that the AI app starts, which talks to the open app |
| Polar license keys | Not built. Pricing copy and a checkout link placeholder are in place. |

## Code map

```
app/
  index.html, manifest.webmanifest, sw.js, icons/, css/app.css
  vendor/            Preact + htm (MIT), vendored, no build step
  js/
    main.js          boot, install prompt, service worker, MCP start
    store.js         state, IndexedDB persistence, queries, actions, undo
    db.js            IndexedDB wrapper
    dates.js         plain-language parser, repeat rules, habit streaks
    tokens.js        quick tokens (@ # & ! +) and autocomplete
    md.js            Markdown <-> blocks
    notify.js        local reminders
    io.js            import / export
    google.js        Google Calendar + Drive (Google Identity Services)
    ai.js            Chrome built-in AI (on-device rewrite / summarize)
    mcp.js           MCP client: connects to the connector and runs tool calls
    demo.js          demo content
    ui/              app shell, views (tasks, calendar, notes, collections),
                     block editor, launcher, quick panel, MCP page, settings, tour
  mcp/jamday-mcp.mjs the JamDay MCP connector (stdio MCP server, zero dependencies)
  fonts/             Inter variable font (OFL)
android/             native Android shell + build-apk.sh
tests/               unit tests (dates, quick tokens, MCP connector)
```

Known limits:
- Reminders fire only while JamDay is open, because browsers don't allow scheduled notifications from a closed web app. Keeping the installed app on the shelf works best.
- Attachments aren't included in Drive sync.
