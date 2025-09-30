const IMG_BASE = "https://image.tmdb.org/t/p/w500";
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_API_KEY = "b7d1cc8554fcab41e013428e2dc418de";

const grid = document.getElementById("grid");
const search = document.getElementById("search");
let currentController = null;
let searchTimer = null;

function escapeHTML(str = "") {
  return String(str).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[ch]);
}

function truncate(str = "", max = 160) {
  const clean = String(str).trim();
  if (!clean) return "";
  return clean.length > max ? clean.slice(0, max - 1).trimEnd() + "…" : clean;
}

async function fetchAndParse(url, controller, headers = {}) {
  const res = await fetch(url, {
    cache: "no-store",
    headers,
    signal: controller.signal,
  });

  const text = await res.text();
  if (!res.ok) {
    const detail = text || `status ${res.status}`;
    throw new Error(`TMDB request failed: ${detail}`);
  }

  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch (err) {
    throw new Error("TMDB returned invalid JSON");
  }
}

async function requestTmdb(path, params = {}) {
  const cleanPath = String(path || "").replace(/^\/+/, "");
  const query = new URLSearchParams(params);

  if (currentController) currentController.abort();
  const controller = new AbortController();
  currentController = controller;

  try {
    try {
      const proxyUrl = `/api/tmdb/${cleanPath}${query.toString() ? `?${query}` : ""}`;
      return await fetchAndParse(proxyUrl, controller);
    } catch (err) {
      if (err.name === "AbortError") throw err;
      console.warn("Proxy TMDB request failed, retrying direct", err);
    }

    const direct = new URL(`${TMDB_BASE}/${cleanPath}`);
    for (const [key, value] of query.entries()) {
      direct.searchParams.set(key, value);
    }
    if (!direct.searchParams.has("api_key")) {
      direct.searchParams.set("api_key", TMDB_API_KEY);
    }

    return await fetchAndParse(direct.toString(), controller, {
      Accept: "application/json",
    });
  } finally {
    if (currentController === controller) {
      currentController = null;
    }
  }
}

function showMessage(text) {
  grid.innerHTML = `<p class="empty">${escapeHTML(text)}</p>`;
}

function buildPlayerUrl(movie) {
  const params = new URLSearchParams({
    vk: "movie",
    tmdb: String(movie.id),
    title: movie.title || movie.original_title || "Movie",
    autoPlay: "true",
    color: "3ba0ff",
  });
  if (movie.poster_path) {
    params.set("poster", IMG_BASE + movie.poster_path);
  }
  return `/player?${params.toString()}`;
}

function createCard(movie) {
  const title = movie.title || movie.original_title || movie.name || "Untitled";
  const year = (movie.release_date || "").slice(0, 4);
  const rating = Number(movie.vote_average || 0).toFixed(1);
  const hasRating = Number(movie.vote_count || 0) > 0;
  const overview = truncate(movie.overview, 140);
  const posterUrl = movie.poster_path ? IMG_BASE + movie.poster_path : null;

  const link = document.createElement("a");
  link.className = "card";
  link.href = buildPlayerUrl(movie);
  link.target = "_blank";
  link.rel = "noopener";
  link.dataset.tmdbId = movie.id;
  link.dataset.title = title;
  link.title = title;

  const facts = [];
  if (year) facts.push(year);
  if (hasRating) facts.push(`⭐ ${rating}`);

  link.innerHTML = `
    <div class="thumb">
      ${posterUrl ? `<img src="${posterUrl}" alt="${escapeHTML(title)} poster">` : `<div class="placeholder">No poster</div>`}
      ${hasRating ? `<span class="badge">${rating}</span>` : ""}
    </div>
    <div class="meta">
      <p class="title">${escapeHTML(title)}</p>
      ${facts.length ? `<p class="sub">${escapeHTML(facts.join(" • "))}</p>` : ""}
      ${overview ? `<p class="overview">${escapeHTML(overview)}</p>` : ""}
      <div class="actions"><span class="watch">▶ Play with VidKing</span></div>
    </div>
  `;

  return link;
}

function render(list = []) {
  grid.innerHTML = "";
  const fragment = document.createDocumentFragment();
  let count = 0;
  for (const movie of list) {
    if (!movie || !movie.id) continue;
    fragment.appendChild(createCard(movie));
    count += 1;
  }
  if (!count) {
    showMessage("No movies found.");
    return;
  }
  grid.appendChild(fragment);
}

async function loadTrending() {
  showMessage("Loading trending movies…");
  try {
    const data = await requestTmdb("trending/movie/week");
    render(data.results || []);
  } catch (err) {
    if (err.name === "AbortError") return;
    console.error(err);
    showMessage("Unable to load trending movies right now.");
  }
}

async function searchMovies(query) {
  if (!query) {
    loadTrending();
    return;
  }
  showMessage(`Searching for “${escapeHTML(query)}”…`);
  try {
    const data = await requestTmdb("search/movie", { query });
    render(data.results || []);
  } catch (err) {
    if (err.name === "AbortError") return;
    console.error(err);
    showMessage("Search failed. Please try again in a moment.");
  }
}

if (search) {
  search.addEventListener("input", () => {
    const value = search.value.trim();
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => searchMovies(value), 350);
  });
}

document.addEventListener("DOMContentLoaded", loadTrending);
