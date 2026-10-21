import { setupPreviewForGrid } from "./preview_manager.js";
import { setupAnimatedList } from "./ui_effects.js?v=16";
import {
  ACTION_ICONS,
  createMediaCard,
  joinFacts,
  updateResultGroup,
} from "./catalog_ui.js?v=5";
import { BACKDROP_BASE, IMG_BASE, requestTmdb } from "./tmdb_client.js?v=17";

const searchForm = document.getElementById("searchForm");
const searchInput = document.getElementById("search");
const statusLine = document.getElementById("searchStatus");
const movieGroup = document.getElementById("movieGroup");
const showGroup = document.getElementById("showGroup");
const movieList = document.getElementById("movieResults");
const showList = document.getElementById("showResults");
const movieCount = document.getElementById("movieCount");
const showCount = document.getElementById("showCount");
const movieEmpty = document.getElementById("movieEmpty");
const showEmpty = document.getElementById("showEmpty");
const scopeButtons = Array.from(document.querySelectorAll("[data-search-scope]"));

const state = {
  scope: "movie",
};
const SEARCH_DEBOUNCE_MS = 220;

if (movieList) {
  setupPreviewForGrid(movieList, { mode: "movie" });
  setupAnimatedList(movieList, { axis: "y" });
}

if (showList) {
  setupPreviewForGrid(showList, { mode: "tv" });
  setupAnimatedList(showList, { axis: "y" });
}

let activeController = null;
let searchDebounceId = 0;

function sanitizeQuery(value) {
  return (value || "").replace(/\s+/g, " ").trim();
}

function normalizeScope(value) {
  return value === "tv" ? "tv" : "movie";
}

function setStatus(message) {
  if (!statusLine) return;
  statusLine.textContent = message || "";
  statusLine.hidden = !message;
}

function buildMovieUrl(movie) {
  const params = new URLSearchParams({
    mode: "movie",
    tmdb: String(movie.id),
    title: movie.title || movie.original_title || "Movie",
    autoplay: "true",
    color: "14ff9f",
  });

  if (movie.poster_path) params.set("poster", `${IMG_BASE}${movie.poster_path}`);
  if (movie.backdrop_path) params.set("backdrop", `${BACKDROP_BASE}${movie.backdrop_path}`);
  if (movie.release_date) params.set("release", movie.release_date);

  return `/player.html?${params.toString()}`;
}

function createMovieCard(movie) {
  if (!movie?.id) return null;
  const rating = Number(movie.vote_average || 0);
  const facts = [];
  const year = (movie.release_date || "").slice(0, 4);
  if (year) facts.push(year);
  if (rating > 0 && movie.vote_count > 0) facts.push(`Rating ${rating.toFixed(1)}`);

  return createMediaCard({
    href: buildMovieUrl(movie),
    title: movie.title || movie.original_title || movie.name || "Untitled",
    imageSrc: movie.poster_path ? IMG_BASE + movie.poster_path : "",
    imageAlt: `${movie.title || movie.name || "Movie"} poster`,
    badgeText: movie.vote_count > 0 && rating > 0 ? rating.toFixed(1) : "",
    factsText: joinFacts(facts),
    ariaLabel: `Stream ${movie.title || movie.name || "movie"} on theblackbox`,
    actionLabel: "Watch now",
    actionIconPath: ACTION_ICONS.play,
    dataset: {
      tmdbId: movie.id,
      mode: "movie",
    },
  });
}

function createShowCard(show) {
  if (!show?.id) return null;
  const rating = Number(show.vote_average || 0);
  const facts = [];
  const year = (show.first_air_date || "").slice(0, 4);
  if (year) facts.push(year);
  if (rating > 0 && show.vote_count > 0) facts.push(`Rating ${rating.toFixed(1)}`);
  if (Array.isArray(show.origin_country) && show.origin_country.length) {
    facts.push(show.origin_country[0]);
  }

  return createMediaCard({
    href: `/series_detail.html?id=${encodeURIComponent(show.id)}`,
    title: show.name || show.original_name || show.title || "Untitled",
    imageSrc: show.poster_path ? IMG_BASE + show.poster_path : "",
    imageAlt: `${show.name || show.original_name || "Show"} poster`,
    badgeText: show.vote_count > 0 && rating > 0 ? rating.toFixed(1) : "",
    factsText: joinFacts(facts),
    ariaLabel: `Open details for ${show.name || show.original_name || "show"}`,
    actionLabel: "Browse seasons",
    actionIconPath: ACTION_ICONS.browse,
    dataset: {
      tmdbId: show.id,
      mode: "tv",
      season: "1",
      episode: "1",
    },
  });
}

function updateDocumentMeta(query) {
  if (query) {
    document.title = `Search "${query}" \u00b7 theblackbox`;
  } else {
    document.title = "Search \u00b7 theblackbox";
  }
}

