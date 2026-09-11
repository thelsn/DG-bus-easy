import * as pdfjs from "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";

pdfjs.GlobalWorkerOptions.workerSrc =
  "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";

const FAV_KEY = "dg-bus-easy-favourites-v1";
const CACHE_KEY = "dg-bus-easy-catalog-v1";

const SOURCE_PAGES = [
  "https://www.dumfriesandgalloway.gov.uk/roads-transport-parking/public-transport/bus-ferry-timetables/bus-services-1-95-7-august-2025",
  "https://www.dumfriesandgalloway.gov.uk/roads-transport-parking/public-transport/bus-ferry-timetables/bus-services-101-127-7-august-2025",
  "https://www.dumfriesandgalloway.gov.uk/roads-transport-parking/public-transport/bus-ferry-timetables/bus-services-200-246-7-august-2025",
  "https://www.dumfriesandgalloway.gov.uk/roads-transport-parking/public-transport/bus-ferry-timetables/bus-services-358-390-7-august-2025",
  "https://www.dumfriesandgalloway.gov.uk/roads-transport-parking/public-transport/bus-ferry-timetables/bus-services-407-431-7-august-2025",
  "https://www.dumfriesandgalloway.gov.uk/roads-transport-parking/public-transport/bus-ferry-timetables/bus-services-500-555-7-august-2025",
];

const GROUP_LABELS = {
  "1-95": "1–95",
  "101-127": "101–127",
  "200-246": "200s",
  "200-295": "200s",
  "358-390": "300s",
  "407-431": "400s",
  "500-555": "500s",
};

const state = {
  services: [],
  favourites: new Set(JSON.parse(localStorage.getItem(FAV_KEY) || "[]")),
  selectedKey: null,
  activeGroup: "all",
  query: "",
  favOnly: false,
};

const ui = {
  list: document.getElementById("serviceList"),
  listStatus: document.getElementById("listStatus"),
  search: document.getElementById("search"),
  chips: document.getElementById("groupChips"),
  favOnly: document.getElementById("favOnly"),
  refreshBtn: document.getElementById("refreshBtn"),
  empty: document.getElementById("emptyState"),
  detail: document.getElementById("detail"),
  badge: document.getElementById("detailBadge"),
  title: document.getElementById("detailTitle"),
  meta: document.getElementById("detailMeta"),
  favBtn: document.getElementById("favBtn"),
  pdfLink: document.getElementById("pdfLink"),
  parseStatus: document.getElementById("parseStatus"),
  timetable: document.getElementById("timetable"),
};

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function saveFavourites() {
  localStorage.setItem(FAV_KEY, JSON.stringify([...state.favourites]));
}

function isFavourite(key) {
  return state.favourites.has(key);
}

function groupLabel(group) {
  return GROUP_LABELS[group] || group || "Other";
}

function matchesGroup(service, want) {
  if (want === "all") return true;
  const group = String(service.group || "");
  if (want === "1-95") return group === "1-95";
  if (want === "101-127") return group.startsWith("101");
  if (want === "200s") return group.startsWith("200");
  if (want === "300s") return group.startsWith("358") || group.startsWith("300");
  if (want === "400s") return group.startsWith("407") || group.startsWith("400");
  if (want === "500s") return group.startsWith("500");
  return group === want;
}

function filteredServices() {
  const query = state.query.trim().toLowerCase();
  return state.services.filter((service) => {
    if (state.favOnly && !isFavourite(service.key)) return false;
    if (!matchesGroup(service, state.activeGroup)) return false;
    if (!query) return true;
    const haystack = `${service.id} ${(service.numbers || []).join(" ")} ${service.name}`.toLowerCase();
    return haystack.includes(query);
  });
}

function renderChips() {
  const chips = [
    ["all", "All"],
    ["1-95", "1–95"],
    ["101-127", "101–127"],
    ["200s", "200s"],
    ["300s", "300s"],
    ["400s", "400s"],
    ["500s", "500s"],
  ];
  ui.chips.innerHTML = chips
    .map(
      ([id, label]) =>
        `<button type="button" class="chip${state.activeGroup === id ? " active" : ""}" data-group="${id}">${label}</button>`
    )
    .join("");
}

