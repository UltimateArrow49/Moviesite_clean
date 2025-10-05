const IMG_BASE = "https://image.tmdb.org/t/p/w500";
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_API_KEY = "b7d1cc8554fcab41e013428e2dc418de";
const MAX_PAGES = 500;

const grid = document.getElementById("grid");
const searchInput = document.getElementById("search");
const filtersEl = document.getElementById("filters");
const statusLine = document.getElementById("statusLine");
const pageIndicator = document.getElementById("pageIndicator");
const prevBtn = document.getElementById("prevPage");
const nextBtn = document.getElementById("nextPage");
const viewTitle = document.getElementById("viewTitle");

let activeRequest = null;
let searchTimer = null;

const FILTERS = new Map([
  ["trending", { label: "Trending shows", path: "trending/tv/week" }],
  ["popular", { label: "Popular shows", path: "tv/popular" }],
  ["top_rated", { label: "Top rated shows", path: "tv/top_rated" }],
  ["airing_today", { label: "Airing today", path: "tv/airing_today" }],
  ["on_the_air", { label: "Currently on air", path: "tv/on_the_air" }],
]);

const state = {
  filter: "trending",
  page: 1,
  totalPages: 1,
  totalResults: 0,
  query: "",
};

function abortActiveRequest() {
  if (activeRequest) {
    activeRequest.abort();
    activeRequest = null;
  }
}

async function requestTmdb(path, params = {}) {
  abortActiveRequest();
  const controller = new AbortController();
  activeRequest = controller;

  const query = new URLSearchParams(params);
  const cleanPath = path.replace(/^\/+/, "");

  const attempt = async (url, extraOptions = {}) => {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      ...extraOptions,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(text || `TMDB request failed (${response.status})`);
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error("Received invalid JSON from TMDB");
    }
  };

  try {
    try {
      const proxyUrl = `/api/tmdb/${cleanPath}${query.toString() ? `?${query}` : ""}`;
      return await attempt(proxyUrl);
    } catch (proxyError) {
      if (proxyError.name === "AbortError") throw proxyError;
      console.warn("Proxy TMDB request failed, retrying direct", proxyError);
    }

    const direct = new URL(`${TMDB_BASE}/${cleanPath}`);
    for (const [key, value] of query.entries()) direct.searchParams.set(key, value);
    if (!direct.searchParams.has("api_key")) direct.searchParams.set("api_key", TMDB_API_KEY);

    return await attempt(direct.toString(), {
      headers: { Accept: "application/json" },
    });
  } finally {
    if (activeRequest === controller) activeRequest = null;
  }
}

function setBusy(isBusy) {
  grid.setAttribute("aria-busy", String(isBusy));
}

function clearGrid() {
  grid.innerHTML = "";
}

function placeholder(message) {
  grid.innerHTML = `<p class="empty">${message}</p>`;
}

function formatFacts(show) {
  const facts = [];
  const year = (show.first_air_date || "").slice(0, 4);
  if (year) facts.push(year);
  const rating = Number(show.vote_average || 0);
  if (show.vote_count > 0 && rating > 0) facts.push(`⭐ ${rating.toFixed(1)}`);
  if (show.origin_country && show.origin_country.length) {
    facts.push(show.origin_country[0]);
  }
  return facts.join(" • ");
}

function buildSeriesUrl(show) {
  const url = new URL("/series_detail.html", window.location.origin);
  url.searchParams.set("id", show.id);
  return url.pathname + url.search;
}

function createCard(show) {
  const card = document.createElement("a");
  card.className = "card";
  card.href = buildSeriesUrl(show);
  card.dataset.tmdbId = show.id;
  card.setAttribute("aria-label", `Open details for ${show.name || show.original_name || "show"}`);

  const thumb = document.createElement("div");
  thumb.className = "thumb";
  if (show.poster_path) {
    const img = document.createElement("img");
    img.src = IMG_BASE + show.poster_path;
    img.alt = `${show.name || show.original_name || "Show"} poster`;
    thumb.appendChild(img);
  } else {
    const fallback = document.createElement("div");
    fallback.className = "placeholder";
    fallback.textContent = "No artwork";
    thumb.appendChild(fallback);
  }
  const rating = Number(show.vote_average || 0);
  if (show.vote_count > 0 && rating > 0) {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = rating.toFixed(1);
    thumb.appendChild(badge);
  }

  const meta = document.createElement("div");
  meta.className = "meta";

  const title = document.createElement("p");
  title.className = "title";
  title.textContent = show.name || show.original_name || show.title || "Untitled";
  meta.appendChild(title);

  const facts = formatFacts(show);
  if (facts) {
    const sub = document.createElement("p");
    sub.className = "sub";
    sub.textContent = facts;
    meta.appendChild(sub);
  }

  const actions = document.createElement("div");
  actions.className = "actions";
  actions.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 4h16v2H4zm4 4h12v2H8zm-4 4h16v2H4zm4 4h12v2H8zm-4 4h16v2H4z"/></svg><span>Choose season &amp; episode</span>';
  meta.appendChild(actions);

  card.appendChild(thumb);
  card.appendChild(meta);
  return card;
}

