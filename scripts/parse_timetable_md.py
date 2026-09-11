#!/usr/bin/env python3
"""Parse WebFetch PDF markdown into structured timetable JSON."""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path
from typing import Any


TIME_RE = re.compile(r"^(?:\d{1,2}:\d{2}|\d{3,4})[a-zA-Z]?$|^-$|^–$|^—$")
HEADING_RE = re.compile(r"^(?:#{1,6}\s+)?(.+)$")
SECTION_HINT = re.compile(
    r"(monday|tuesday|wednesday|thursday|friday|saturday|sunday|"
    r"weekday|weekend|schooldays|school holidays|timetable|"
    r"towards|from |to |outbound|inbound|circular)",
    re.I,
)


def clean_cell(c: str) -> str:
    c = c.strip()
    c = c.replace("\xa0", " ").strip()
    if c in {"–", "—", "−", "---", "–", "—"}:
        return "-"
    if c in {"…", "..."}:
        return ""
    return c


def split_table_row(line: str) -> list[str]:
    line = line.strip()
    if line.startswith("|"):
        line = line[1:]
    if line.endswith("|"):
        line = line[:-1]
    return [clean_cell(c) for c in line.split("|")]


def is_separator_row(cells: list[str]) -> bool:
    if not cells:
        return False
    return all(re.fullmatch(r":?-{3,}:?", c.replace(" ", "")) or c == "" for c in cells)


def parse_markdown_tables(text: str) -> list[dict[str, Any]]:
    lines = text.splitlines()
    sections: list[dict[str, Any]] = []
    i = 0
    pending_title = None

    while i < len(lines):
        line = lines[i].rstrip()
        stripped = line.strip()

        # Capture nearby headings as section titles
        if stripped.startswith("#"):
            pending_title = stripped.lstrip("#").strip()
            i += 1
            continue
        if stripped and not stripped.startswith("|") and SECTION_HINT.search(stripped) and len(stripped) < 120:
            # Keep short section-like lines
            if not re.search(r"\|\s*\S", stripped):
                pending_title = stripped
                i += 1
                continue

        if stripped.startswith("|") and "|" in stripped[1:]:
            table_lines = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                table_lines.append(lines[i].strip())
                i += 1

            rows_raw = [split_table_row(tl) for tl in table_lines]
            rows_raw = [r for r in rows_raw if not is_separator_row(r)]
            if not rows_raw:
                continue

            # Normalize column count
            width = max(len(r) for r in rows_raw)
            rows_raw = [r + [""] * (width - len(r)) for r in rows_raw]

            # Drop columns that are entirely empty
            keep_cols = []
            for col in range(width):
                if any((rows_raw[r][col] or "").strip() for r in range(len(rows_raw))):
                    keep_cols.append(col)
            if not keep_cols:
                continue
            rows_raw = [[r[c] for c in keep_cols] for r in rows_raw]

            headers = None
            data_start = 0
            first = rows_raw[0]
            # Heuristic: first row is header if first cell empty/codes and few times
            time_like = sum(1 for c in first[1:] if TIME_RE.match(c or ""))
            if first and (not first[0] or first[0].upper() in {"", "SERVICE", "STOP"} or time_like == 0):
                # Could still be a day-label row; treat as headers if few stop-like names
                if time_like == 0 and len(first) > 1:
                    headers = first
                    data_start = 1

            parsed_rows = []
            section_title = pending_title
            for r in rows_raw[data_start:]:
                stop = (r[0] or "").strip()
                times = [c if c else "" for c in r[1:]]
                # Skip key/legend rows with almost no times
                meaningful = [t for t in times if t and t not in {"-"}]
                if not stop and not meaningful:
                    continue
                # Day banner row inside table (e.g. "Monday to Saturday")
                if stop and SECTION_HINT.search(stop) and len(meaningful) == 0 and len(stop) < 80:
                    if not section_title:
                        section_title = stop
                    elif "Monday" in stop or "Sunday" in stop or "Saturday" in stop:
                        # Start a soft subsection title
                        section_title = stop
                    continue
                if stop.lower().startswith("key to codes") or stop.lower() in {"key", "notes", "codes"}:
                    continue
                if stop or meaningful:
                    parsed_rows.append({"stop": stop, "times": times})

            if parsed_rows:
                sec: dict[str, Any] = {
                    "title": section_title or "Timetable",
                    "rows": parsed_rows,
                }
                if headers:
                    sec["headers"] = headers
                sections.append(sec)
            pending_title = None
            continue

        i += 1

    return sections


