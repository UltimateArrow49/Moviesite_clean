const IMG_BASE = "https://image.tmdb.org/t/p/w780";
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_API_KEY = "b7d1cc8554fcab41e013428e2dc418de";

const showTitleEl = document.getElementById("showTitle");
const overviewEl = document.getElementById("overview");
const posterWrap = document.getElementById("posterWrap");
const tagList = document.getElementById("tagList");
const genreList = document.getElementById("genreList");
const seasonList = document.getElementById("seasonList");
const seasonStatus = document.getElementById("seasonStatus");
const episodeList = document.getElementById("episodeList");
const searchInput = document.getElementById("search");
const backButton = document.getElementById("backButton");

let activeRequest = null;
let searchTimer = null;

const state = {
  showId: null,
  show: null,
  seasons: [],
  currentSeason: null,
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

function setSearchNavigation(show) {
  if (!searchInput) return;
  searchInput.placeholder = `Search “${show.name || show.original_name || "series"}” on TMDB`;
  searchInput.addEventListener("input", () => {
    const value = searchInput.value;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const query = value.trim();
      if (!query) return;
      const url = new URL("/series.html", window.location.origin);
      url.searchParams.set("q", query);
      window.location.href = url.toString();
    }, 450);
  });
}

function buildPlayerUrl(seasonNumber, episodeNumber, title) {
  const params = new URLSearchParams({
    mode: "tv",
    tmdb: String(state.showId),
    season: String(seasonNumber),
    episode: String(episodeNumber),
    title,
    nextepisode: "true",
    episodeselector: "true",
    autoplay: "true",
    color: "14ff9f",
  });
  return `/player.html?${params.toString()}`;
}

function renderPoster(show) {
  posterWrap.innerHTML = "";
  if (show.poster_path) {
    const img = document.createElement("img");
    img.src = IMG_BASE + show.poster_path;
    img.alt = `${show.name || show.original_name || "Series"} poster`;
    img.style.width = "100%";
    img.style.borderRadius = "18px";
    img.style.boxShadow = "0 28px 60px rgba(0,0,0,0.6)";
    posterWrap.appendChild(img);
  } else {
    const fallback = document.createElement("div");
    fallback.className = "placeholder";
    fallback.textContent = "No poster available";
    posterWrap.appendChild(fallback);
  }
}

function renderTags(show) {
  tagList.innerHTML = "";
  const tags = [];
  if (show.status) tags.push(show.status);
  if (show.number_of_seasons) tags.push(`${show.number_of_seasons} season${show.number_of_seasons > 1 ? "s" : ""}`);
  if (show.number_of_episodes) tags.push(`${show.number_of_episodes} episodes`);
  if (Array.isArray(show.production_countries) && show.production_countries.length) {
    tags.push(show.production_countries[0].iso_3166_1);
  }
  for (const label of tags) {
    const span = document.createElement("span");
    span.className = "meta-tag";
    span.textContent = label;
    tagList.appendChild(span);
  }
}

function renderGenres(show) {
  genreList.innerHTML = "";
  if (!Array.isArray(show.genres) || !show.genres.length) return;
  for (const genre of show.genres) {
    const span = document.createElement("span");
    span.className = "meta-tag";
    span.textContent = genre.name;
    genreList.appendChild(span);
  }
}

function renderOverview(show) {
  overviewEl.textContent = show.overview ? show.overview : "No overview available.";
}

function renderSeasonButtons(seasons) {
  seasonList.innerHTML = "";
  if (!seasons.length) {
    seasonStatus.textContent = "No seasons available yet.";
    episodeList.innerHTML = "";
    return;
  }
  seasonStatus.textContent = "";
  for (const season of seasons) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "season-pill";
    button.dataset.season = String(season.season_number);
    button.textContent = season.name || `Season ${season.season_number}`;
    button.addEventListener("click", () => selectSeason(season.season_number));
    if (state.currentSeason === season.season_number) button.classList.add("is-active");
    seasonList.appendChild(button);
  }
}

