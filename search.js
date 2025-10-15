import { setupPreviewForGrid } from "./preview_manager.js";
import { BACKDROP_BASE, IMG_BASE, requestTmdb } from "./tmdb_client.js";

const searchForm = document.getElementById("searchForm");
const searchInput = document.getElementById("search");
const statusLine = document.getElementById("searchStatus");
const movieList = document.getElementById("movieResults");
const showList = document.getElementById("showResults");
const movieCount = document.getElementById("movieCount");
const showCount = document.getElementById("showCount");
const movieEmpty = document.getElementById("movieEmpty");
const showEmpty = document.getElementById("showEmpty");

if (movieList) {
  setupPreviewForGrid(movieList, { mode: "movie" });
}
if (showList) {
  setupPreviewForGrid(showList, { mode: "tv" });
}

let activeController = null;

function sanitizeQuery(value) {
  return (value || "").replace(/\s+/g, " ").trim();
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
  const card = document.createElement("a");
  card.className = "card";
  card.href = buildMovieUrl(movie);
  card.dataset.tmdbId = movie.id;
  card.dataset.mode = "movie";
  card.setAttribute("aria-label", `Stream ${movie.title || movie.name || "movie"} on theblackbox`);

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

  const facts = [];
  const year = (movie.release_date || "").slice(0, 4);
  if (year) facts.push(year);
  if (rating > 0 && movie.vote_count > 0) facts.push(`⭐ ${rating.toFixed(1)}`);
  if (facts.length) {
    const sub = document.createElement("p");
    sub.className = "sub";
    sub.textContent = facts.join(" • ");
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

function createShowCard(show) {
  const card = document.createElement("a");
  card.className = "card";
  card.href = `/series_detail.html?id=${encodeURIComponent(show.id)}`;
  card.dataset.tmdbId = show.id;
  card.dataset.mode = "tv";
  card.dataset.season = "1";
  card.dataset.episode = "1";
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

  const facts = [];
  const year = (show.first_air_date || "").slice(0, 4);
  if (year) facts.push(year);
  if (rating > 0 && show.vote_count > 0) facts.push(`⭐ ${rating.toFixed(1)}`);
  if (Array.isArray(show.origin_country) && show.origin_country.length) {
    facts.push(show.origin_country[0]);
  }
  if (facts.length) {
    const sub = document.createElement("p");
    sub.className = "sub";
    sub.textContent = facts.join(" • ");
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

function updateGroup(listEl, emptyEl, countEl, items, createCardFn) {
  if (!listEl || !emptyEl || !countEl) return;
  listEl.innerHTML = "";
  if (!items.length) {
    emptyEl.hidden = false;
    countEl.textContent = "";
    return;
  }
  emptyEl.hidden = true;
  const fragment = document.createDocumentFragment();
  for (const item of items) {
    fragment.appendChild(createCardFn(item));
  }
  listEl.appendChild(fragment);
  countEl.textContent = `${items.length} match${items.length === 1 ? "" : "es"}`;
}

function updateDocumentMeta(query) {
  if (query) {
    document.title = `Search “${query}” · theblackbox`;
  } else {
    document.title = "Search · theblackbox";
  }
}

function syncUrl(query) {
  const url = new URL(window.location.href);
  if (query) {
    url.searchParams.set("q", query);
  } else {
    url.searchParams.delete("q");
  }
  history.replaceState({}, "", url);
}

async function performSearch(rawQuery) {
  const query = sanitizeQuery(rawQuery);
  if (!searchInput) return;
  searchInput.value = query;
  updateDocumentMeta(query);
  syncUrl(query);

  if (!query) {
    setStatus("Start typing to search across movies and shows.");
    updateGroup(movieList, movieEmpty, movieCount, [], createMovieCard);
    updateGroup(showList, showEmpty, showCount, [], createShowCard);
    return;
  }

  if (activeController) {
    activeController.abort();
  }
  activeController = new AbortController();
  const { signal } = activeController;

  setStatus(`Searching for “${query}”…`);
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
      ? movieData.results.filter((item) => item && item.id).slice(0, 20)
      : [];
    const showResults = Array.isArray(showData.results)
      ? showData.results.filter((item) => item && item.id).slice(0, 20)
      : [];

    updateGroup(movieList, movieEmpty, movieCount, movieResults, createMovieCard);
    updateGroup(showList, showEmpty, showCount, showResults, createShowCard);

    if (!movieResults.length && !showResults.length) {
      setStatus(`No results found for “${query}”. Try a different keyword.`);
    } else {
      const total = movieResults.length + showResults.length;
      setStatus(`Showing ${total} match${total === 1 ? "" : "es"} for “${query}”.`);
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

function applyInitialQuery() {
  if (!searchInput) return;
  const url = new URL(window.location.href);
  const initial = sanitizeQuery(url.searchParams.get("q"));
  if (initial) {
    searchInput.value = initial;
    performSearch(initial);
  } else {
    setStatus("Start typing to search across movies and shows.");
  }
}

function init() {
  if (searchForm) {
    searchForm.addEventListener("submit", handleSubmit);
  }
  if (searchInput) {
    searchInput.addEventListener("search", (event) => {
      performSearch(event.target.value);
    });
  }
  applyInitialQuery();
}

document.addEventListener("DOMContentLoaded", init);
