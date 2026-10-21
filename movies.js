import { getEntriesByMode, onHistoryChange } from "./continue_watching.js?v=11";
import {
  formatRelativeTime,
  getRecentlyWatchedByMode,
  onRecentlyChange,
} from "./recently_watched.js?v=11";
import { getTheaterHistoryByMode, onTheaterHistoryChange } from "./theater_history.js?v=1";
import { setupPreviewForGrid } from "./preview_manager.js";
import { setupAnimatedList } from "./ui_effects.js?v=16";
import {
  ACTION_ICONS,
  createCarouselSection as createSharedCarouselSection,
  createContinueProgressCard,
  createMediaCard,
  enableScrollerGestureGuard,
  joinFacts,
  renderCarouselItems,
  setCarouselLoading,
  setCarouselMessage,
} from "./catalog_ui.js?v=5";
import { BACKDROP_BASE, IMG_BASE, requestTmdb } from "./tmdb_client.js?v=17";

const continueSection = document.getElementById("continueMovies");
const continueList = document.getElementById("continueMoviesList");
const continueMessage = document.getElementById("continueMoviesMessage");
const watchAgainSection = document.getElementById("watchAgainMovies");
const watchAgainList = document.getElementById("watchAgainMoviesList");
const watchAgainMessage = document.getElementById("watchAgainMoviesMessage");
const theaterSection = document.getElementById("theaterMovies");
const theaterList = document.getElementById("theaterMoviesList");
const theaterMessage = document.getElementById("theaterMoviesMessage");
const carouselList = document.getElementById("carouselList");
const searchForm = document.getElementById("searchForm");
const searchInput = document.getElementById("search");

const ROW_TARGET = 18;
const MAX_FETCH_PAGES = 8;
const SEARCH_REDIRECT_DEBOUNCE_MS = 900;
const WATCH_AGAIN_DELAY_MS = 14 * 24 * 60 * 60 * 1000;
const WATCH_AGAIN_LIMIT = 12;

const CAROUSELS = [
  { id: "trending", label: "Trending now", path: "trending/movie/week" },
  { id: "popular", label: "Popular on theblackbox", path: "movie/popular" },
  { id: "top_rated", label: "Critically acclaimed", path: "movie/top_rated" },
  { id: "now_playing", label: "Fresh in theaters", path: "movie/now_playing" },
  { id: "upcoming", label: "Coming soon", path: "movie/upcoming" },
  {
    id: "action_thrillers",
    label: "Pulse-pounding action",
    path: "discover/movie",
    params: { with_genres: "28,53", sort_by: "popularity.desc" },
  },
  {
    id: "family_favorites",
    label: "Family favorites",
    path: "discover/movie",
    params: { with_genres: "16,10751", sort_by: "popularity.desc" },
  },
  {
    id: "comedies",
    label: "Feel-good comedies",
    path: "discover/movie",
    params: { with_genres: "35", sort_by: "popularity.desc" },
  },
  {
    id: "documentaries",
    label: "Documentary deep dives",
    path: "discover/movie",
    params: { with_genres: "99", sort_by: "popularity.desc" },
  },
];

const carouselStates = new Map();
const suggestedItemIds = new Set();
let suggestionsController = null;
let searchRedirectTimer = 0;
let disposeMoviesPage = null;