def parse_prose_timetable(text: str) -> list[dict[str, Any]]:
    """Fallback: extract stop + HHMM sequences from continuous PDF text."""
    # Normalize whitespace
    flat = re.sub(r"[ \t]+", " ", text)
    lines = [ln.strip() for ln in flat.splitlines() if ln.strip()]
    body = " ".join(lines)
    body = re.sub(r"\s+", " ", body)

    # Split into chunks by day/section headings (prefer multi-word phrases first)
    section_pat = re.compile(
        r"(?=("
        r"\bMonday\s+to\s+Saturday\b|"
        r"\bMonday\s+to\s+Friday\b|"
        r"\bMonday\s*[–\-]\s*Saturday\b|"
        r"\bMonday\s*[–\-]\s*Friday\b|"
        r"\bSaturdays?\s+only\b|"
        r"\bSundays?\s+only\b|"
        r"\bNo Sunday Service\b|"
        r"\bSchooldays\b|"
        r"\bSchool Holidays\b|"
        r"\bWeekdays\b|"
        r"\bSundays\b|"
        r"\bSaturdays\b|"
        r"\bTIMETABLE\b"
        r"))",
        re.I,
    )
    parts = [p.strip() for p in section_pat.split(body) if p and p.strip()]
    if len(parts) <= 1:
        parts = [body]

    sections: list[dict[str, Any]] = []
    # Find sequences: text then one or more times
    row_pat = re.compile(
        r"([A-Za-z][A-Za-z0-9'’./&\-\s,]{2,80}?)\s+"
        r"((?:\d{3,4}[A-Za-z]?(?:\s+|$)|\-(?:\s+|$)|(?:\.\.\.|…|\.\s)(?:\s+|$)){2,})"
    )

    for part in parts:
        title_m = re.match(
            r"^((?:Monday\s+to\s+Saturday|Monday\s+to\s+Friday|"
            r"Monday\s*[–\-]\s*Saturday|Monday\s*[–\-]\s*Friday|"
            r"Saturdays?\s+only|Sundays?\s+only|No Sunday Service|"
            r"Schooldays|School Holidays|Weekdays|Sundays|Saturdays|TIMETABLE)"
            r"[^.|]{0,60}?)(?=\s+[A-Z][a-z]|\s+[A-Z]{2,}|\s*$)",
            part,
            re.I,
        )
        title = title_m.group(1).strip() if title_m else "Timetable"
        if title.upper() == "TIMETABLE":
            title = "Timetable"
        search_from = title_m.end() if title_m else 0
        chunk = part[search_from:].strip()

        rows = []
        for m in row_pat.finditer(chunk):
            stop = re.sub(r"\s+", " ", m.group(1)).strip(" -")
            # Trim leading junk like codes NS/SO attached before stop in previous match
            stop = re.sub(r"^(?:NS|SO|SCH|SH|NSch|M-F|MF)\s+", "", stop)
            raw_times = re.findall(r"\d{3,4}[A-Za-z]?|\-|\.\.\.|…", m.group(2))
            times = []
            for t in raw_times:
                if t in {"-", "–", "—"}:
                    times.append("-")
                elif t in {"...", "…"}:
                    times.append("")
                elif re.fullmatch(r"\d{3,4}[A-Za-z]?", t):
                    times.append(t)
            if stop and times and not stop.lower().startswith("key to"):
                # Filter out title-like stops
                if SECTION_HINT.fullmatch(stop):
                    continue
                rows.append({"stop": stop, "times": times})

        if rows:
            sections.append({"title": title, "rows": rows})

    return sections


