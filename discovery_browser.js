import { requestTmdb } from "./tmdb_client.js";

const DEFAULT_YEAR_OPTIONS = [
  { label: "Any year", value: "" },
  { label: "2024", value: "2024" },
  { label: "2023", value: "2023" },
  { label: "2022", value: "2022" },
  { label: "2021", value: "2021" },
  { label: "2020", value: "2020" },
  { label: "2010s", value: "2010-2019", range: [2010, 2019] },
  { label: "2000s", value: "2000-2009", range: [2000, 2009] },
  { label: "1990s", value: "1990-1999", range: [1990, 1999] },
  { label: "Classic", value: "-1989", range: [1900, 1989] },
];

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function fuzzySubsequenceScore(haystack, needle) {
  if (!haystack || !needle) return 0;
  const lowerHay = haystack.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  if (lowerHay.includes(lowerNeedle)) {
    const lengthBoost = Math.min(lowerNeedle.length / Math.max(lowerHay.length, 1), 1);
    return 1.2 + lengthBoost;
  }
  let score = 0;
  let index = 0;
  for (const char of lowerNeedle) {
    const found = lowerHay.indexOf(char, index);
    if (found === -1) {
      return 0;
    }
    const gap = found - index;
    score += gap <= 0 ? 1 : 1 / (gap + 1.5);
    index = found + 1;
  }
  return score / lowerNeedle.length;
}

function levenshteinScore(a, b) {
  const left = a.toLowerCase();
  const right = b.toLowerCase();
  const rows = left.length + 1;
  const cols = right.length + 1;
  if (!left.length && !right.length) return 1;
  const matrix = Array.from({ length: rows }, () => new Array(cols).fill(0));
  for (let i = 0; i < rows; i += 1) {
    matrix[i][0] = i;
  }
  for (let j = 0; j < cols; j += 1) {
    matrix[0][j] = j;
  }
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      if (left[i - 1] === right[j - 1]) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j - 1] + 1,
        );
      }
    }
  }
  const distance = matrix[rows - 1][cols - 1];
  const longest = Math.max(left.length, right.length, 1);
  const ratio = 1 - distance / longest;
  return Math.max(ratio, 0);
}

function computeFuzzyScore(fields, query) {
  const value = normalizeString(query);
  if (!value) return 0;
  let best = 0;
  for (const field of fields) {
    const text = normalizeString(field);
    if (!text) continue;
    const subsequence = fuzzySubsequenceScore(text, value);
    const tokens = value.split(/\s+/g).filter(Boolean);
    let tokenScore = 0;
    if (tokens.length) {
      tokenScore = tokens.reduce((acc, token) => Math.max(acc, fuzzySubsequenceScore(text, token)), 0);
    }
    const leven = levenshteinScore(text, value) * 0.9;
    best = Math.max(best, subsequence, tokenScore, leven);
  }
  return best;
}

function renderChip(container, option, isActive, onSelect) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "chip";
  if (isActive) {
    button.classList.add("is-active");
  }
  button.textContent = option.label;
  button.dataset.value = option.value;
  button.addEventListener("click", () => {
    onSelect(option.value === "" ? "" : option.value);
  });
  container.appendChild(button);
}

function renderChipGroup(container, options, activeValue, onSelect) {
  if (!container) return;
  container.innerHTML = "";
  for (const option of options) {
    renderChip(container, option, option.value === activeValue, onSelect);
  }
}

function getYearFromItem(item, mode) {
  const field = mode === "tv" ? item.first_air_date : item.release_date;
  if (!field) return null;
  const year = Number(String(field).slice(0, 4));
  return Number.isFinite(year) ? year : null;
}

function matchesYear(yearOption, itemYear) {
  if (!yearOption || yearOption.value === "") return true;
  if (!Number.isFinite(itemYear)) return false;
  if (yearOption.range) {
    const [min, max] = yearOption.range;
    return itemYear >= min && itemYear <= max;
  }
  const exact = Number(yearOption.value);
  return Number.isFinite(exact) ? itemYear === exact : false;
}

function syncUrl(state) {
  const url = new URL(window.location.href);
  const { query, genre, year } = state;
  if (query) {
    url.searchParams.set("q", query);
  } else {
    url.searchParams.delete("q");
  }
  if (genre) {
    url.searchParams.set("genre", genre);
  } else {
    url.searchParams.delete("genre");
  }
  if (year) {
    url.searchParams.set("year", year);
  } else {
    url.searchParams.delete("year");
  }
  const next = url.toString();
  if (next !== window.location.href) {
    window.history.replaceState({}, "", next);
  }
}

