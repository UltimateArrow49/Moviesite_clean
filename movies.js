import { getEntriesByMode, onHistoryChange } from "./continue_watching.js";
import { setupPreviewForGrid } from "./preview_manager.js";

const IMG_BASE = "https://image.tmdb.org/t/p/w500";
const BACKDROP_BASE = "https://image.tmdb.org/t/p/w780";
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_API_KEY = "b7d1cc8554fcab41e013428e2dc418de";
const MAX_PAGES = 500;

const grid = document.getElementById("grid");
const searchInput = document.getElementById("search");
const filtersEl = document.getElementById("filters");
const statusLine = document.getElementById("statusLine");
const continueSection = document.getElementById("continueMovies");
const continueList = document.getElementById("continueMoviesList");
const pageIndicator = document.getElementById("pageIndicator");
const prevBtn = document.getElementById("prevPage");
const nextBtn = document.getElementById("nextPage");
const viewTitle = document.getElementById("viewTitle");

let activeRequest = null;
let searchTimer = null;

setupPreviewForGrid(grid, { mode: "movie" });

const FILTERS = new Map([
  ["trending", { label: "Trending movies", path: "trending/movie/week" }],
  ["popular", { label: "Popular movies", path: "movie/popular" }],
  ["top_rated", { label: "Top rated movies", path: "movie/top_rated" }],
  ["now_playing", { label: "Now playing", path: "movie/now_playing" }],
  ["upcoming", { label: "Upcoming movies", path: "movie/upcoming" }],
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
    if (!response.ok) {
      throw new Error(text || `TMDB request failed (${response.status})`);
    }
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

function formatFacts(movie) {
  const facts = [];
  const year = (movie.release_date || "").slice(0, 4);
  if (year) facts.push(year);
  const rating = Number(movie.vote_average || 0);
  if (movie.vote_count > 0 && rating > 0) facts.push(`⭐ ${rating.toFixed(1)}`);
  if (movie.original_language && movie.original_language !== "en") {
    facts.push(movie.original_language.toUpperCase());
  }
  return facts.join(" • ");
}

function buildPlayerUrl(movie) {
  const params = new URLSearchParams({
    mode: "movie",
    tmdb: String(movie.id),
    title: movie.title || movie.original_title || "Movie",
    autoplay: "true",
    color: "14ff9f",
  });
  if (movie.poster_path) {
    params.set("poster", `${IMG_BASE}${movie.poster_path}`);
  }
  if (movie.backdrop_path) {
    params.set("backdrop", `${BACKDROP_BASE}${movie.backdrop_path}`);
  }
  if (movie.release_date) {
    params.set("release", movie.release_date);
  }
  return `/player.html?${params.toString()}`;
}

function createCard(movie) {
  const card = document.createElement("a");
  card.className = "card";
  card.href = buildPlayerUrl(movie);
  card.dataset.tmdbId = movie.id;
  card.dataset.mode = "movie";
  card.setAttribute(
    "aria-label",
    `Stream ${movie.title || movie.name || "movie"} on theblackbox`,
  );

  const thumb = document.createElement("div");
  thumb.className = "thumb";
  if (movie.poster_path) {
    const img = document.createElement("img");
    img.src = IMG_BASE + movie.poster_path;
    img.alt = `${movie.title || movie.name || "Movie"} poster`;
    thumb.appendChild(img);
  } else {
    const fallback = document.createElement("div");
    fallback.className = "placeholder";
    fallback.textContent = "No artwork";
    thumb.appendChild(fallback);
  }
  const rating = Number(movie.vote_average || 0);
  if (movie.vote_count > 0 && rating > 0) {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = rating.toFixed(1);
    thumb.appendChild(badge);
  }

  const meta = document.createElement("div");
  meta.className = "meta";

  const title = document.createElement("p");
  title.className = "title";
  title.textContent = movie.title || movie.original_title || movie.name || "Untitled";
  meta.appendChild(title);

  const facts = formatFacts(movie);
  if (facts) {
    const sub = document.createElement("p");
    sub.className = "sub";
    sub.textContent = facts;
    meta.appendChild(sub);
  }

  const actions = document.createElement("div");
  actions.className = "actions";
  actions.innerHTML =
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m8 5.14 10 6-10 6V5.14Z"/></svg><span>Watch now</span>';
  meta.appendChild(actions);

  card.appendChild(thumb);
  card.appendChild(meta);
  return card;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const total = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
  }
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function buildResumeUrl(entry) {
  if (entry.href) return entry.href;
  const params = new URLSearchParams({
    mode: entry.mode,
    tmdb: entry.tmdb,
    title: entry.title || "theblackbox",
    autoplay: "true",
    color: "14ff9f",
  });
  if (entry.poster) params.set("poster", entry.poster);
  if (entry.backdrop) params.set("backdrop", entry.backdrop);
  if (entry.progress) params.set("progress", String(entry.progress));
  return `/player.html?${params.toString()}`;
}

function createContinueCard(entry) {
  const card = document.createElement("a");
  card.className = "continue-card";
  card.href = buildResumeUrl(entry);
  card.dataset.mode = entry.mode;
  card.setAttribute("aria-label", `Resume ${entry.title || "movie"}`);
  card.setAttribute("role", "listitem");

  const art = document.createElement("div");
  art.className = "continue-card__art";
  if (entry.poster) {
    const img = document.createElement("img");
    img.src = entry.poster;
    img.alt = `${entry.title || "Movie"} artwork`;
    art.appendChild(img);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "continue-card__placeholder";
    placeholder.textContent = "No artwork";
    art.appendChild(placeholder);
  }

  const meta = document.createElement("div");
  meta.className = "continue-card__meta";

  const title = document.createElement("p");
  title.className = "continue-card__title";
  title.textContent = entry.title || "Untitled";
  meta.appendChild(title);

  const resume = document.createElement("p");
  resume.className = "continue-card__resume";
  const progressLabel = formatTime(entry.progress || 0);
  resume.textContent = entry.progress ? `Resume from ${progressLabel}` : "Start over";
  meta.appendChild(resume);

  const progressBar = document.createElement("div");
  progressBar.className = "continue-card__progress";
  const fill = document.createElement("span");
  let percent = 0;
  if (entry.runtime && entry.progress) {
    percent = Math.min(100, Math.round((entry.progress / entry.runtime) * 100));
  } else if (entry.progress) {
    percent = 5;
  }
  fill.style.width = `${percent}%`;
  progressBar.appendChild(fill);
  meta.appendChild(progressBar);

  card.appendChild(art);
  card.appendChild(meta);
  return card;
}

function renderContinueWatching() {
  if (!continueSection || !continueList) return;
  const entries = getEntriesByMode("movie").slice(0, 10);
  if (!entries.length) {
    continueSection.hidden = true;
    continueList.innerHTML = "";
    return;
  }
  continueSection.hidden = false;
  continueList.innerHTML = "";
  const fragment = document.createDocumentFragment();
  for (const entry of entries) {
    fragment.appendChild(createContinueCard(entry));
  }
  continueList.appendChild(fragment);
}

function render(results = [], total = 0) {
  clearGrid();
  if (!results.length) {
    placeholder(state.query ? "No movies matched your search." : "No movies to show right now.");
    updateStatus(0, total, results.length);
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const movie of results) {
    if (!movie || !movie.id) continue;
    fragment.appendChild(createCard(movie));
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
      ? `We couldn’t find any movies for “${state.query}”. Try a different keyword.`
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
    viewTitle.textContent = `Search results`;
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
  const endpoint = query ? "search/movie" : (FILTERS.get(filter) || FILTERS.get("trending")).path;
  const params = { page: String(page) };
  if (query) params.query = query;

  setBusy(true);
  placeholder("Loading titles…");

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
    placeholder("Unable to load movies right now. Please try again shortly.");
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
  renderContinueWatching();
  onHistoryChange(renderContinueWatching);
  loadPage();
}

document.addEventListener("DOMContentLoaded", init);