function selectSeason(seasonNumber) {
  if (state.currentSeason === seasonNumber) return;
  state.currentSeason = seasonNumber;
  for (const button of seasonList.querySelectorAll(".season-pill")) {
    button.classList.toggle("is-active", Number(button.dataset.season) === seasonNumber);
  }
  loadSeason(seasonNumber);
}

function renderEpisodes(season, episodes) {
  episodeList.innerHTML = "";
  if (!episodes.length) {
    seasonStatus.textContent = "No episodes found for this season.";
    return;
  }

  seasonStatus.textContent = `${season.name || `Season ${season.season_number}`} • ${episodes.length} episode${episodes.length === 1 ? "" : "s"}`;

  const fragment = document.createDocumentFragment();
  for (const episode of episodes) {
    if (!episode || !episode.episode_number) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "episode-card";
    const seasonLabel = String(season.season_number).padStart(2, "0");
    const episodeLabel = String(episode.episode_number).padStart(2, "0");
    const heading = document.createElement("strong");
    heading.textContent = `S${seasonLabel} · E${episodeLabel} — ${episode.name || "Episode"}`;
    const summary = document.createElement("p");
    summary.textContent = episode.overview ? episode.overview : "No synopsis yet.";
    button.appendChild(heading);
    button.appendChild(summary);
    button.addEventListener("click", () => {
      const url = buildPlayerUrl(season.season_number, episode.episode_number, `${state.show?.name || state.show?.original_name || "Series"} — ${episode.name || "Episode"}`);
      window.location.href = url;
    });
    fragment.appendChild(button);
  }
  episodeList.appendChild(fragment);
}

async function loadSeason(seasonNumber) {
  if (!state.showId) return;
  seasonStatus.textContent = "Loading episodes…";
  episodeList.innerHTML = "";
  try {
    const data = await requestTmdb(`tv/${state.showId}/season/${seasonNumber}`);
    const episodes = Array.isArray(data.episodes) ? data.episodes : [];
    renderEpisodes(data, episodes);
  } catch (error) {
    if (error.name === "AbortError") return;
    console.error(error);
    seasonStatus.textContent = "Could not load this season's episodes. Please try again.";
  }
}

function filterSeasons(seasons) {
  const list = [];
  for (const season of seasons || []) {
    if (season.season_number < 0) continue;
    if (season.episode_count === 0 && season.season_number !== 0) continue;
    list.push(season);
  }
  list.sort((a, b) => a.season_number - b.season_number);
  return list;
}

function populateShow(show) {
  state.show = show;
  showTitleEl.textContent = show.name || show.original_name || "Series";
  document.title = `${showTitleEl.textContent} · The Blackbox`;
  renderPoster(show);
  renderTags(show);
  renderGenres(show);
  renderOverview(show);
  setSearchNavigation(show);

  const seasons = filterSeasons(show.seasons || []);
  state.seasons = seasons;
  state.currentSeason = seasons.length ? seasons[seasons.length - 1].season_number : null;
  renderSeasonButtons(seasons);
  if (state.currentSeason != null) loadSeason(state.currentSeason);
}

async function loadShow(showId) {
  try {
    const data = await requestTmdb(`tv/${showId}`);
    populateShow(data);
  } catch (error) {
    if (error.name === "AbortError") return;
    console.error(error);
    overviewEl.textContent = "We couldn't load this series right now.";
    seasonStatus.textContent = "";
  }
}

function initBackButton() {
  if (!backButton) return;
  backButton.addEventListener("click", () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = "/series.html";
    }
  });
}

function init() {
  const url = new URL(window.location.href);
  const idParam = url.searchParams.get("id");
  if (!idParam) {
    overviewEl.textContent = "Missing series identifier.";
    return;
  }
  state.showId = Number(idParam);
  if (!Number.isFinite(state.showId) || state.showId <= 0) {
    overviewEl.textContent = "Invalid series identifier.";
    return;
  }
  initBackButton();
  loadShow(state.showId);
}

document.addEventListener("DOMContentLoaded", init);