import { getEntriesByMode, onHistoryChange } from "./continue_watching.js";
import { setupPreviewForGrid } from "./preview_manager.js";
import { IMG_BASE, requestTmdb } from "./tmdb_client.js";

const grid = document.getElementById("grid");
const searchInput = document.getElementById("search");
const statusLine = document.getElementById("statusLine");
const continueSection = document.getElementById("continueShows");
const continueList = document.getElementById("continueShowsList");
const viewTitle = document.getElementById("viewTitle");
const carouselList = document.getElementById("carouselList");
const searchSection = document.getElementById("searchResults");

let searchTimer = null;
let searchController = null;
let activeQuery = "";

setupPreviewForGrid(grid, { mode: "tv" });

const CAROUSELS = [
  { id: "trending", label: "Trending series", path: "trending/tv/week" },
  { id: "popular", label: "Popular series", path: "tv/popular" },
  { id: "top_rated", label: "Top rated series", path: "tv/top_rated" },
  { id: "airing_today", label: "Airing today", path: "tv/airing_today" },
  { id: "on_the_air", label: "Currently on air", path: "tv/on_the_air" },
];

const carouselStates = new Map();

function clearGrid() {
  if (grid) grid.innerHTML = "";
}

function placeholder(message) {
  if (!grid) return;
  grid.innerHTML = `<p class="empty">${message}</p>`;
}

