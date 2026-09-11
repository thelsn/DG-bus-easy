const FAV_KEY = "dg-buses-favs-v1";

const GROUPS = [
  ["all", "All"],
  ["1-95", "1–95"],
  ["101-127", "100s"],
  ["200s", "200s"],
  ["300s", "300s"],
  ["400s", "400s"],
  ["500s", "500s"],
];

const state = {
  services: [],
  favourites: new Set(JSON.parse(localStorage.getItem(FAV_KEY) || "[]")),
  selectedKey: null,
  group: "all",
  query: "",
  favOnly: false,
};

const el = {
  search: document.getElementById("search"),
  chips: document.getElementById("groupChips"),
  favOnly: document.getElementById("favOnly"),
  listStatus: document.getElementById("listStatus"),
  list: document.getElementById("serviceList"),
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

function esc(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function saveFavs() {
  localStorage.setItem(FAV_KEY, JSON.stringify([...state.favourites]));
}

function isFav(key) {
  return state.favourites.has(key);
}

function groupLabel(group) {
  const g = String(group || "");
  if (g.startsWith("200")) return "200s";
  if (g.startsWith("358") || g.startsWith("300")) return "300s";
  if (g.startsWith("407") || g.startsWith("400")) return "400s";
  if (g.startsWith("500")) return "500s";
  if (g.startsWith("101")) return "100s";
  return g || "";
}

function inGroup(service, want) {
  if (want === "all") return true;
  const g = String(service.group || "");
  if (want === "1-95") return g === "1-95";
  if (want === "101-127") return g.startsWith("101");
  if (want === "200s") return g.startsWith("200");
  if (want === "300s") return g.startsWith("358") || g.startsWith("300");
  if (want === "400s") return g.startsWith("407") || g.startsWith("400");
  if (want === "500s") return g.startsWith("500");
  return false;
}

function filtered() {
  const q = state.query.trim().toLowerCase();
  return state.services.filter((s) => {
    if (state.favOnly && !isFav(s.key)) return false;
    if (!inGroup(s, state.group)) return false;
    if (!q) return true;
    return `${s.id} ${(s.numbers || []).join(" ")} ${s.name}`.toLowerCase().includes(q);
  });
}

function renderChips() {
  el.chips.innerHTML = GROUPS.map(
    ([id, label]) =>
      `<button type="button" class="chip${state.group === id ? " on" : ""}" data-group="${id}">${label}</button>`
  ).join("");
}

function renderList() {
  const items = filtered();
  el.listStatus.textContent = `${items.length} bus${items.length === 1 ? "" : "es"}`;
  el.list.innerHTML = items
    .map((s) => {
      const on = s.key === state.selectedKey ? " on" : "";
      const star = isFav(s.key) ? "★" : "☆";
      return `<li>
        <button type="button" class="item${on}" data-key="${esc(s.key)}">
          <span class="num">${esc(s.id)}</span>
          <span>
            <p class="name">${esc(s.name)}</p>
            <p class="group">${esc(groupLabel(s.group))}</p>
          </span>
          <span class="star" data-fav="${esc(s.key)}" title="Favourite">${star}</span>
        </button>
      </li>`;
    })
    .join("");
}

function updateFavBtn() {
  const on = isFav(state.selectedKey);
  el.favBtn.textContent = on ? "★ Favourited" : "☆ Favourite";
  el.favBtn.classList.toggle("on", on);
}

function toggleFav(key) {
  if (state.favourites.has(key)) state.favourites.delete(key);
  else state.favourites.add(key);
  saveFavs();
  renderList();
  if (state.selectedKey === key) updateFavBtn();
}

function renderTimetable(data) {
  const sections = data.sections || [];
  const useful = sections.filter((s) => (s.rows || []).length);
  if (!useful.length) {
    const raw = (data.rawText || "").trim();
    el.timetable.innerHTML = raw
      ? `<pre class="raw">${esc(raw.slice(0, 15000))}</pre>`
      : `<p class="msg bad">No stored timetable for this bus yet. Use Open PDF.</p>`;
    return;
  }

  el.timetable.innerHTML = useful
    .map((section) => {
      const rows = section.rows || [];
      const cols = Math.max(...rows.map((r) => (r.times || []).length), 0);
      const head = Array.from({ length: cols }, (_, i) => `<th>${i + 1}</th>`).join("");
      const body = rows
        .map((r) => {
          const cells = Array.from(
            { length: cols },
            (_, i) => `<td>${esc((r.times || [])[i] || "")}</td>`
          ).join("");
          return `<tr><td>${esc(r.stop || "")}</td>${cells}</tr>`;
        })
        .join("");
      return `<div class="tt">
        <h3>${esc(section.title || "Timetable")}</h3>
        <div class="scroll">
          <table class="grid">
            <thead><tr><th>Stop</th>${head}</tr></thead>
            <tbody>${body}</tbody>
          </table>
        </div>
      </div>`;
    })
    .join("");
}

async function selectService(key) {
  const service = state.services.find((s) => s.key === key);
  if (!service) return;

  state.selectedKey = key;
  renderList();
  el.empty.classList.add("hidden");
  el.detail.classList.remove("hidden");
  el.badge.textContent = `Bus ${service.id}`;
  el.title.textContent = service.name;
  el.meta.textContent = `${groupLabel(service.group)} · Official D&G Council PDF`;
  el.pdfLink.href = service.pdfUrl;
  updateFavBtn();
  el.parseStatus.className = "msg";
  el.parseStatus.textContent = "Loading timetable…";
  el.timetable.innerHTML = "";

  try {
    const file = `data/timetables/${key.replaceAll("::", "__")}.json`;
    const res = await fetch(file, { cache: "no-cache" });
    if (!res.ok) throw new Error(`Missing file (${res.status})`);
    const data = await res.json();
    const hasRows = (data.sections || []).some((s) => (s.rows || []).length);
    if (data.ok && hasRows) {
      el.parseStatus.className = "msg ok";
      el.parseStatus.textContent = "Loaded from stored council PDF data.";
    } else {
      el.parseStatus.className = "msg bad";
      el.parseStatus.textContent =
        data.error || "Couldn’t parse this PDF cleanly. Use Open PDF.";
    }
    renderTimetable(data);
  } catch (err) {
    el.parseStatus.className = "msg bad";
    el.parseStatus.textContent = "Couldn’t load stored timetable. Use Open PDF.";
    el.timetable.innerHTML = `<p class="msg"><a href="${esc(service.pdfUrl)}" target="_blank" rel="noopener">Open official PDF</a></p>`;
  }

  el.detail.scrollIntoView({ behavior: "smooth", block: "start" });
}

async function init() {
  const res = await fetch("data/services.json", { cache: "no-cache" });
  if (!res.ok) throw new Error("Could not load bus list");
  const data = await res.json();
  state.services = (data.services || []).map((s, i) => ({
    ...s,
    key: s.key || `${s.id}::${i}`,
    pdfUrl: s.pdfUrl || s.pdf_url,
  }));
  renderChips();
  renderList();
}

el.list.addEventListener("click", (e) => {
  const fav = e.target.closest("[data-fav]");
  if (fav) {
    e.preventDefault();
    e.stopPropagation();
    toggleFav(fav.getAttribute("data-fav"));
    return;
  }
  const item = e.target.closest("[data-key]");
  if (item) selectService(item.getAttribute("data-key"));
});

el.chips.addEventListener("click", (e) => {
  const chip = e.target.closest("[data-group]");
  if (!chip) return;
  state.group = chip.getAttribute("data-group");
  renderChips();
  renderList();
});

el.search.addEventListener("input", () => {
  state.query = el.search.value;
  renderList();
});

el.favOnly.addEventListener("change", () => {
  state.favOnly = el.favOnly.checked;
  renderList();
});

el.favBtn.addEventListener("click", () => {
  if (state.selectedKey) toggleFav(state.selectedKey);
});

init().catch((err) => {
  el.listStatus.className = "msg bad";
  el.listStatus.textContent = `Failed to load bus list: ${err.message}`;
});