function buildSummary(state, count, yearOptions) {
  const parts = [];
  if (state.query) parts.push(`“${state.query}”`);
  if (state.genre) parts.push(state.genre);
  if (state.year) {
    const match = yearOptions.find((option) => option.value === state.year);
    if (match) {
      parts.push(match.label);
    }
  }
  if (!parts.length) {
    if (count) {
      return `Showing ${count} highlighted picks.`;
    }
    return "Pick a genre chip or start typing to explore titles.";
  }
  const descriptor = parts.join(" • ");
  if (!count) {
    return `No matches for ${descriptor}. Try another filter.`;
  }
  return `${count} match${count === 1 ? "" : "es"} for ${descriptor}.`;
}

async function fetchGenres(mode) {
  const endpoint = mode === "tv" ? "genre/tv/list" : "genre/movie/list";
  try {
    const payload = await requestTmdb(endpoint);
    const genres = Array.isArray(payload?.genres) ? payload.genres : [];
    return genres.map((genre) => ({
      id: genre.id,
      name: typeof genre.name === "string" ? genre.name : "",
    }));
  } catch (error) {
    console.warn("Unable to load genres", error);
    return [];
  }
}

async function fetchCandidates(mode, state, genreId, yearOption, { signal }) {
  const query = normalizeString(state.query);
  const seen = new Set();
  const results = [];
  const useSearch = Boolean(query);
  const maxPages = useSearch ? 3 : 2;
  const path = useSearch ? `${mode === "tv" ? "search/tv" : "search/movie"}` : `discover/${mode}`;
  for (let page = 1; page <= maxPages; page += 1) {
    const params = useSearch
      ? {
          query,
          include_adult: "false",
          language: "en-US",
          page: String(page),
        }
      : {
          sort_by: "popularity.desc",
          page: String(page),
        };
    if (!useSearch && genreId) {
      params.with_genres = String(genreId);
    }
    if (!useSearch && yearOption && yearOption.value) {
      if (mode === "tv") {
        if (yearOption.range) {
          params["first_air_date.gte"] = `${yearOption.range[0]}-01-01`;
          params["first_air_date.lte"] = `${yearOption.range[1]}-12-31`;
        } else {
          params.first_air_date_year = yearOption.value;
        }
      } else {
        if (yearOption.range) {
          params["primary_release_date.gte"] = `${yearOption.range[0]}-01-01`;
          params["primary_release_date.lte"] = `${yearOption.range[1]}-12-31`;
        } else {
          params.primary_release_year = yearOption.value;
        }
      }
    }
    const payload = await requestTmdb(path, params, { signal });
    const items = Array.isArray(payload?.results) ? payload.results : [];
    for (const item of items) {
      if (!item || item.id == null) continue;
      const key = `${mode}:${item.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      results.push(item);
    }
    const totalPages = Number(payload?.total_pages) || 1;
    if (page >= totalPages) break;
  }
  return results;
}

function filterCandidates(candidates, mode, genreId, yearOption) {
  return candidates.filter((item) => {
    if (!item) return false;
    if (genreId) {
      const list = Array.isArray(item.genre_ids) ? item.genre_ids : [];
      if (!list.includes(genreId)) return false;
    }
    const year = getYearFromItem(item, mode);
    if (!matchesYear(yearOption, year)) return false;
    return true;
  });
}

export function initDiscoveryBrowser({
  mode,
  searchInput,
  statusElement,
  resultsElement,
  genreContainer,
  yearContainer,
  createCard,
  limit = 24,
  yearOptions = DEFAULT_YEAR_OPTIONS,
}) {
  if (!resultsElement || typeof createCard !== "function") {
    return () => {};
  }
  const state = {
    query: "",
    genre: "",
    year: "",
  };
  const url = new URL(window.location.href);
  state.query = normalizeString(url.searchParams.get("q"));
  state.genre = normalizeString(url.searchParams.get("genre"));
  state.year = normalizeString(url.searchParams.get("year"));

  const normalizedYearOptions = [...yearOptions];
  if (!normalizedYearOptions.some((option) => option.value === "")) {
    normalizedYearOptions.unshift({ label: "Any year", value: "" });
  }

  let activeController = null;
  let debounceTimer = null;
  let genreMap = new Map();

  function setStatus(message) {
    if (!statusElement) return;
    statusElement.textContent = message || "";
  }

  function renderResults(items) {
    resultsElement.innerHTML = "";
    const fragment = document.createDocumentFragment();
    for (const item of items) {
      fragment.appendChild(createCard(item));
    }
    resultsElement.appendChild(fragment);
  }

  function updateChips() {
    if (genreContainer) {
      const options = [
        { label: "Any genre", value: "" },
        ...Array.from(genreMap.values()).map((genre) => ({
          label: genre.name,
          value: genre.name,
          id: genre.id,
        })),
      ];
      renderChipGroup(genreContainer, options, state.genre, (value) => {
        state.genre = value === state.genre ? "" : value;
        scheduleUpdate();
      });
    }
    renderChipGroup(yearContainer, normalizedYearOptions, state.year, (value) => {
      state.year = value === state.year ? "" : value;
      scheduleUpdate();
    });
  }

  function pickGenreId() {
    if (!state.genre) return null;
    const target = Array.from(genreMap.values()).find((genre) => genre.name === state.genre);
    return target ? target.id : null;
  }

  function scheduleUpdate() {
    syncUrl(state);
    if (debounceTimer) {
      window.clearTimeout(debounceTimer);
    }
    debounceTimer = window.setTimeout(() => {
      debounceTimer = null;
      updateResults();
    }, 280);
  }

  async function updateResults() {
    if (activeController) {
      activeController.abort();
    }
    const controller = new AbortController();
    activeController = controller;
    const signal = controller.signal;
    const genreId = pickGenreId();
    const yearOption = normalizedYearOptions.find((option) => option.value === state.year) || null;
    const loadingMessage = state.query ? `Searching for “${state.query}”…` : "Loading featured picks…";
    setStatus(loadingMessage);
    try {
      const candidates = await fetchCandidates(mode, state, genreId, yearOption, { signal });
      if (signal.aborted) return;
      const filtered = filterCandidates(candidates, mode, genreId, yearOption);
      const scored = filtered.map((item) => {
        const titleFields = [item.title, item.original_title, item.name, item.original_name];
        const year = getYearFromItem(item, mode);
        if (Number.isFinite(year)) {
          titleFields.push(String(year));
        }
        if (Array.isArray(item.genre_ids)) {
          for (const id of item.genre_ids) {
            const genre = genreMap.get(id);
            if (genre?.name) {
              titleFields.push(genre.name);
            }
          }
        }
        const fuzzy = computeFuzzyScore(titleFields, state.query);
        const popularity = Number(item.popularity) || 0;
        const vote = Number(item.vote_average) || 0;
        const score = state.query ? fuzzy * 120 + popularity + vote : popularity + vote * 0.5;
        return { item, score };
      });
      scored.sort((a, b) => b.score - a.score);
      const top = scored.slice(0, limit).map((entry) => entry.item);
      renderResults(top);
      const summary = buildSummary(state, top.length, normalizedYearOptions);
      setStatus(summary);
    } catch (error) {
      if (error.name === "AbortError") return;
      console.error("Discovery fetch failed", error);
      setStatus("Unable to load results right now. Please try again shortly.");
      resultsElement.innerHTML = "";
    } finally {
      if (activeController === controller) {
        activeController = null;
      }
    }
  }

  if (searchInput) {
    searchInput.value = state.query;
    searchInput.addEventListener("input", (event) => {
      state.query = normalizeString(event.target.value);
      scheduleUpdate();
    });
    searchInput.addEventListener("search", (event) => {
      state.query = normalizeString(event.target.value);
      scheduleUpdate();
    });
  }

  setStatus("Loading filters…");

  fetchGenres(mode)
    .then((genres) => {
      genreMap = new Map(genres.map((genre) => [genre.id, genre]));
      updateChips();
    })
    .catch(() => {
      genreMap = new Map();
      updateChips();
    })
    .finally(() => {
      if (!genreMap.size) {
        updateChips();
      }
      scheduleUpdate();
    });

  return () => {
    if (activeController) {
      activeController.abort();
    }
    if (debounceTimer) {
      window.clearTimeout(debounceTimer);
    }
  };
}
