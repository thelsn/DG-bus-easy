# DG Bus Easy

Client-side viewer for **Dumfries & Galloway Council** bus timetable PDFs.

## Features

- Lists official council bus services across **1–95, 101–127, 200s, 300s, 400s and 500s**
- Parses the selected **PDF timetable** in the browser (pdf.js)
- **Favourites** stored in `localStorage`
- **Refresh list** re-scrapes the council listing pages when CORS proxies allow

## Live site

https://thelsn.github.io/DG-bus-easy/

> If that URL 404s, enable Pages once: **Settings → Pages → Deploy from branch → `gh-pages` / root → Save**.

## Data source

Bundled catalog in `data/services.json` scraped from the council timetable pages (including linked 200–500 ranges). Timetable content comes from the official PDFs on those pages.

## Local development

```bash
python3 -m http.server 8080
```

Open http://localhost:8080

## Note

The council site uses Cloudflare and often blocks cross-origin PDF fetches. The app always offers **Open PDF**. In-browser parsing works when a CORS proxy can retrieve the file.
