import { getEntriesByMode, onHistoryChange } from "./continue_watching.js?v=11";
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
import { IMG_BASE, requestTmdb } from "./tmdb_client.js?v=17";

const continueSection = document.getElementById("continueShows");
const continueList = document.getElementById("continueShowsList");
const continueMessage = document.getElementById("continueShowsMessage");
const theaterSection = document.getElementById("theaterShows");
const theaterList = document.getElementById("theaterShowsList");
const theaterMessage = document.getElementById("theaterShowsMessage");
const carouselList = document.getElementById("carouselList");
const searchForm = document.getElementById("searchForm");
const searchInput = document.getElementById("search");

const ROW_TARGET = 18;
const MAX_FETCH_PAGES = 8;
const SEARCH_REDIRECT_DEBOUNCE_MS = 900;

const CAROUSELS = [
  { id: "trending", label: "Trending series", path: "trending/tv/week" },
  { id: "popular", label: "Popular right now", path: "tv/popular" },
  { id: "top_rated", label: "Top rated shows", path: "tv/top_rated" },
  { id: "airing_today", label: "Airing today", path: "tv/airing_today" },
  { id: "on_the_air", label: "Currently on air", path: "tv/on_the_air" },
  {
    id: "sci_fi",
    label: "Sci-fi & fantasy epics",
    path: "discover/tv",
    params: { with_genres: "10765", sort_by: "popularity.desc" },
  },
  {
    id: "crime_thrillers",
    label: "True crime & thrillers",
    path: "discover/tv",
    params: { with_genres: "80,9648", sort_by: "popularity.desc" },
  },
  {
    id: "animated_adventures",
    label: "Animated adventures",
    path: "discover/tv",
    params: { with_genres: "16", sort_by: "popularity.desc" },
  },
  {
    id: "family_series",
    label: "Family nights",
    path: "discover/tv",
    params: { with_genres: "10751", sort_by: "popularity.desc" },
  },
];

const carouselStates = new Map();
const suggestedSeriesIds = new Set();
let suggestionsController = null;
let searchRedirectTimer = 0;
let disposeSeriesPage = null;

function deriveShowTitle(entry) {
  const rawTitle = typeof entry?.title === "string" ? entry.title.trim() : "";
  if (!rawTitle) return "Untitled";
  const separatorIndex = rawTitle.indexOf(" - ");
  if (separatorIndex > 0) {
    return rawTitle.slice(0, separatorIndex).trim() || rawTitle;
  }
  return rawTitle;
}

function buildSeriesFacts(show) {
  const facts = [];
  const year = (show.first_air_date || "").slice(0, 4);
  if (year) facts.push(year);

  const rating = Number(show.vote_average || 0);
  if (show.vote_count > 0 && rating > 0) {
    facts.push(`\u2605 ${rating.toFixed(1)}`);
  }

  if (Array.isArray(show.origin_country) && show.origin_country.length) {
    facts.push(show.origin_country[0]);
  }

  return joinFacts(facts);
}

function buildSeriesUrl(show) {
  const url = new URL("/series_detail.html", window.location.origin);
  url.searchParams.set("id", show.id);
  return url.pathname + url.search;
}

