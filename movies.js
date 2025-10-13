import { getEntriesByMode, onHistoryChange } from "./continue_watching.js";
import { setupPreviewForGrid } from "./preview_manager.js";

const IMG_BASE = "https://image.tmdb.org/t/p/w500";
const BACKDROP_BASE = "https://image.tmdb.org/t/p/w780";
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_API_KEY = "b7d1cc8554fcab41e013428e2dc418de";

const grid = document.getElementById("grid");
const searchInput = document.getElementById("search");
const statusLine = document.getElementById("statusLine");
const continueSection = document.getElementById("continueMovies");
const continueList = document.getElementById("continueMoviesList");
const viewTitle = document.getElementById("viewTitle");
const carouselList = document.getElementById("carouselList");
const searchSection = document.getElementById("searchResults");

let searchTimer = null;
let searchController = null;
let activeQuery = "";
let fallbackCatalogPromise = null;

setupPreviewForGrid(grid, { mode: "movie" });

function loadFallbackCatalog() {
  if (!fallbackCatalogPromise) {
    fallbackCatalogPromise = fetch("./catalog_fallback.json", { cache: "no-store" })
      .then((response) => {
        if (!response.ok) {
          throw new Error("Fallback catalog unavailable");
        }
        return response.json();
      })
      .catch((error) => {
        console.warn("Unable to load fallback catalog", error);
        return {};
      });
  }
  return fallbackCatalogPromise;
}

async function getFallbackMovies() {
  const catalog = await loadFallbackCatalog();
  return Array.isArray(catalog.movies) ? catalog.movies : [];
}

async function searchFallbackMovies(query) {
  const movies = await getFallbackMovies();
  const clean = query.trim().toLowerCase();
  if (!clean) return movies;
  return movies.filter((movie) => {
    const fields = [movie.title, movie.original_title];
    return fields.some((value) =>
      typeof value === "string" && value.toLowerCase().includes(clean),
    );
  });
}

const CAROUSELS = [
  { id: "trending", label: "Trending movies", path: "trending/movie/week" },
  { id: "popular", label: "Popular movies", path: "movie/popular" },
  { id: "top_rated", label: "Top rated movies", path: "movie/top_rated" },
  { id: "now_playing", label: "Now playing", path: "movie/now_playing" },
  { id: "upcoming", label: "Upcoming movies", path: "movie/upcoming" },
];

const carouselStates = new Map();

async function requestTmdb(path, params = {}, { signal } = {}) {
  const query = new URLSearchParams(params);
  const cleanPath = path.replace(/^\/+/, "");

  const attempt = async (url, extraOptions = {}) => {
    const response = await fetch(url, {
      cache: "no-store",
      signal,
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
  } catch (error) {
    if (error.name === "AbortError") throw error;
    throw error;
  }
}

function clearGrid() {
  if (grid) grid.innerHTML = "";
}

function placeholder(message) {
  if (!grid) return;
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

  setupPreviewForGrid(scroller, { mode: "movie" });

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
    if (results.length) {
      renderCarousel(state, results);
      setCarouselMessage(state, "");
      return;
    }
    const fallback = await getFallbackMovies();
    if (fallback.length) {
      renderCarousel(state, fallback);
      setCarouselMessage(state, "Showing offline picks while TMDB refreshes.");
      return;
    }
    renderCarousel(state, []);
    setCarouselMessage(state, "No titles available right now. Please check back soon.");
  } catch (error) {
    console.error(error);
    const fallback = await getFallbackMovies();
    if (fallback.length) {
      renderCarousel(state, fallback);
      setCarouselMessage(state, "Showing offline picks while TMDB reconnects.");
      return;
    }
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
    const message = `We couldn’t find any movies for “${query}”. Try a different keyword.`;
    placeholder(message);
    if (statusLine) statusLine.textContent = message;
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const movie of results) {
    if (!movie || !movie.id) continue;
    fragment.appendChild(createCard(movie));
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
      "search/movie",
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
    const fallbackResults = await searchFallbackMovies(clean);
    if (fallbackResults.length) {
      renderSearchResults(fallbackResults, fallbackResults.length, clean);
      if (statusLine) {
        statusLine.textContent = "Showing offline results while TMDB is unreachable.";
      }
      syncUrl(clean);
    } else {
      placeholder("Unable to search right now. Please try again shortly.");
      if (statusLine) {
        statusLine.textContent = "A network error stopped the TMDB search. Retrying may help.";
      }
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
