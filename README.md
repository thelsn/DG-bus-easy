# DG Buses

Simple mobile-friendly viewer for **Dumfries & Galloway Council** bus timetables.

## What it does

- Lists official council bus services (1–95, 100s, 200s, 300s, 400s, 500s)
- Shows timetables from **pre-parsed PDF data** stored in this repo
- Favourites saved in `localStorage`
- Link through to the official council PDF

## Live site

https://thelsn.github.io/DG-bus-easy/

If that 404s: **Settings → Pages → Deploy from branch → `gh-pages` / root**.

## Data

- `data/services.json` — service list / PDF links scraped from council pages
- `data/timetables/*.json` — timetable tables extracted from those PDFs

## Local

```bash
python3 -m http.server 8080
```

Open http://localhost:8080
