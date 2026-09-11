#!/usr/bin/env python3
"""Rebuild data/services.json from saved council HTML snapshots in /tmp/buspages."""
from __future__ import annotations

import html as html_lib
import json
import re
import urllib.parse
from pathlib import Path

BASE = "https://www.dumfriesandgalloway.gov.uk"
PAGES = {
    "1-95": (
        "/tmp/buspages/bus-services-1-95-7-august-2025.html",
        f"{BASE}/roads-transport-parking/public-transport/bus-ferry-timetables/bus-services-1-95-7-august-2025",
    ),
    "101-127": (
        "/tmp/buspages/bus-services-101-127-7-august-2025.html",
        f"{BASE}/roads-transport-parking/public-transport/bus-ferry-timetables/bus-services-101-127-7-august-2025",
    ),
    "200-295": (
        "/tmp/buspages/bus-services-200-295-7-august-2025.html",
        f"{BASE}/roads-transport-parking/public-transport/bus-ferry-timetables/bus-services-200-246-7-august-2025",
    ),
    "358-390": (
        "/tmp/buspages/bus-services-358-390-7-august-2025.html",
        f"{BASE}/roads-transport-parking/public-transport/bus-ferry-timetables/bus-services-358-390-7-august-2025",
    ),
    "407-431": (
        "/tmp/buspages/bus-services-407-431-7-august-2025.html",
        f"{BASE}/roads-transport-parking/public-transport/bus-ferry-timetables/bus-services-407-431-7-august-2025",
    ),
    "500-555": (
        "/tmp/buspages/bus-services-500-555-7-august-2025.html",
        f"{BASE}/roads-transport-parking/public-transport/bus-ferry-timetables/bus-services-500-555-7-august-2025",
    ),
}

LINK_RE = re.compile(r'<a[^>]+href="([^"]+\.pdf[^"]*)"[^>]*>(.*?)</a>', re.I | re.S)


def clean_label(inner: str) -> str:
    label = re.sub(r"<[^>]+>", " ", inner)
    label = html_lib.unescape(re.sub(r"\s+", " ", label)).strip()
    return re.sub(r"\(\s*PDF\s*,?\s*[^)]*\)", "", label, flags=re.I).strip(" -–—")


def extract_ids(label: str, filename: str) -> list[str]:
    head = label.split(" - ")[0]
    tokens = re.findall(r"[A-Z]?\d{1,3}[A-Z]?", head.upper())
    ids: list[str] = []
    for token in tokens:
        if re.fullmatch(r"20\d{2}", token):
            continue
        if token not in ids:
            ids.append(token)
    if not ids:
        ids = [t for t in re.findall(r"[A-Z]?\d{1,3}[A-Z]?", filename.upper()) if not re.fullmatch(r"20\d{2}", t)][:4]
    return ids or ["?"]


def main() -> None:
    services = []
    seen = set()
    for group, (path, source) in PAGES.items():
        text = Path(path).read_text(encoding="utf-8", errors="ignore")
        for href, inner in LINK_RE.findall(text):
            href = re.sub(r"^https?://web\.archive\.org/web/\d+(?:id_)?/", "", href)
            pdf_url = BASE + href if href.startswith("/") else href
            label = clean_label(inner)
            low = label.lower()
            if not label or "operator list" in low or "public holiday" in low:
                continue
            if "network changes" in low:
                continue
            filename = urllib.parse.unquote(pdf_url.split("/")[-1])
            if "community transport" in low:
                numbers = ["CT"]
                primary = "CT"
            else:
                numbers = extract_ids(label, filename)
                primary = numbers[0]
            key = pdf_url.lower()
            if key in seen:
                continue
            seen.add(key)
            out_group = "200-246" if group.startswith("200") else group
            services.append(
                {
                    "id": primary,
                    "numbers": numbers,
                    "name": label,
                    "pdfUrl": pdf_url,
                    "group": out_group,
                    "sourcePage": source,
                }
            )

    def sort_key(item: dict) -> tuple:
        match = re.match(r"^([A-Z]*)(\d+)", item["id"])
        if match:
            return (0, int(match.group(2)), match.group(1), item["id"])
        if item["id"] == "CT":
            return (2, 0, "", item["id"])
        return (1, 9999, "", item["id"])

    services.sort(key=sort_key)
    for index, service in enumerate(services):
        service["key"] = f"{service['id']}::{index}"

    payload = {
        "updated": "2025-08-10",
        "note": "Scraped from official Dumfries & Galloway Council bus timetable PDF listing pages.",
        "sourcePages": [source for _, source in PAGES.values()],
        "services": services,
    }
    out = Path(__file__).resolve().parents[1] / "data" / "services.json"
    out.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(services)} services to {out}")


if __name__ == "__main__":
    main()
