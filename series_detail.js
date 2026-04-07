import { BACKDROP_BASE, IMG_BASE as POSTER_BASE, requestTmdb as requestTmdbBase } from "./tmdb_client.js";
import { onHistoryChange, readHistory } from "./continue_watching.js?v=9";
import { getRecentlyWatchedByMode, onRecentlyChange } from "./recently_watched.js?v=9";

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
  currentSeasonData: null,
  currentEpisodes: [],
  resumeSeason: null,
  resumeEpisode: null,
  resumeProgress: 0,
  progressMap: new Map(),
};

function parseInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.trunc(number) : null;
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

function buildEpisodeKey(seasonNumber, episodeNumber) {
  const season = parseInteger(seasonNumber);
  const episode = parseInteger(episodeNumber);
  if (season == null || episode == null) return null;
  return `${season}:${episode}`;
}

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

  try {
    return await requestTmdbBase(path, params, { signal: controller.signal });
  } finally {
    if (activeRequest === controller) activeRequest = null;
  }
}

function refreshProgressMap() {
  const progressMap = new Map();
  const showId = state.showId != null ? String(state.showId) : "";
  if (!showId) {
    state.progressMap = progressMap;
    return;
  }

  const recentEntries = getRecentlyWatchedByMode("tv", Infinity).filter(
    (entry) => String(entry?.tmdb || "") === showId,
  );
  for (const entry of recentEntries) {
    const key = buildEpisodeKey(entry.season, entry.episode);
    if (!key) continue;
    const progress = Number(entry.progress) || 0;
    const completed = Boolean(entry.completed);
    if (progress < 30 && !completed) continue;
    progressMap.set(key, {
      progress,
      runtime: Number(entry.runtime) || null,
      completed,
      lastPlayedAt: Number(entry.lastPlayedAt) || 0,
    });
  }

  const historyEntries = readHistory().filter(
    (entry) => entry?.mode === "tv" && String(entry.tmdb || "") === showId,
  );
  for (const entry of historyEntries) {
    const key = buildEpisodeKey(entry.season, entry.episode);
    if (!key) continue;
    progressMap.set(key, {
      progress: Number(entry.progress) || 0,
      runtime: Number(entry.runtime) || null,
      completed: false,
      lastPlayedAt: Number(entry.updatedAt) || Date.now(),
    });
  }

  state.progressMap = progressMap;
}

function getEpisodeProgress(seasonNumber, episodeNumber) {
  const key = buildEpisodeKey(seasonNumber, episodeNumber);
  if (!key) return null;
  return state.progressMap.get(key) || null;
}

function setSearchNavigation(show) {
  if (!searchInput) return;
  searchInput.placeholder = `Search "${show.name || show.original_name || "show"}" on TMDB`;
  searchInput.addEventListener("input", () => {
    const value = searchInput.value;
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      const query = value.trim();
      if (!query) return;
      const url = new URL("/search.html", window.location.origin);
      url.searchParams.set("q", query);
      url.searchParams.set("scope", "tv");
      window.location.href = url.toString();
    }, 450);
  });
}

function buildPlayerUrl(seasonNumber, episodeNumber, title, runtimeMinutes) {
  const params = new URLSearchParams({
    mode: "tv",
    tmdb: String(state.showId),
    season: String(seasonNumber),
    episode: String(episodeNumber),
    title,
    autoplay: "true",
    color: "14ff9f",
  });
  if (state.show?.poster_path) {
    params.set("poster", `${POSTER_BASE}${state.show.poster_path}`);
  }
  if (state.show?.backdrop_path) {
    params.set("backdrop", `${BACKDROP_BASE}${state.show.backdrop_path}`);
  }
  if (Number.isFinite(Number(runtimeMinutes)) && Number(runtimeMinutes) > 0) {
    const runtimeSeconds = Math.max(0, Math.floor(Number(runtimeMinutes))) * 60;
    params.set("runtime", String(runtimeSeconds));
  }
  return new URL(`/player.html?${params.toString()}`, window.location.origin);
}

