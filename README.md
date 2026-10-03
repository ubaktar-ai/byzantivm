# Projects — Byzantivm & Demya

A project-management app for iPad, covering both **Byzantivm** and **Demya**.
It's an installable web app (PWA): add it to the iPad home screen and it opens
full-screen like a native app and works offline. No build step and no server-side code.

## Features

- **Company switcher**: view All companies, Byzantivm only, or Demya only. Every screen follows the switch.
- **Overview**: stats per company (live projects, open tasks, overdue, done this week), tasks due in the next 7 days, and progress on live projects.
- **Projects**: grouped by company, with status (Planning / Active / On hold / Completed), start and due dates, a description, and a progress bar.
- **Kanban board** for each project (To Do → In Progress → Review → Done). On iPad, **press and hold a card to drag it**; with a mouse or trackpad, just drag. A List view is also available.
- **Tasks**: every task in one place, grouped by Overdue / Today / Next 7 days / Later, with search and filters for status, priority, and assignee.
- Tasks have a priority, due date, assignee, and notes, and you can tick them done with Undo.
- **Backup**: export to a JSON file through the iPad share sheet (Files, iCloud Drive, AirDrop) and import it again.
- Light and dark mode, sized for touch, and laid out for landscape, portrait, Split View, and phone.

## Install on your iPad

1. Host these files on any static host over HTTPS, for example:
   - **GitHub Pages**: repo *Settings → Pages → Deploy from a branch*, then choose the branch and `/ (root)`.
     (Private repos need a paid GitHub plan for Pages.)
   - **Netlify / Cloudflare Pages / Vercel**: point it at this repo with no build command and `/` as the output directory.
2. Open the URL in **Safari** on the iPad.
3. Tap **Share → Add to Home Screen**.
4. Launch it from the home screen icon.

To try it locally, run `python3 -m http.server 8000` in this folder and open <http://localhost:8000>.

## Where the data lives

Data is stored **on the device** (browser storage for the installed app). Nothing is sent to a server,
so it is not shared between devices or teammates automatically. Use **Settings → Export backup**
regularly, and **Import backup** to restore or to move data to another device.

## Files

| File | Purpose |
| --- | --- |
| `index.html` | App shell |
| `styles.css` | Styles (light/dark, iPad layout) |
| `app.js` | All app logic: data, views, drag & drop, backup |
| `sw.js` | Service worker for offline use. **Bump `VERSION` when you change files.** |
| `manifest.webmanifest`, `icons/` | Home-screen install metadata and icons |