function formatFacts(show) {
  const facts = [];
  const year = (show.first_air_date || "").slice(0, 4);
  if (year) facts.push(year);
  const rating = Number(show.vote_average || 0);
  if (show.vote_count > 0 && rating > 0) facts.push(`⭐ ${rating.toFixed(1)}`);
  if (Array.isArray(show.origin_country) && show.origin_country.length) {
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
  card.dataset.mode = "tv";
  card.dataset.season = "1";
  card.dataset.episode = "1";
  card.setAttribute(
    "aria-label",
    `Open details for ${show.name || show.original_name || "show"}`,
  );

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
  actions.innerHTML =
    '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M4 4h16v2H4zm0 14h16v2H4zm0-7h16v2H4z"/></svg><span>Browse seasons</span>';
  meta.appendChild(actions);

  card.appendChild(thumb);
  card.appendChild(meta);
  return card;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function formatEpisodeLabel(entry) {
  if (entry.mode !== "tv") return "Episode";
  const season = Number(entry.season) || 1;
  const episode = Number(entry.episode) || 1;
  return `S${String(season).padStart(2, "0")} • E${String(episode).padStart(2, "0")}`;
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
  if (entry.season) params.set("season", String(entry.season));
  if (entry.episode) params.set("episode", String(entry.episode));
  return `/player.html?${params.toString()}`;
}

function createContinueCard(entry) {
  const card = document.createElement("a");
  card.className = "continue-card";
  card.href = buildResumeUrl(entry);
  card.dataset.mode = entry.mode;
  card.setAttribute("aria-label", `Resume ${entry.title || "show"}`);
  card.setAttribute("role", "listitem");

  const art = document.createElement("div");
  art.className = "continue-card__art";
  if (entry.poster) {
    const img = document.createElement("img");
    img.src = entry.poster;
    img.alt = `${entry.title || "Show"} artwork`;
    art.appendChild(img);
  } else {
    const placeholderEl = document.createElement("div");
    placeholderEl.className = "continue-card__placeholder";
    placeholderEl.textContent = "No artwork";
    art.appendChild(placeholderEl);
  }

  const meta = document.createElement("div");
  meta.className = "continue-card__meta";

  const title = document.createElement("p");
  title.className = "continue-card__title";
  title.textContent = entry.title || "Untitled";
  meta.appendChild(title);

  const episode = document.createElement("p");
  episode.className = "continue-card__resume";
  episode.textContent = `${formatEpisodeLabel(entry)} · ${entry.progress ? `Resume at ${formatTime(entry.progress)}` : "Start over"}`;
  meta.appendChild(episode);

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
  const entries = getEntriesByMode("tv").slice(0, 10);
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

function createCarouselSection(definition) {
  if (!carouselList) return null;
  const section = document.createElement("section");
  section.className = "carousel";
  section.dataset.carousel = definition.id;

  const header = document.createElement("div");
  header.className = "carousel__header";

  const title = document.createElement("h2");
  title.className = "carousel__title";
  title.textContent = definition.label;
  header.appendChild(title);

  const controls = document.createElement("div");
  controls.className = "carousel__controls";

  const prev = document.createElement("button");
  prev.type = "button";
  prev.className = "carousel__arrow";
  prev.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z"/></svg>';
  prev.disabled = true;
  controls.appendChild(prev);

  const next = document.createElement("button");
  next.type = "button";
  next.className = "carousel__arrow";
  next.innerHTML =
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="m8.59 16.59 1.41 1.41 6-6-6-6-1.41 1.41L12.17 12z"/></svg>';
  controls.appendChild(next);

  header.appendChild(controls);
  section.appendChild(header);

  const scroller = document.createElement("div");
  scroller.className = "carousel__scroller";
  scroller.setAttribute("role", "list");
  section.appendChild(scroller);

  const message = document.createElement("p");
  message.className = "carousel__message";
  message.hidden = true;
  section.appendChild(message);

  carouselList.appendChild(section);

  const state = {
    def: definition,
    section,
    scroller,
    prev,
    next,
    message,
  };

  const updateArrows = () => {
    const maxScroll = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    prev.disabled = scroller.scrollLeft <= 8;
    next.disabled = scroller.scrollLeft >= maxScroll - 8;
  };

  const scrollByDirection = (direction) => {
    const amount = scroller.clientWidth * 0.9 * direction;
    scroller.scrollBy({ left: amount, behavior: "smooth" });
  };

  prev.addEventListener("click", () => {
    scrollByDirection(-1);
    setTimeout(updateArrows, 320);
  });

  next.addEventListener("click", () => {
    scrollByDirection(1);
    setTimeout(updateArrows, 320);
  });

  scroller.addEventListener("scroll", () => updateArrows());
  window.addEventListener("resize", () => updateArrows(), { passive: true });

  setupPreviewForGrid(scroller, { mode: "tv" });

  const enhancedState = { ...state, updateArrows };
  carouselStates.set(definition.id, enhancedState);
  updateArrows();
  return enhancedState;
}

function setCarouselMessage(state, message) {
  if (!state) return;
  if (!message) {
    state.message.textContent = "";
    state.message.hidden = true;
    return;
  }
  state.message.textContent = message;
  state.message.hidden = false;
}

function renderCarousel(state, items) {
  if (!state) return;
  state.scroller.innerHTML = "";
  const fragment = document.createDocumentFragment();
  for (const item of items) {
    if (!item || !item.id) continue;
    fragment.appendChild(createCard(item));
  }
  state.scroller.appendChild(fragment);
  state.updateArrows();
}

async function loadCarousel(definition) {
  let state = carouselStates.get(definition.id);
  if (!state) {
    state = createCarouselSection(definition);
  }
  if (!state) return;

  setCarouselMessage(state, "Loading titles…");
  try {
    const data = await requestTmdb(definition.path, { page: "1" });
    const results = Array.isArray(data.results) ? data.results : [];
    if (!results.length) {
      renderCarousel(state, []);
      setCarouselMessage(state, "No series available right now. Please check back soon.");
      return;
    }
    renderCarousel(state, results);
    setCarouselMessage(state, "");
  } catch (error) {
    console.error(error);
    renderCarousel(state, []);
    setCarouselMessage(state, "Unable to load this row right now. Retry shortly.");
  }
}

function showSearchSection() {
  if (!searchSection) return;
  searchSection.hidden = false;
}

function hideSearchSection() {
  if (!searchSection || !statusLine) return;
  searchSection.hidden = true;
  statusLine.textContent = "";
  activeQuery = "";
  clearGrid();
  if (grid) grid.setAttribute("aria-busy", "false");
}

function syncUrl(query) {
  const url = new URL(window.location.href);
  if (query) {
    url.searchParams.set("q", query);
  } else {
    url.searchParams.delete("q");
  }
  url.hash = "";
  history.replaceState({}, "", url);
}

function renderSearchResults(results, total, query) {
  clearGrid();
  if (!results.length) {
    const message = `We couldn’t find any shows for “${query}”. Try a different keyword.`;
    placeholder(message);
    if (statusLine) statusLine.textContent = message;
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const show of results) {
    if (!show || !show.id) continue;
    fragment.appendChild(createCard(show));
  }
  grid.appendChild(fragment);

  const totalLabel = total ? total.toLocaleString() : results.length.toLocaleString();
  statusLine.textContent = `Showing ${results.length.toLocaleString()} of ${totalLabel} results for “${query}”.`;
}

async function performSearch(query) {
  const clean = query.trim();
  if (!clean) {
    if (searchController) {
      searchController.abort();
      searchController = null;
    }
    hideSearchSection();
    syncUrl("");
    return;
  }
  if (clean === activeQuery && !searchSection?.hidden) return;

  if (searchController) searchController.abort();
  const controller = new AbortController();
  searchController = controller;
  activeQuery = clean;

  showSearchSection();
  if (grid) {
    grid.setAttribute("aria-busy", "true");
    clearGrid();
  }
  if (viewTitle) viewTitle.textContent = `Results for “${clean}”`;
  if (statusLine) statusLine.textContent = "Searching…";

  try {
    const data = await requestTmdb(
      "search/tv",
      { page: "1", query: clean },
      { signal: controller.signal },
    );
    const results = Array.isArray(data.results) ? data.results : [];
    const total = Number(data.total_results) || results.length;
    renderSearchResults(results, total, clean);
    syncUrl(clean);
  } catch (error) {
    if (error.name === "AbortError") return;
    console.error(error);
    placeholder("Unable to search right now. Please try again shortly.");
    if (statusLine) {
      statusLine.textContent = "A network error stopped the TMDB search. Retrying may help.";
    }
  } finally {
    if (grid) grid.setAttribute("aria-busy", "false");
    if (searchController === controller) {
      searchController = null;
    }
  }
}

function initSearch() {
  if (!searchInput) return;
  searchInput.addEventListener("input", () => {
    const value = searchInput.value;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => performSearch(value), 350);
  });
}

function initCarousels() {
  for (const def of CAROUSELS) {
    loadCarousel(def);
  }
}

function applyInitialQuery() {
  if (!searchInput) return;
  const url = new URL(window.location.href);
  const initialQuery = url.searchParams.get("q");
  if (initialQuery) {
    searchInput.value = initialQuery;
    performSearch(initialQuery);
  }
}

function init() {
  renderContinueWatching();
  onHistoryChange(renderContinueWatching);
  initSearch();
  initCarousels();
  applyInitialQuery();
}

document.addEventListener("DOMContentLoaded", init);