function buildMovieFacts(movie) {
  const facts = [];
  const year = (movie.release_date || "").slice(0, 4);
  if (year) facts.push(year);

  const rating = Number(movie.vote_average || 0);
  if (movie.vote_count > 0 && rating > 0) {
    facts.push(`\u2605 ${rating.toFixed(1)}`);
  }

  if (movie.original_language && movie.original_language !== "en") {
    facts.push(movie.original_language.toUpperCase());
  }

  return joinFacts(facts);
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

function buildTheaterSeedUrl(movie) {
  const params = new URLSearchParams({
    seedTmdb: String(movie.id),
    seedTitle: movie.title || movie.original_title || "Movie",
  });
  if (movie.poster_path) {
    params.set("seedPoster", `${IMG_BASE}${movie.poster_path}`);
  }
  if (movie.backdrop_path) {
    params.set("seedBackdrop", `${BACKDROP_BASE}${movie.backdrop_path}`);
  }
  if (movie.release_date) {
    params.set("seedRelease", movie.release_date);
  }
  return `/theater.html?${params.toString()}`;
}

function wrapMovieCard(card, movie) {
  if (!card || !movie?.id) return card;
  const shell = document.createElement("div");
  shell.className = "card-stack";
  shell.appendChild(card);

  const link = document.createElement("a");
  link.className = "btn btn--ghost card-stack__action";
  link.href = buildTheaterSeedUrl(movie);
  link.textContent = "Watch together";
  shell.appendChild(link);
  return shell;
}

function createCard(movie) {
  if (!movie?.id) return null;
  const rating = Number(movie.vote_average || 0);
  const card = createMediaCard({
    href: buildPlayerUrl(movie),
    title: movie.title || movie.original_title || movie.name || "Untitled",
    imageSrc: movie.poster_path ? IMG_BASE + movie.poster_path : "",
    imageAlt: `${movie.title || movie.name || "Movie"} poster`,
    badgeText: movie.vote_count > 0 && rating > 0 ? rating.toFixed(1) : "",
    factsText: buildMovieFacts(movie),
    ariaLabel: `Stream ${movie.title || movie.name || "movie"} on theblackbox`,
    actionLabel: "Watch now",
    actionIconPath: ACTION_ICONS.play,
    dataset: {
      tmdbId: movie.id,
      mode: "movie",
    },
  });
  return wrapMovieCard(card, movie);
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
  let percent = 0;
  if (entry.runtime && entry.progress) {
    percent = Math.min(100, Math.round((entry.progress / entry.runtime) * 100));
  } else if (entry.progress) {
    percent = 5;
  }

  return createContinueProgressCard({
    href: buildResumeUrl(entry),
    title: entry.title || "Untitled",
    imageSrc: entry.poster || "",
    imageAlt: `${entry.title || "Movie"} artwork`,
    progressPercent: percent,
    resumeText: entry.progress ? `Resume from ${formatTime(entry.progress)}` : "Start over",
    ariaLabel: entry.progress
      ? `Resume ${entry.title || "movie"} from ${formatTime(entry.progress)}`
      : `Start ${entry.title || "movie"} from the beginning`,
    dataset: {
      mode: entry.mode,
      tmdbId: entry.tmdb,
    },
  });
}

function getWatchAgainEntries() {
  const activeMovieIds = new Set(getEntriesByMode("movie").map((entry) => entry?.id).filter(Boolean));
  return getRecentlyWatchedByMode("movie")
    .filter((entry) => {
      if (!entry?.tmdb || !entry?.completed) return false;
      if (activeMovieIds.has(`movie:${entry.tmdb}`)) return false;
      const lastPlayedAt = Number(entry.lastPlayedAt) || 0;
      return lastPlayedAt > 0 && Date.now() - lastPlayedAt >= WATCH_AGAIN_DELAY_MS;
    })
    .slice(0, WATCH_AGAIN_LIMIT);
}

function createWatchAgainCard(entry) {
  return createContinueProgressCard({
    href:
      entry.href ||
      `/player.html?mode=movie&tmdb=${encodeURIComponent(entry.tmdb)}&title=${encodeURIComponent(
        entry.title || "Movie",
      )}&autoplay=true&color=14ff9f`,
    title: entry.title || "Untitled",
    imageSrc: entry.poster || "",
    imageAlt: `${entry.title || "Movie"} artwork`,
    progressPercent: 0,
    resumeText: `Watched ${formatRelativeTime(entry.lastPlayedAt) || "previously"}`,
    ariaLabel: `Play ${entry.title || "movie"} again`,
    dataset: {
      mode: entry.mode,
      tmdbId: entry.tmdb,
      revisit: "true",
    },
    showProgressBar: false,
  });
}

function renderContinueWatching() {
  if (!continueSection || !continueList) return;

  const entries = getEntriesByMode("movie").slice(0, 12);
  continueSection.hidden = false;
  continueList.innerHTML = "";

  if (!entries.length) {
    continueSection.classList.add("continue--empty");
    if (continueMessage) {
      continueMessage.hidden = false;
      continueMessage.textContent =
        "Start watching a movie to see it appear here. Progress saves automatically on this device.";
    }
    return;
  }

  continueSection.classList.remove("continue--empty");
  if (continueMessage) {
    continueMessage.hidden = true;
  }

  const fragment = document.createDocumentFragment();
  entries.forEach((entry) => {
    const card = createContinueCard(entry);
    if (card) {
      fragment.appendChild(card);
    }
  });
  continueList.appendChild(fragment);
}

function renderTheaterHistory() {
  if (!theaterSection || !theaterList) return;
  const entries = getTheaterHistoryByMode("movie", 12);
  theaterSection.hidden = false;
  theaterList.innerHTML = "";
  if (!entries.length) {
    theaterSection.classList.add("continue--empty");
    if (theaterMessage) {
      theaterMessage.hidden = false;
      theaterMessage.textContent = "Watch a movie in a theater room to build this rail.";
    }
    return;
  }
  theaterSection.classList.remove("continue--empty");
  if (theaterMessage) {
    theaterMessage.hidden = true;
  }
  const fragment = document.createDocumentFragment();
  entries.forEach((entry) => {
    const card = createContinueProgressCard({
      href:
        entry.href ||
        `/player.html?mode=movie&tmdb=${encodeURIComponent(entry.tmdb)}&title=${encodeURIComponent(
          entry.title || "Movie",
        )}&autoplay=true&color=14ff9f`,
      title: entry.title || "Untitled",
      imageSrc: entry.poster || "",
      imageAlt: `${entry.title || "Movie"} artwork`,
      progressPercent: 0,
      resumeText: `Shared screening · ${formatRelativeTime(entry.lastPlayedAt) || "recently"}`,
      ariaLabel: `Play ${entry.title || "movie"} again`,
      dataset: {
        mode: entry.mode,
        tmdbId: entry.tmdb,
        theater: "true",
      },
      showProgressBar: false,
    });
    if (card) fragment.appendChild(card);
  });
  theaterList.appendChild(fragment);
}

function renderWatchAgain() {
  if (!watchAgainSection || !watchAgainList) return;

  const entries = getWatchAgainEntries();
  watchAgainSection.hidden = false;
  watchAgainList.innerHTML = "";

  if (!entries.length) {
    watchAgainSection.classList.add("continue--empty");
    if (watchAgainMessage) {
      watchAgainMessage.hidden = false;
      watchAgainMessage.textContent =
        "Completed movies you have not revisited for a couple of weeks will surface here.";
    }
    return;
  }

  watchAgainSection.classList.remove("continue--empty");
  if (watchAgainMessage) {
    watchAgainMessage.hidden = true;
  }

  const fragment = document.createDocumentFragment();
  entries.forEach((entry) => {
    const card = createWatchAgainCard(entry);
    if (card) {
      fragment.appendChild(card);
    }
  });
  watchAgainList.appendChild(fragment);
}

function createCarouselSection(definition) {
  const state = createSharedCarouselSection({
    definition,
    container: carouselList,
    previewMode: "movie",
    setupPreviewForGrid,
    setupAnimatedList,
  });
  if (!state) return null;

  carouselStates.set(definition.id, state);
  return state;
}

async function fetchCarouselItems(definition) {
  return fetchCarouselItemsWithReserved(definition, new Set());
}

async function fetchCarouselItemsWithReserved(definition, reservedIds = new Set()) {
  const items = [];
  const rowIds = new Set();
  const params = { ...(definition.params || {}) };
  let page = 1;
  let totalPages = 1;

  while (items.length < ROW_TARGET && page <= MAX_FETCH_PAGES && page <= totalPages) {
    const response = await requestTmdb(definition.path, { ...params, page: String(page) });
    totalPages = Number(response.total_pages) || totalPages || 1;

    const results = Array.isArray(response.results) ? response.results : [];
    for (const result of results) {
      if (!result?.id || rowIds.has(result.id) || reservedIds.has(result.id)) continue;
      rowIds.add(result.id);
      items.push(result);
      if (items.length >= ROW_TARGET) break;
    }

    if (!results.length) break;
    page += 1;
  }

  return items;
}

async function loadCarousel(definition) {
  return loadCarouselWithReserved(definition, new Set());
}

async function loadCarouselWithReserved(definition, reservedIds = new Set()) {
  let state = carouselStates.get(definition.id);
  if (!state) {
    state = createCarouselSection(definition);
  }
  if (!state) return [];

  setCarouselMessage(state, "");
  setCarouselLoading(state, true, `Loading titles\u2026`);

  try {
    const items = await fetchCarouselItemsWithReserved(definition, reservedIds);
    if (!items.length) {
      renderCarouselItems(state, [], createCard);
      setCarouselMessage(state, "No titles available right now. Please check back soon.");
      setCarouselLoading(state, false);
      return [];
    }

    renderCarouselItems(state, items, createCard);
    setCarouselMessage(state, "");
    setCarouselLoading(state, false);
    return items;
  } catch (error) {
    console.error(error);
    renderCarouselItems(state, [], createCard);
    setCarouselMessage(state, "Unable to load this row right now. Retry shortly.");
    setCarouselLoading(state, false);
    return [];
  }
}

function clearSuggestedReservations() {
  suggestedItemIds.clear();
}

function reserveItemIds(target, items) {
  items.forEach((item) => {
    if (item?.id) target.add(item.id);
  });
}
async function fetchSuggestedFromHistory(historyEntries, { signal } = {}) {
  const suggestions = [];
  const seenSources = new Set();

  for (const entry of historyEntries) {
    if (!entry?.tmdb || seenSources.has(entry.tmdb)) continue;
    seenSources.add(entry.tmdb);

    const endpoints = [`movie/${entry.tmdb}/recommendations`, `movie/${entry.tmdb}/similar`];
    for (const endpoint of endpoints) {
      if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      try {
        const payload = await requestTmdb(endpoint, { page: "1" }, { signal });
        const results = Array.isArray(payload.results) ? payload.results : [];
        for (const result of results) {
          if (!result?.id) continue;
          if (suggestions.some((item) => item?.id === result.id)) continue;
          suggestions.push(result);
          if (suggestions.length >= ROW_TARGET) break;
        }
      } catch (error) {
        if (error.name === "AbortError") throw error;
        console.warn(`Unable to load suggestions from ${endpoint}`, error);
      }

      if (suggestions.length >= ROW_TARGET) break;
    }

    if (suggestions.length >= ROW_TARGET) break;
  }

  return suggestions;
}

async function loadSuggestedRow() {
  const historyEntries = getEntriesByMode("movie");
  const removeSuggestedRow = () => {
    const existing = carouselStates.get("suggested");
    if (existing) {
      existing.section.remove();
      carouselStates.delete("suggested");
    }
  };
  if (!historyEntries.length) {
    clearSuggestedReservations();
    removeSuggestedRow();
    return;
  }

  if (suggestionsController) {
    suggestionsController.abort();
  }
  const controller = new AbortController();
  suggestionsController = controller;

  clearSuggestedReservations();

  try {
    const items = await fetchSuggestedFromHistory(historyEntries, {
      signal: controller.signal,
    });
    if (suggestionsController !== controller) return;

    if (!items.length) {
      removeSuggestedRow();
      return;
    }

    let state = carouselStates.get("suggested");
    if (!state) {
      state = createCarouselSection({ id: "suggested", label: "Suggested for you" });
      if (state) {
        carouselList?.prepend(state.section);
      }
    }
    if (!state) {
      suggestionsController = null;
      return;
    }

    renderCarouselItems(state, items, createCard);
    reserveItemIds(suggestedItemIds, items);
    setCarouselMessage(state, "");
    setCarouselLoading(state, false);
  } catch (error) {
    if (error.name !== "AbortError") {
      console.error("Unable to build suggested row", error);
      removeSuggestedRow();
    }
  } finally {
    if (suggestionsController === controller) {
      suggestionsController = null;
    }
  }
}

function primeCarousels() {
  CAROUSELS.forEach((definition) => {
    let state = carouselStates.get(definition.id);
    if (!state) {
      state = createCarouselSection(definition);
    }
    if (!state) return;
    setCarouselMessage(state, "");
    setCarouselLoading(state, true, `Loading titles\u2026`);
  });
}

async function loadStandardCarousels() {
  const reservedIds = new Set(suggestedItemIds);
  for (const definition of CAROUSELS) {
    const items = await loadCarouselWithReserved(definition, reservedIds);
    reserveItemIds(reservedIds, items);
  }
}

function initCarousels() {
  primeCarousels();
  loadSuggestedRow()
    .catch((error) => {
      if (error.name !== "AbortError") {
        console.error("Failed to prepare suggestions", error);
      }
    })
    .finally(() => {
      loadStandardCarousels().catch((error) => {
        console.error("Failed to prepare movie rows", error);
      });
    });
}

function initSearchRedirect() {
  if (!searchForm || !searchInput) return;

  const navigateToSearch = (value) => {
    const query = encodeURIComponent(value);
    window.location.href = `/search.html?q=${query}&scope=movie`;
  };

  const handleSubmit = (event) => {
    const value = searchInput.value.trim();
    if (!value) {
      event.preventDefault();
      return;
    }

    event.preventDefault();
    window.clearTimeout(searchRedirectTimer);
    navigateToSearch(value);
  };

  const handleInput = (event) => {
    const value = event.target.value.trim();
    window.clearTimeout(searchRedirectTimer);
    if (!value) return;
    searchRedirectTimer = window.setTimeout(() => {
      navigateToSearch(value);
    }, SEARCH_REDIRECT_DEBOUNCE_MS);
  };

  searchForm.addEventListener("submit", handleSubmit);
  searchInput.addEventListener("input", handleInput);

  return () => {
    searchForm.removeEventListener("submit", handleSubmit);
    searchInput.removeEventListener("input", handleInput);
    window.clearTimeout(searchRedirectTimer);
  };
}

async function initFeatureHero() {
  const content = document.querySelector(".content");
  if (!content) return;

  const existing = content.querySelector(".feature-hero");
  if (existing) existing.remove();

  try {
    const data = await requestTmdb("trending/movie/week", { page: "1" });
    const movies = Array.isArray(data?.results) ? data.results : [];
    const movie = movies.find((m) => m?.backdrop_path && m?.overview) || movies[0];
    if (!movie) return;

    const backdropUrl = movie.backdrop_path
      ? `https://image.tmdb.org/t/p/original${movie.backdrop_path}`
      : "";
    const year = (movie.release_date || "").slice(0, 4);
    const rating = movie.vote_count > 0 ? Number(movie.vote_average || 0).toFixed(1) : "";
    const overview = (movie.overview || "").slice(0, 220).trimEnd();
    const displayOverview = overview.length < (movie.overview || "").length ? overview + "…" : overview;
    const playerUrl = buildPlayerUrl(movie);

    const hero = document.createElement("section");
    hero.className = "feature-hero";
    hero.setAttribute("aria-label", `Featured: ${movie.title || movie.name || "Movie"}`);
    hero.innerHTML = `
      <div class="feature-hero__backdrop"${backdropUrl ? ` style="background-image:url('${backdropUrl.replace(/'/g, "%27")}')"` : ""}></div>
      <div class="feature-hero__gradient"></div>
      <div class="feature-hero__content">
        <p class="feature-hero__eyebrow">Featured today</p>
        <h2 class="feature-hero__title">${movie.title || movie.name || "Untitled"}</h2>
        <div class="feature-hero__meta">
          ${year ? `<span class="feature-hero__year">${year}</span>` : ""}
          ${rating ? `<span class="feature-hero__rating">★ ${rating}</span>` : ""}
        </div>
        ${displayOverview ? `<p class="feature-hero__overview">${displayOverview}</p>` : ""}
        <div class="feature-hero__actions">
          <a class="btn btn--primary feature-hero__btn" href="${playerUrl}">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7L8 5z"/></svg>
            Watch Now
          </a>
        </div>
      </div>`;

    const carouselEl = document.getElementById("carouselList");
    if (carouselEl) {
      content.insertBefore(hero, carouselEl);
    } else {
      content.prepend(hero);
    }
  } catch (error) {
    console.warn("Feature hero failed:", error);
  }
}

export function initMoviesPage() {
  if (typeof disposeMoviesPage === "function") {
    disposeMoviesPage();
  }

  if (continueList) {
    setupPreviewForGrid(continueList, { mode: "movie" });
    setupAnimatedList(continueList, { axis: "x" });
    enableScrollerGestureGuard(continueList);
  }
  if (watchAgainList) {
    setupPreviewForGrid(watchAgainList, { mode: "movie" });
    setupAnimatedList(watchAgainList, { axis: "x" });
    enableScrollerGestureGuard(watchAgainList);
  }

  renderContinueWatching();
  renderWatchAgain();
  renderTheaterHistory();
  initFeatureHero().catch(() => {});

  const removeHistoryListener = onHistoryChange(() => {
    renderContinueWatching();
    renderWatchAgain();
    loadSuggestedRow().catch((error) => {
      if (error.name !== "AbortError") {
        console.error("Failed to refresh suggestions", error);
      }
    });
  });
  const removeRecentlyListener = onRecentlyChange(() => {
    renderWatchAgain();
  });
  const removeTheaterHistoryListener = onTheaterHistoryChange(() => {
    renderTheaterHistory();
  });

  initCarousels();
  const removeSearchRedirect = initSearchRedirect();

  disposeMoviesPage = () => {
    removeHistoryListener?.();
    removeRecentlyListener?.();
    removeTheaterHistoryListener?.();
    removeSearchRedirect?.();
    window.clearTimeout(searchRedirectTimer);
    suggestionsController?.abort();
    suggestionsController = null;
  };

  return disposeMoviesPage;
}
