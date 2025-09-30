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

function buildPlayerUrl(show) {
  const params = new URLSearchParams({
    vk: "tv",
    tmdb: String(show.id),
    title: show.name || show.original_name || "Series",
    season: "1",
    episode: "1",
    nextEpisode: "true",
    episodeSelector: "true",
    autoPlay: "true",
    color: "3ba0ff",
  });
  if (show.poster_path) {
    params.set("poster", IMG_BASE + show.poster_path);
  }
  return `/player?${params.toString()}`;
}

function createCard(show) {
  const title = show.name || show.original_name || "Untitled";
  const year = (show.first_air_date || "").slice(0, 4);
  const rating = Number(show.vote_average || 0).toFixed(1);
  const hasRating = Number(show.vote_count || 0) > 0;
  const overview = truncate(show.overview, 140);
  const posterUrl = show.poster_path ? IMG_BASE + show.poster_path : null;

  const link = document.createElement("a");
  link.className = "card";
  link.href = buildPlayerUrl(show);
  link.target = "_blank";
  link.rel = "noopener";
  link.dataset.tmdbId = show.id;
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
      <div class="actions"><span class="watch">▶ Stream on VidKing</span></div>
    </div>
  `;

  return link;
}

function render(list = []) {
  grid.innerHTML = "";
  const fragment = document.createDocumentFragment();
  let count = 0;
  for (const show of list) {
    if (!show || !show.id) continue;
    fragment.appendChild(createCard(show));
    count += 1;
  }
  if (!count) {
    showMessage("No shows found.");
    return;
  }
  grid.appendChild(fragment);
}

async function loadTrending() {
  showMessage("Loading trending series…");
  try {
    const data = await requestTmdb("trending/tv/week");
    render(data.results || []);
  } catch (err) {
    if (err.name === "AbortError") return;
    console.error(err);
    showMessage("Unable to load trending series right now.");
  }
}

async function searchSeries(query) {
  if (!query) {
    loadTrending();
    return;
  }
  showMessage(`Searching for “${escapeHTML(query)}”…`);
  try {
    const data = await requestTmdb("search/tv", { query });
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
    searchTimer = setTimeout(() => searchSeries(value), 350);
  });
}

document.addEventListener("DOMContentLoaded", loadTrending);