function renderList() {
  const items = filteredServices();
  ui.listStatus.textContent = `${items.length} service${items.length === 1 ? "" : "s"}`;
  ui.list.innerHTML = items
    .map((service) => {
      const active = service.key === state.selectedKey ? " active" : "";
      const star = isFavourite(service.key) ? "★" : "☆";
      return `<li>
        <button type="button" class="service-item${active}" data-key="${escapeHtml(service.key)}">
          <span class="num">${escapeHtml(service.id)}</span>
          <span>
            <p class="name">${escapeHtml(service.name)}</p>
            <p class="group">${escapeHtml(groupLabel(service.group))}</p>
          </span>
          <span class="starlet" data-fav="${escapeHtml(service.key)}" title="Toggle favourite">${star}</span>
        </button>
      </li>`;
    })
    .join("");
}

function updateFavButton() {
  const on = isFavourite(state.selectedKey);
  ui.favBtn.setAttribute("aria-pressed", String(on));
  ui.favBtn.textContent = on ? "★ Favourited" : "☆ Favourite";
}

function toggleFavourite(key) {
  if (state.favourites.has(key)) state.favourites.delete(key);
  else state.favourites.add(key);
  saveFavourites();
  renderList();
  if (state.selectedKey === key) updateFavButton();
}

function normalizeCatalog(data) {
  const services = (data.services || []).map((service, index) => ({
    id: service.id,
    numbers: service.numbers || [],
    name: service.name,
    pdfUrl: service.pdfUrl || service.pdf_url || service.href,
    group: service.group,
    sourcePage: service.sourcePage,
    key: service.key || `${service.id}::${index}`,
  }));
  return { ...data, services };
}

async function loadBundledCatalog() {
  const response = await fetch("./data/services.json", { cache: "no-cache" });
  if (!response.ok) throw new Error("Could not load bundled catalog");
  return response.json();
}

function parseListingHtml(html, sourcePage) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const anchors = [...doc.querySelectorAll('a[href*=".pdf"], a[href*=".PDF"]')];
  const services = [];

  for (const anchor of anchors) {
    let href = anchor.getAttribute("href") || "";
    href = href.replace(/^https?:\/\/web\.archive\.org\/web\/\d+(?:id_)?\//, "");
    if (href.startsWith("/")) href = "https://www.dumfriesandgalloway.gov.uk" + href;
    if (!/^https?:/i.test(href)) continue;

    let name = (anchor.textContent || "").replace(/\s+/g, " ").trim();
    name = name.replace(/\(\s*PDF.*?\)/i, "").trim();
    const lower = name.toLowerCase();
    if (!name || lower.includes("operator list") || lower.includes("public holiday")) continue;

    const numbers = (name.match(/[A-Z]?\d{1,3}[A-Z]?/gi) || [])
      .map((value) => value.toUpperCase())
      .filter((value) => !/^20\d{2}$/.test(value));
    const id = numbers[0] || name.split(" ")[0];

    let group = "other";
    if (/1-95/.test(sourcePage)) group = "1-95";
    else if (/101-127/.test(sourcePage)) group = "101-127";
    else if (/200/.test(sourcePage)) group = "200-246";
    else if (/358|390/.test(sourcePage)) group = "358-390";
    else if (/407|431/.test(sourcePage)) group = "407-431";
    else if (/500|555/.test(sourcePage)) group = "500-555";

    services.push({
      id,
      numbers: numbers.slice(0, 6),
      name,
      pdfUrl: href,
      group,
      sourcePage,
    });
  }

  return services;
}

