# DG Bus Easy

Client-side viewer for **Dumfries & Galloway Council** bus timetable PDFs.

## Features

- Lists official council bus services across **1–95, 101–127, 200s, 300s, 400s and 500s**
- Opens / parses the selected **PDF timetable** in the browser (pdf.js)
- **Favourites** stored in `localStorage`
- Optional **Refresh list** that re-scrapes the council listing pages (when CORS proxies allow)

## Live site

GitHub Pages: https://thelsn.github.io/DG-bus-easy/

## Data source

Bundled catalog in `data/services.json` is scraped from the council timetable pages:

- https://www.dumfriesandgalloway.gov.uk/roads-transport-parking/public-transport/bus-ferry-timetables/bus-services-1-95-7-august-2025
- …plus the linked 101–127 / 200 / 300 / 400 / 500 range pages

Timetable content comes from the linked official PDFs on those pages.

## Local development

Serve the repo root over HTTP (modules require a server):

```bash
python3 -m http.server 8080
```

Then open http://localhost:8080

## Note

The council site uses Cloudflare and blocks many automated / cross-origin requests. The app ships with a bundled service list and always offers **Open PDF**. In-browser PDF parsing works when a CORS proxy can fetch the file; otherwise use the official PDF link.