function renderPoster(show) {
  posterWrap.innerHTML = "";
  if (show.poster_path) {
    const img = document.createElement("img");
    img.src = POSTER_BASE + show.poster_path;
    img.alt = `${show.name || show.original_name || "Show"} poster`;
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

function createEpisodeProgressBar(progressInfo) {
  const progressBar = document.createElement("span");
  progressBar.className = "episode-card__progress";
  const fill = document.createElement("span");

  let percent = 100;
  if (
    Number.isFinite(Number(progressInfo?.runtime)) &&
    Number(progressInfo.runtime) > 0 &&
    Number.isFinite(Number(progressInfo?.progress)) &&
    Number(progressInfo.progress) > 0
  ) {
    percent = Math.min(
      100,
      Math.max(6, Math.round((Number(progressInfo.progress) / Number(progressInfo.runtime)) * 100)),
    );
  } else if (!progressInfo?.completed) {
    percent = 8;
  }

  fill.style.width = `${percent}%`;
  progressBar.appendChild(fill);
  return progressBar;
}

function renderEpisodes(season, episodes) {
  state.currentSeasonData = season;
  state.currentEpisodes = episodes;
  episodeList.innerHTML = "";
  if (!episodes.length) {
    seasonStatus.textContent = "No episodes found for this season.";
    return;
  }

  seasonStatus.textContent = `${season.name || `Season ${season.season_number}`} · ${episodes.length} episode${episodes.length === 1 ? "" : "s"}`;

  const fragment = document.createDocumentFragment();
  for (const episode of episodes) {
    if (!episode || !Number.isFinite(Number(episode.episode_number))) continue;
    const button = document.createElement("button");
    button.type = "button";
    button.className = "episode-card";
    const seasonLabel = String(season.season_number).padStart(2, "0");
    const episodeLabel = String(episode.episode_number).padStart(2, "0");
    const heading = document.createElement("strong");
    heading.textContent = `S${seasonLabel} · E${episodeLabel} - ${episode.name || "Episode"}`;
    const summary = document.createElement("p");
    summary.textContent = episode.overview ? episode.overview : "No synopsis yet.";
    button.appendChild(heading);
    button.appendChild(summary);

    const episodeProgress = getEpisodeProgress(season.season_number, episode.episode_number);
    if (episodeProgress) {
      button.appendChild(createEpisodeProgressBar(episodeProgress));
      button.classList.add("episode-card--tracked");
      if (episodeProgress.completed) {
        button.classList.add("is-complete");
      } else if (episodeProgress.progress > 0) {
        const resumeText = document.createElement("span");
        resumeText.className = "episode-card__resume";
        resumeText.textContent = `Resume from ${formatTime(episodeProgress.progress)}`;
        button.appendChild(resumeText);
      }
    }

    if (
      state.resumeSeason === season.season_number &&
      state.resumeEpisode === episode.episode_number
    ) {
      button.classList.add("is-resume-target");
    }

    button.addEventListener("click", () => {
      const runtimeMinutes = Number.isFinite(Number(episode.runtime)) ? Number(episode.runtime) : null;
      const url = buildPlayerUrl(
        season.season_number,
        episode.episode_number,
        `${state.show?.name || state.show?.original_name || "Show"} - ${episode.name || "Episode"}`,
        runtimeMinutes,
      );
      window.location.href = url.toString();
    });
    fragment.appendChild(button);
  }
  episodeList.appendChild(fragment);

  const resumeTarget = episodeList.querySelector(".episode-card.is-resume-target");
  if (resumeTarget) {
    resumeTarget.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

async function loadSeason(seasonNumber) {
  if (!state.showId) return;
  seasonStatus.textContent = "Loading episodes...";
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
  showTitleEl.textContent = show.name || show.original_name || "Show";
  document.title = `${showTitleEl.textContent} · theblackbox`;
  renderPoster(show);
  renderTags(show);
  renderGenres(show);
  renderOverview(show);
  setSearchNavigation(show);
  refreshProgressMap();

  const seasons = filterSeasons(show.seasons || []);
  state.seasons = seasons;
  const preferredSeason =
    seasons.find((season) => season.season_number === state.resumeSeason)?.season_number ??
    seasons[seasons.length - 1]?.season_number ??
    null;
  state.currentSeason = preferredSeason;
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
    overviewEl.textContent = "We couldn't load this show right now.";
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

function refreshRenderedEpisodes() {
  refreshProgressMap();
  if (state.currentSeasonData) {
    renderEpisodes(state.currentSeasonData, state.currentEpisodes);
  }
}

function init() {
  const url = new URL(window.location.href);
  const idParam = url.searchParams.get("id");
  if (!idParam) {
    overviewEl.textContent = "Missing show identifier.";
    return;
  }
  state.showId = Number(idParam);
  state.resumeSeason = parseInteger(url.searchParams.get("season"));
  state.resumeEpisode = parseInteger(url.searchParams.get("episode"));
  state.resumeProgress = Math.max(0, parseInteger(url.searchParams.get("progress")) || 0);
  if (!Number.isFinite(state.showId) || state.showId <= 0) {
    overviewEl.textContent = "Invalid show identifier.";
    return;
  }
  initBackButton();
  onHistoryChange(refreshRenderedEpisodes);
  onRecentlyChange(refreshRenderedEpisodes);
  loadShow(state.showId);
}

document.addEventListener("DOMContentLoaded", init);