async function fetchTextViaProxies(url) {
  const candidates = [
    url,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    `https://corsproxy.io/?${encodeURIComponent(url)}`,
  ];
  let lastError;
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, { signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      if (/just a moment|cf-challenge|cloudflare/i.test(text) && text.length < 20000) {
        throw new Error("Blocked by Cloudflare");
      }
      return text;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("Fetch failed");
}

async function fetchPdfBytes(url) {
  const candidates = [
    url,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    `https://corsproxy.io/?${encodeURIComponent(url)}`,
  ];
  let lastError;
  for (const candidate of candidates) {
    try {
      const response = await fetch(candidate, { signal: AbortSignal.timeout(45000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = await response.arrayBuffer();
      const head = String.fromCharCode(...new Uint8Array(buffer.slice(0, 5)));
      if (!head.startsWith("%PDF")) throw new Error("Not a PDF");
      return buffer;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error("PDF fetch failed");
}

async function scrapeLiveCatalog() {
  const all = [];
  const seen = new Set();
  for (const page of SOURCE_PAGES) {
    const html = await fetchTextViaProxies(page);
    for (const service of parseListingHtml(html, page)) {
      const key = service.pdfUrl.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      all.push(service);
    }
  }
  if (!all.length) throw new Error("No services found while scraping");
  return {
    updated: new Date().toISOString().slice(0, 10),
    note: "Live-scraped from Dumfries & Galloway Council timetable pages.",
    sourcePages: SOURCE_PAGES,
    services: all,
  };
}

function isTimeToken(token) {
  return (
    /^([01]?\d|2[0-3])[:.]?[0-5]\d$/.test(token) ||
    /^(—|--|–|-|NS|R|C|A|B|D|\.\.\.)$/i.test(token)
  );
}

function parseTimetableText(text) {
  const lines = text
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const blocks = [];
  let current = { title: "Timetable", rows: [] };

  for (const line of lines) {
    if (
      /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|bank holiday|schooldays|notes?)\b/i.test(line) ||
      (/\b(timetable|towards|from .+ to )\b/i.test(line) && line.length < 80)
    ) {
      if (current.rows.length) blocks.push(current);
      current = { title: line, rows: [] };
      continue;
    }

    const parts = line.split(" ").filter(Boolean);
    if (parts.length < 2) continue;

    let splitAt = -1;
    for (let i = 1; i < parts.length; i += 1) {
      if (isTimeToken(parts[i].replace(",", ""))) {
        const rest = parts.slice(i);
        const score = rest.filter((token) => isTimeToken(token.replace(",", ""))).length;
        if (score >= Math.min(2, rest.length)) {
          splitAt = i;
          break;
        }
      }
    }
    if (splitAt === -1) continue;

    const stop = parts.slice(0, splitAt).join(" ");
    const times = parts.slice(splitAt).map((token) => token.replace(",", ""));
    if (stop.length < 2) continue;
    current.rows.push({ stop, times });
  }

  if (current.rows.length) blocks.push(current);
  const good = blocks.filter((block) => block.rows.length >= 2);
  return { blocks: good.length ? good : [], raw: text };
}

function renderTimetable(parsed) {
  if (!parsed.blocks.length) {
    ui.timetable.innerHTML = `
      <p class="muted">Couldn’t detect a clean table layout in this PDF. Showing extracted text — or open the official PDF.</p>
      <pre class="raw-text">${escapeHtml(parsed.raw.slice(0, 12000))}</pre>`;
    return;
  }

  ui.timetable.innerHTML = parsed.blocks
    .map((block) => {
      const maxCols = Math.max(...block.rows.map((row) => row.times.length));
      const head = Array.from({ length: maxCols }, (_, i) => `<th>Trip ${i + 1}</th>`).join("");
      const body = block.rows
        .map((row) => {
          const cells = Array.from(
            { length: maxCols },
            (_, i) => `<td>${escapeHtml(row.times[i] || "")}</td>`
          ).join("");
          return `<tr><td>${escapeHtml(row.stop)}</td>${cells}</tr>`;
        })
        .join("");
      return `<article class="tt-block">
        <h3>${escapeHtml(block.title)}</h3>
        <div class="tt-scroll">
          <table class="tt">
            <thead><tr><th>Stop</th>${head}</tr></thead>
            <tbody>${body}</tbody>
          </table>
        </div>
      </article>`;
    })
    .join("");
}

async function extractPdfText(buffer) {
  const pdf = await pdfjs.getDocument({ data: buffer }).promise;
  const chunks = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const rows = new Map();

    for (const item of content.items) {
      const y = Math.round(item.transform[5]);
      const x = item.transform[4];
      if (!rows.has(y)) rows.set(y, []);
      rows.get(y).push({ x, str: item.str });
    }

    const ordered = [...rows.entries()]
      .sort((a, b) => b[0] - a[0])
      .map(([, items]) =>
        items
          .sort((a, b) => a.x - b.x)
          .map((item) => item.str)
          .join(" ")
          .replace(/\s+/g, " ")
          .trim()
      )
      .filter(Boolean);

    chunks.push(ordered.join("\n"));
  }

  return chunks.join("\n\n");
}

async function selectService(key) {
  const service = state.services.find((item) => item.key === key);
  if (!service) return;

  state.selectedKey = key;
  renderList();
  ui.empty.classList.add("hidden");
  ui.detail.classList.remove("hidden");
  ui.badge.textContent = `Service ${service.id}`;
  ui.title.textContent = service.name;
  ui.meta.textContent = `${groupLabel(service.group)} · Official D&G Council PDF`;
  ui.pdfLink.href = service.pdfUrl;
  updateFavButton();
  ui.parseStatus.classList.remove("error");
  ui.parseStatus.textContent = "Fetching and parsing PDF…";
  ui.timetable.innerHTML = "";

  try {
    const buffer = await fetchPdfBytes(service.pdfUrl);
    ui.parseStatus.textContent = "Extracting timetable text…";
    const text = await extractPdfText(buffer);
    const parsed = parseTimetableText(text);
    ui.parseStatus.textContent = parsed.blocks.length
      ? `Parsed ${parsed.blocks.length} section${parsed.blocks.length === 1 ? "" : "s"} from the PDF.`
      : "PDF loaded — layout not fully structured, showing text extract.";
    renderTimetable(parsed);
  } catch (error) {
    console.warn(error);
    ui.parseStatus.classList.add("error");
    ui.parseStatus.textContent =
      "Couldn’t fetch/parse the PDF in-browser (council site often blocks cross-origin requests). Use “Open PDF”.";
    ui.timetable.innerHTML = `<p class="muted">Direct link:
      <a href="${escapeHtml(service.pdfUrl)}" target="_blank" rel="noopener">official timetable PDF</a></p>`;
  }
}

async function initCatalog({ forceLive = false } = {}) {
  ui.listStatus.textContent = "Loading bus list…";
  try {
    let data;
    if (forceLive) {
      data = await scrapeLiveCatalog();
      localStorage.setItem(CACHE_KEY, JSON.stringify(data));
    } else {
      const cached = localStorage.getItem(CACHE_KEY);
      data = cached ? JSON.parse(cached) : await loadBundledCatalog();
    }
    state.services = normalizeCatalog(data).services;
    ui.listStatus.textContent = `Loaded ${state.services.length} services${
      data.updated ? ` · updated ${data.updated}` : ""
    }`;
  } catch (error) {
    console.warn(error);
    const data = await loadBundledCatalog();
    state.services = normalizeCatalog(data).services;
    ui.listStatus.textContent = `Using bundled list (${state.services.length}). Live scrape unavailable.`;
  }
  renderChips();
  renderList();
}

ui.list.addEventListener("click", (event) => {
  const fav = event.target.closest("[data-fav]");
  if (fav) {
    event.preventDefault();
    event.stopPropagation();
    toggleFavourite(fav.getAttribute("data-fav"));
    return;
  }
  const item = event.target.closest("[data-key]");
  if (item) selectService(item.getAttribute("data-key"));
});

ui.chips.addEventListener("click", (event) => {
  const chip = event.target.closest("[data-group]");
  if (!chip) return;
  state.activeGroup = chip.getAttribute("data-group");
  renderChips();
  renderList();
});

ui.search.addEventListener("input", () => {
  state.query = ui.search.value;
  renderList();
});

ui.favOnly.addEventListener("change", () => {
  state.favOnly = ui.favOnly.checked;
  renderList();
});

ui.favBtn.addEventListener("click", () => {
  if (state.selectedKey) toggleFavourite(state.selectedKey);
});

ui.refreshBtn.addEventListener("click", async () => {
  ui.refreshBtn.disabled = true;
  ui.listStatus.textContent = "Scraping council pages…";
  try {
    await initCatalog({ forceLive: true });
  } catch (error) {
    ui.listStatus.textContent = `Refresh failed: ${error.message}`;
  } finally {
    ui.refreshBtn.disabled = false;
  }
});

initCatalog();