function syncUrl(query) {
  const url = new URL(window.location.href);
  if (query) {
    url.searchParams.set("q", query);
  } else {
    url.searchParams.delete("q");
  }
  url.searchParams.set("scope", state.scope);
  history.replaceState({}, "", url);
}

function syncScopeButtons() {
  scopeButtons.forEach((button) => {
    const isActive = button.dataset.searchScope === state.scope;
    button.classList.toggle("btn--primary", isActive);
    button.classList.toggle("btn--ghost", !isActive);
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-selected", isActive ? "true" : "false");
    button.tabIndex = isActive ? 0 : -1;
  });
}

function applyScopeLayout() {
  if (!movieGroup || !showGroup || !movieGroup.parentElement) return;
  const parent = movieGroup.parentElement;
  if (state.scope === "tv") {
    parent.appendChild(showGroup);
    parent.appendChild(movieGroup);
  } else {
    parent.appendChild(movieGroup);
    parent.appendChild(showGroup);
  }
  syncScopeButtons();
}

async function performSearch(rawQuery) {
  const query = sanitizeQuery(rawQuery);
  if (!searchInput) return;

  searchInput.value = query;
  updateDocumentMeta(query);
  syncUrl(query);

  if (!query) {
    setStatus("Start typing to search across movies and shows.");
    updateResultGroup(movieList, movieEmpty, movieCount, [], createMovieCard);
    updateResultGroup(showList, showEmpty, showCount, [], createShowCard);
    return;
  }

  if (activeController) {
    activeController.abort();
  }
  activeController = new AbortController();
  const { signal } = activeController;

  setStatus(`Searching for "${query}"...`);
  document.body.classList.add("is-searching");

  try {
    const [movieData, showData] = await Promise.all([
      requestTmdb(
        "search/movie",
        { query, include_adult: "false", language: "en-US", page: "1" },
        { signal },
      ),
      requestTmdb(
        "search/tv",
        { query, include_adult: "false", language: "en-US", page: "1" },
        { signal },
      ),
    ]);

    const movieResults = Array.isArray(movieData.results)
      ? movieData.results.filter((item) => item?.id).slice(0, 20)
      : [];
    const showResults = Array.isArray(showData.results)
      ? showData.results.filter((item) => item?.id).slice(0, 20)
      : [];

    updateResultGroup(movieList, movieEmpty, movieCount, movieResults, createMovieCard);
    updateResultGroup(showList, showEmpty, showCount, showResults, createShowCard);

    if (!movieResults.length && !showResults.length) {
      setStatus(`No results found for "${query}". Try a different keyword.`);
    } else {
      const total = movieResults.length + showResults.length;
      const primaryLabel = state.scope === "tv" ? "shows" : "movies";
      setStatus(
        `Showing ${total} match${total === 1 ? "" : "es"} for "${query}" with ${primaryLabel} first.`,
      );
    }
  } catch (error) {
    if (error.name === "AbortError") return;
    console.error(error);
    setStatus("Unable to search right now. Please try again shortly.");
  } finally {
    document.body.classList.remove("is-searching");
    if (activeController?.signal === signal) {
      activeController = null;
    }
  }
}

function updateScope(scope) {
  state.scope = normalizeScope(scope);
  applyScopeLayout();
  syncUrl(searchInput?.value || "");
}

function handleSubmit(event) {
  if (!searchInput) return;
  event.preventDefault();

  const query = sanitizeQuery(searchInput.value);
  if (!query) {
    setStatus("Enter a title, actor, or keyword to begin searching.");
    searchInput.focus();
    return;
  }

  performSearch(query);
}

function scheduleSearch(rawQuery) {
  window.clearTimeout(searchDebounceId);
  searchDebounceId = window.setTimeout(() => {
    performSearch(rawQuery);
  }, SEARCH_DEBOUNCE_MS);
}

function applyInitialQuery() {
  if (!searchInput) return;
  const url = new URL(window.location.href);
  state.scope = normalizeScope(url.searchParams.get("scope"));
  applyScopeLayout();

  const initial = sanitizeQuery(url.searchParams.get("q"));
  if (initial) {
    searchInput.value = initial;
    performSearch(initial);
  } else {
    setStatus("Start typing to search across movies and shows.");
  }
}

function init() {
  scopeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      updateScope(button.dataset.searchScope);
      if (searchInput?.value) {
        performSearch(searchInput.value);
      }
    });
  });

  if (searchForm) {
    searchForm.addEventListener("submit", handleSubmit);
  }

  if (searchInput) {
    searchInput.addEventListener("input", (event) => {
      scheduleSearch(event.target.value);
    });
    searchInput.addEventListener("search", (event) => {
      performSearch(event.target.value);
    });
  }

  applyInitialQuery();
}

document.addEventListener("DOMContentLoaded", init);