def extract_title(text: str, fallback: str) -> str:
    for line in text.splitlines():
        s = line.strip()
        if s.startswith("#"):
            t = s.lstrip("#").strip()
            if t and t.upper() != "PUBLIC":
                return t
    m = re.search(r"Service\s+[^\n]{3,120}", text)
    if m:
        return m.group(0).strip()
    return fallback


def parse_markdown(md: str, meta: dict[str, Any]) -> dict[str, Any]:
    raw = md or ""
    if len(raw) > 20000:
        raw_text = raw[:20000]
    else:
        raw_text = raw

    sections = parse_markdown_tables(md)
    if not sections:
        sections = parse_prose_timetable(md)

    title = extract_title(md, meta.get("name", ""))
    ok = bool(sections) or bool(md.strip())
    return {
        "key": meta["key"],
        "id": meta["id"],
        "name": meta["name"],
        "pdfUrl": meta["pdfUrl"],
        "extractedAt": "2026-09-11",
        "title": title,
        "sections": sections,
        "rawText": raw_text,
        "ok": ok,
        "error": None if ok else "No content extracted",
    }


def error_result(meta: dict[str, Any], error: str) -> dict[str, Any]:
    return {
        "key": meta["key"],
        "id": meta["id"],
        "name": meta["name"],
        "pdfUrl": meta["pdfUrl"],
        "extractedAt": "2026-09-11",
        "title": meta.get("name"),
        "sections": [],
        "rawText": "",
        "ok": False,
        "error": error,
    }


def safe_key(key: str) -> str:
    return key.replace("::", "__")


def main() -> None:
    # Usage: parse_timetable_md.py <meta.json> <markdown.txt> <out.json>
    # Or batch: parse_timetable_md.py --batch <services.json> <md_dir> <out_dir>
    if len(sys.argv) >= 2 and sys.argv[1] == "--batch":
        services_path, md_dir, out_dir = Path(sys.argv[2]), Path(sys.argv[3]), Path(sys.argv[4])
        services = json.loads(services_path.read_text())
        if isinstance(services, dict):
            services = services["services"]
        out_dir.mkdir(parents=True, exist_ok=True)
        index = {}
        for s in services:
            sk = safe_key(s["key"])
            md_path = md_dir / f"{sk}.md"
            err_path = md_dir / f"{sk}.error"
            out_path = out_dir / f"{sk}.json"
            if err_path.exists():
                result = error_result(s, err_path.read_text().strip() or "fetch failed")
            elif md_path.exists():
                md = md_path.read_text(errors="replace")
                if md.startswith("__FETCH_ERROR__"):
                    result = error_result(s, md.replace("__FETCH_ERROR__", "").strip() or "fetch failed")
                else:
                    result = parse_markdown(md, s)
            else:
                result = error_result(s, "missing fetch result")
            out_path.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
            index[s["key"]] = f"{sk}.json"
        (out_dir / "index.json").write_text(json.dumps(index, indent=2, ensure_ascii=False) + "\n")
        ok_n = sum(1 for s in services if json.loads((out_dir / f"{safe_key(s['key'])}.json").read_text())["ok"])
        fail = [s["key"] for s in services if not json.loads((out_dir / f"{safe_key(s['key'])}.json").read_text())["ok"]]
        print(json.dumps({"ok": ok_n, "failed": len(fail), "failed_keys": fail}))
        return

    meta = json.loads(Path(sys.argv[1]).read_text())
    md = Path(sys.argv[2]).read_text(errors="replace")
    out = Path(sys.argv[3])
    if md.startswith("__FETCH_ERROR__"):
        result = error_result(meta, md.replace("__FETCH_ERROR__", "").strip() or "fetch failed")
    else:
        result = parse_markdown(md, meta)
    out.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n")
    print(out)


if __name__ == "__main__":
    main()