function render(results = [], total = 0) {
  clearGrid();
  if (!results.length) {
    placeholder(state.query ? "No shows matched your search." : "No shows to display right now.");
    updateStatus(0, total, results.length);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const show of results) {
    if (!show || !show.id) continue;
    fragment.appendChild(createCard(show));
  }
  grid.appendChild(fragment);
  updateStatus(results.length, total, results.length);
}

function updateStatus(count, total, pageCount) {
  const filterInfo = state.query
    ? `for “${state.query}”`
    : (FILTERS.get(state.filter) || FILTERS.get("trending")).label.toLowerCase();

  if (!count) {
    statusLine.textContent = state.query
      ? `We couldn’t find any shows for “${state.query}”.`
      : `No ${filterInfo} at the moment. Try another filter or search.`;
    return;
  }

  const start = (state.page - 1) * 20 + 1;
  const end = start + pageCount - 1;
  const formattedTotal = total ? total.toLocaleString() : "many";
  statusLine.textContent = `Showing ${start.toLocaleString()}–${end.toLocaleString()} of ${formattedTotal} ${filterInfo}.`;
}

function updatePager() {
  pageIndicator.textContent = `Page ${state.page.toLocaleString()} of ${state.totalPages.toLocaleString()}`;
  prevBtn.disabled = state.page <= 1;
  nextBtn.disabled = state.page >= state.totalPages;
}

function highlightActiveFilter() {
  if (!filtersEl) return;
  for (const chip of filtersEl.querySelectorAll(".chip")) {
    if (state.query) {
      chip.classList.remove("is-active");
      continue;
    }
    chip.classList.toggle("is-active", chip.dataset.filter === state.filter);
  }
}

function updateTitle() {
  if (state.query) {
    viewTitle.textContent = "Search results";
  } else {
    const filter = FILTERS.get(state.filter) || FILTERS.get("trending");
    viewTitle.textContent = filter.label;
  }
}

function syncUrl() {
  const url = new URL(window.location.href);
  if (state.query) {
    url.searchParams.set("q", state.query);
    url.hash = "";
  } else {
    url.searchParams.delete("q");
    url.hash = state.filter === "trending" ? "" : `#${state.filter}`;
  }
  history.replaceState({}, "", url);
}

async function loadPage() {
  const { filter, page, query } = state;
  const endpoint = query ? "search/tv" : (FILTERS.get(filter) || FILTERS.get("trending")).path;
  const params = { page: String(page) };
  if (query) params.query = query;

  setBusy(true);
  placeholder("Loading shows…");

  try {
    const data = await requestTmdb(endpoint, params);
    const results = Array.isArray(data.results) ? data.results : [];
    state.totalPages = Math.max(1, Math.min(MAX_PAGES, Number(data.total_pages) || 1));
    state.totalResults = Number(data.total_results) || results.length;
    render(results, state.totalResults);
  } catch (error) {
    if (error.name === "AbortError") return;
    console.error(error);
    clearGrid();
    placeholder("Unable to load shows right now. Please try again shortly.");
    statusLine.textContent = "A network error stopped the TMDB request. Retrying may help.";
  } finally {
    setBusy(false);
    updatePager();
    updateTitle();
    highlightActiveFilter();
    syncUrl();
  }
}

function setFilter(newFilter) {
  if (!FILTERS.has(newFilter)) newFilter = "trending";
  if (state.filter === newFilter && !state.query) return;
  state.filter = newFilter;
  state.page = 1;
  if (state.query) {
    state.query = "";
    if (searchInput) searchInput.value = "";
  }
  loadPage();
}

function setQuery(value) {
  const clean = value.trim();
  if (clean === state.query) return;
  state.query = clean;
  state.page = 1;
  loadPage();
}

function changePage(delta) {
  const nextPage = state.page + delta;
  if (nextPage < 1 || nextPage > state.totalPages) return;
  state.page = nextPage;
  loadPage();
}

function initFilters() {
  if (!filtersEl) return;
  filtersEl.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-filter]");
    if (!button) return;
    setFilter(String(button.dataset.filter));
  });
}

function initPager() {
  if (prevBtn) prevBtn.addEventListener("click", () => changePage(-1));
  if (nextBtn) nextBtn.addEventListener("click", () => changePage(1));
}

function initSearch() {
  if (!searchInput) return;
  searchInput.addEventListener("input", () => {
    const value = searchInput.value;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => setQuery(value), 350);
  });
}

function applyInitialState() {
  const url = new URL(window.location.href);
  const initialQuery = url.searchParams.get("q");
  const hashFilter = url.hash.replace(/^#/, "").toLowerCase();

  if (initialQuery) {
    state.query = initialQuery.trim();
    if (searchInput) searchInput.value = state.query;
  } else if (hashFilter && FILTERS.has(hashFilter)) {
    state.filter = hashFilter;
  }
}

function init() {
  applyInitialState();
  initFilters();
  initPager();
  initSearch();
  highlightActiveFilter();
  updateTitle();
  updatePager();
  loadPage();
}

document.addEventListener("DOMContentLoaded", init);