function createCard(show) {
  if (!show?.id) return null;
  const rating = Number(show.vote_average || 0);
  return createMediaCard({
    href: buildSeriesUrl(show),
    title: show.name || show.original_name || show.title || "Untitled",
    imageSrc: show.poster_path ? IMG_BASE + show.poster_path : "",
    imageAlt: `${show.name || show.original_name || "Show"} poster`,
    badgeText: show.vote_count > 0 && rating > 0 ? rating.toFixed(1) : "",
    factsText: buildSeriesFacts(show),
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

function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const total = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function formatEpisodeLabel(entry) {
  const season = Number(entry.season) || 1;
  const episode = Number(entry.episode) || 1;
  return `S${String(season).padStart(2, "0")} \u2022 E${String(episode).padStart(2, "0")}`;
}

function buildResumeUrl(entry) {
  const params = new URLSearchParams({
    id: String(entry.tmdb || ""),
  });
  if (Number(entry.progress) >= 30) params.set("progress", String(entry.progress));
  if (Number.isFinite(Number(entry.season))) params.set("season", String(entry.season));
  if (Number.isFinite(Number(entry.episode))) params.set("episode", String(entry.episode));
  return `/series_detail.html?${params.toString()}`;
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
    title: deriveShowTitle(entry),
    imageSrc: entry.poster || "",
    imageAlt: `${entry.title || "Show"} artwork`,
    progressPercent: percent,
    resumeText: entry.progress
      ? `${formatEpisodeLabel(entry)} \u2022 Resume from ${formatTime(entry.progress)}`
      : `${formatEpisodeLabel(entry)} \u2022 Start over`,
    ariaLabel: entry.progress
      ? `Open ${entry.title || "show"} details and resume at ${formatTime(entry.progress)}`
      : `Open ${entry.title || "show"} details`,
    dataset: {
      mode: entry.mode,
      tmdbId: entry.tmdb,
      season: entry.season,
      episode: entry.episode,
    },
  });
}

function renderContinueWatching() {
  if (!continueSection || !continueList) return;

  const groupedEntries = new Map();
  getEntriesByMode("tv").forEach((entry) => {
    const key = String(entry?.tmdb || "");
    if (!key) return;
    const existing = groupedEntries.get(key);
    if (!existing || Number(entry.updatedAt || 0) >= Number(existing.updatedAt || 0)) {
      groupedEntries.set(key, entry);
    }
  });
  const entries = [...groupedEntries.values()]
    .sort((left, right) => Number(right?.updatedAt || 0) - Number(left?.updatedAt || 0))
    .slice(0, 12);
  continueSection.hidden = false;
  continueList.innerHTML = "";

  if (!entries.length) {
    continueSection.classList.add("continue--empty");
    if (continueMessage) {
      continueMessage.hidden = false;
      continueMessage.textContent =
        "Start an episode to see it appear here. Progress saves automatically on this device.";
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
  const entries = getTheaterHistoryByMode("tv", 12);
  theaterSection.hidden = false;
  theaterList.innerHTML = "";
  if (!entries.length) {
    theaterSection.classList.add("continue--empty");
    if (theaterMessage) {
      theaterMessage.hidden = false;
      theaterMessage.textContent = "Watch an episode in a theater room to build this rail.";
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
        `/series_detail.html?id=${encodeURIComponent(entry.tmdb)}&season=${encodeURIComponent(
          entry.season || 1,
        )}&episode=${encodeURIComponent(entry.episode || 1)}`,
      title: deriveShowTitle(entry),
      imageSrc: entry.poster || "",
      imageAlt: `${entry.title || "Show"} artwork`,
      progressPercent: 0,
      resumeText: `${formatEpisodeLabel(entry)} · Shared screening`,
      ariaLabel: `Open ${entry.title || "show"} details`,
      dataset: {
        mode: entry.mode,
        tmdbId: entry.tmdb,
        season: entry.season,
        episode: entry.episode,
        theater: "true",
      },
      showProgressBar: false,
    });
    if (card) fragment.appendChild(card);
  });
  theaterList.appendChild(fragment);
}

function createCarouselSection(definition) {
  const state = createSharedCarouselSection({
    definition,
    container: carouselList,
    previewMode: "tv",
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
  setCarouselLoading(state, true, `Loading shows\u2026`);

  try {
    const items = await fetchCarouselItemsWithReserved(definition, reservedIds);
    if (!items.length) {
      renderCarouselItems(state, [], createCard);
      setCarouselMessage(state, "No shows available right now. Please check back soon.");
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
  suggestedSeriesIds.clear();
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

    const endpoints = [`tv/${entry.tmdb}/recommendations`, `tv/${entry.tmdb}/similar`];
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
  const historyEntries = getEntriesByMode("tv");
  const removeSuggestedRow = () => {
    const existing = carouselStates.get("suggested_shows");
    if (existing) {
      existing.section.remove();
      carouselStates.delete("suggested_shows");
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

    let state = carouselStates.get("suggested_shows");
    if (!state) {
      state = createCarouselSection({ id: "suggested_shows", label: "Suggested for you" });
      if (state) {
        carouselList?.prepend(state.section);
      }
    }
    if (!state) {
      suggestionsController = null;
      return;
    }

    renderCarouselItems(state, items, createCard);
    reserveItemIds(suggestedSeriesIds, items);
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
    setCarouselLoading(state, true, `Loading shows\u2026`);
  });
}

async function loadStandardCarousels() {
  const reservedIds = new Set(suggestedSeriesIds);
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
        console.error("Failed to prepare show rows", error);
      });
    });
}

function initSearchRedirect() {
  if (!searchForm || !searchInput) return;

  const navigateToSearch = (value) => {
    const query = encodeURIComponent(value);
    window.location.href = `/search.html?q=${query}&scope=tv`;
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

export function initSeriesPage() {
  if (typeof disposeSeriesPage === "function") {
    disposeSeriesPage();
  }

  if (continueList) {
    setupPreviewForGrid(continueList, { mode: "tv" });
    setupAnimatedList(continueList, { axis: "x" });
    enableScrollerGestureGuard(continueList);
  }

  renderContinueWatching();
  renderTheaterHistory();

  const removeHistoryListener = onHistoryChange(() => {
    renderContinueWatching();
    loadSuggestedRow().catch((error) => {
      if (error.name !== "AbortError") {
        console.error("Failed to refresh suggestions", error);
      }
    });
  });
  const removeTheaterHistoryListener = onTheaterHistoryChange(() => {
    renderTheaterHistory();
  });

  initCarousels();
  const removeSearchRedirect = initSearchRedirect();

  disposeSeriesPage = () => {
    removeHistoryListener?.();
    removeTheaterHistoryListener?.();
    removeSearchRedirect?.();
    window.clearTimeout(searchRedirectTimer);
    suggestionsController?.abort();
    suggestionsController = null;
  };

  return disposeSeriesPage;
}
