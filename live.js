import { createChannelLogoElement } from "./logo-placeholder.js";
import { setupAnimatedList } from "./ui_effects.js";

const API_BASE = "https://iptv-org.github.io/api";
const CHANNELS_URL = `${API_BASE}/channels.json`;
const STREAMS_URL = `${API_BASE}/streams.json`;
const LOGOS_URL = `${API_BASE}/logos.json`;
const CATEGORIES_URL = `${API_BASE}/categories.json`;
const COUNTRIES_URL = `${API_BASE}/countries.json`;
const REGIONS_URL = `${API_BASE}/regions.json`;
const REGION_OPTIONS = [
  { id: "all", label: "All regions" },
  { id: "AFR", label: "Africa" },
  { id: "AMER", label: "Americas" },
  { id: "APAC", label: "Asia-Pacific" },
  { id: "EUR", label: "Europe" },
  { id: "OCE", label: "Oceania" },
];
const REGION_OPTION_MAP = new Map(REGION_OPTIONS.map((option) => [option.id, option]));
const PAGE_SIZE = 40;
const STORAGE_PREFIX = "live:channel:";
const STREAM_STATUS_TIMEOUT_MS = 7000;
const STREAM_STATUS_MAX_CONCURRENT = 4;
const STREAM_STATUS_CACHE_TTL = 60 * 1000;

const grid = document.getElementById("grid");
if (grid) {
  setupAnimatedList(grid, { axis: "y" });
}
const filtersEl = document.getElementById("filters");
const searchInput = document.getElementById("search");
const statusLine = document.getElementById("statusLine");
const viewTitle = document.getElementById("viewTitle");
const countryListEl = document.getElementById("countryList");
const regionSelect = document.getElementById("regionFilter");
const countrySummary = document.getElementById("countrySummary");
const paginationEl = document.getElementById("pagination");
const countrySelectMobile = document.getElementById("countrySelectMobile");

const state = {
  channels: [],
  channelsByCountry: new Map(),
  channelsByRegion: new Map(),
  filter: "all",
  query: "",
  filterOptions: new Map(),
  countryOptions: [],
  countryMap: new Map(),
  categoriesMap: new Map(),
  selectedCountry: "all",
  selectedRegion: "all",
  page: 1,
};

const streamStatusQueue = [];
let streamStatusActive = 0;
const streamStatusCache = new Map();

function setBusy(isBusy) {
  if (grid) {
    grid.setAttribute("aria-busy", isBusy ? "true" : "false");
  }
  if (countryListEl) {
    countryListEl.setAttribute("aria-busy", isBusy ? "true" : "false");
  }
  if (searchInput) {
    searchInput.disabled = isBusy;
  }
  if (regionSelect) {
    regionSelect.disabled = isBusy;
  }
  if (countrySelectMobile) {
    countrySelectMobile.disabled = isBusy;
  }
}

function setStatus(message) {
  if (statusLine) {
    statusLine.textContent = message;
  }
}

function labelForCategory(id, categories) {
  if (!id) return "General";
  const entry = categories.get(id);
  if (entry && entry.name) return entry.name;
  const normalized = id.replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return "General";
  return normalized
    .split(" ")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatQualityLabel(value) {
  if (!value) return null;
  const text = String(value).trim().toUpperCase();
  if (!text) return null;
  if (text === "2160P") return "4K";
  if (text === "4320P") return "8K";
  if (text === "1080") return "1080P";
  if (text === "720") return "720P";
  if (text === "480") return "480P";
  if (text === "360") return "360P";
  return text;
}

function qualityScore(value) {
  if (!value) return 0;
  const normalized = String(value).toLowerCase();
  if (normalized.includes("8k") || normalized.includes("4320")) return 4320;
  if (normalized.includes("4k") || normalized.includes("2160")) return 2160;
  if (normalized.includes("1440")) return 1440;
  if (normalized.includes("1080")) return 1080;
  if (normalized.includes("720")) return 720;
  if (normalized.includes("hd")) return 720;
  if (normalized.includes("576")) return 576;
  if (normalized.includes("540")) return 540;
  if (normalized.includes("sd")) return 480;
  if (normalized.includes("480")) return 480;
  if (normalized.includes("360")) return 360;
  const numeric = parseInt(normalized.replace(/[^0-9]/g, ""), 10);
  return Number.isFinite(numeric) ? numeric : 0;
}

function isHls(url) {
  return /\.m3u8(\?|$)/i.test(url);
}

function isDirectVideo(url) {
  return /\.(mp4|m4v|mov|webm|ogg)(\?|$)/i.test(url);
}

function pickLogo(entries = []) {
  if (!Array.isArray(entries) || !entries.length) return null;
  const ranked = [...entries].sort((a, b) => {
    const formatScore = (entry) => {
      const format = (entry.format || "").toUpperCase();
      if (format === "SVG") return 5;
      if (format === "PNG") return 4;
      if (format === "WEBP") return 3;
      if (format === "JPEG" || format === "JPG") return 2;
      if (format === "GIF") return 1;
      return 0;
    };
    const feedScore = (entry) => (entry.feed == null ? 1 : 0);
    const tagScore = (entry) =>
      Array.isArray(entry.tags) && entry.tags.includes("white") ? 1 : 0;
    const sizeScore = (entry) => Number(entry.width || 0) * Number(entry.height || 0);
    return (
      formatScore(b) - formatScore(a) ||
      feedScore(b) - feedScore(a) ||
      tagScore(b) - tagScore(a) ||
      sizeScore(b) - sizeScore(a)
    );
  });
  return ranked[0]?.url || null;
}

function buildMaps(logos, streams) {
  const logosByChannel = new Map();
  for (const entry of logos || []) {
    if (!entry || !entry.channel || !entry.url) continue;
    const key = entry.channel;
    if (!logosByChannel.has(key)) logosByChannel.set(key, []);
    logosByChannel.get(key).push(entry);
  }

  const streamsByChannel = new Map();
  for (const stream of streams || []) {
    if (!stream || !stream.channel || !stream.url) continue;
    const key = stream.channel;
    if (!streamsByChannel.has(key)) streamsByChannel.set(key, []);
    streamsByChannel.get(key).push(stream);
  }

  return { logosByChannel, streamsByChannel };
}

function isBrowserPlayable(stream) {
  if (!stream || !stream.url) return false;
  if (stream.referrer || stream.user_agent) return false;
  if (!/^https:/i.test(stream.url)) return false;
  return isHls(stream.url) || isDirectVideo(stream.url);
}

function chooseStream(streams = []) {
  const playable = streams.filter(isBrowserPlayable);
  if (!playable.length) {
    return { stream: null, inlinePlayable: false, playbackKind: "unsupported" };
  }

  const ranked = [...playable].sort((a, b) => {
    const qualityDelta = qualityScore(b.quality) - qualityScore(a.quality);
    if (qualityDelta) return qualityDelta;
    const isHlsScore = (value) => (isHls(value.url) ? 1 : 0);
    return isHlsScore(b) - isHlsScore(a);
  });

  const selected = ranked[0] || null;
  let playbackKind = "external";
  if (selected) {
    if (isHls(selected.url)) playbackKind = "hls";
    else if (isDirectVideo(selected.url)) playbackKind = "file";
  }

  const inlinePlayable = Boolean(selected);
  return { stream: selected, inlinePlayable, playbackKind };
}

function buildFilterOptions(channels, categories) {
  const optionMap = new Map();
  for (const channel of channels) {
    const ids = channel.categoryIds?.length ? channel.categoryIds : ["general"];
    for (const id of ids) {
      const label = labelForCategory(id, categories);
      if (!optionMap.has(id)) {
        optionMap.set(id, { id, label, count: 0 });
      }
      optionMap.get(id).count += 1;
    }
  }
  const sorted = [...optionMap.values()].sort((a, b) => a.label.localeCompare(b.label));
  const map = new Map(sorted.map((option) => [option.id, option]));
  return { list: sorted, map };
}

function createChip(id, label, count) {
  const button = document.createElement("button");
  button.className = "chip";
  button.type = "button";
  button.dataset.filter = id;
  button.textContent = count != null ? `${label} (${count})` : label;
  if (id === state.filter) button.classList.add("is-active");
  return button;
}

function buildPlayerUrl(channel) {
  const url = new URL("live_player.html", window.location.href);
  url.searchParams.set("channel", channel.id);
  url.searchParams.set("name", channel.name);
  if (channel.countryCode) {
    url.searchParams.set("country", channel.countryCode);
  }
  if (channel.countryName) {
    url.searchParams.set("countryName", channel.countryName);
  }
  if (channel.countryFlag) {
    url.searchParams.set("countryFlag", channel.countryFlag);
  }
  if (channel.stream && channel.stream.url) {
    url.searchParams.set("stream", channel.stream.url);
  }
  if (channel.qualityLabel) {
    url.searchParams.set("quality", channel.qualityLabel);
  }
  if (channel.categoryLabel) {
    url.searchParams.set("category", channel.categoryLabel);
  }
  if (channel.logo) {
    url.searchParams.set("logo", channel.logo);
  }
  if (channel.stream?.title) {
    url.searchParams.set("title", channel.stream.title);
  }
  if (channel.stream?.feed) {
    url.searchParams.set("feed", channel.stream.feed);
  }
  if (channel.stream?.referrer) {
    url.searchParams.set("ref", channel.stream.referrer);
  }
  if (channel.stream?.user_agent) {
    url.searchParams.set("ua", channel.stream.user_agent);
  }
  return url.toString();
}

function serializeChannel(channel) {
  return {
    id: channel.id,
    name: channel.name,
    network: channel.network,
    website: channel.website,
    logo: channel.logo,
    countryCode: channel.countryCode,
    countryName: channel.countryName,
    countryFlag: channel.countryFlag,
    categoryLabel: channel.categoryLabel,
    categoryNames: channel.categoryNames,
    qualityLabel: channel.qualityLabel,
    playbackKind: channel.playbackKind,
    stream: {
      url: channel.stream?.url || null,
      title: channel.stream?.title || null,
      feed: channel.stream?.feed || null,
      quality: channel.stream?.quality || null,
      referrer: channel.stream?.referrer || null,
      userAgent: channel.stream?.user_agent || null,
      inlinePlayable: channel.inlinePlayable,
      kind: channel.playbackKind,
    },
  };
}

function storeChannel(channel) {
  if (!channel || !channel.id || !channel.stream) return;
  try {
    const payload = JSON.stringify(serializeChannel(channel));
    sessionStorage.setItem(`${STORAGE_PREFIX}${channel.id}`, payload);
    sessionStorage.setItem(`${STORAGE_PREFIX}last`, channel.id);
  } catch (error) {
    console.warn("Unable to persist live channel details", error);
  }
}

function readChannelStatus(channelId) {
  if (!channelId) return null;
  try {
    return sessionStorage.getItem(`${STORAGE_PREFIX}${channelId}:status`);
  } catch (error) {
    return null;
  }
}

function writeChannelStatus(channelId, status) {
  if (!channelId) return;
  try {
    sessionStorage.setItem(`${STORAGE_PREFIX}${channelId}:status`, status);
  } catch (error) {
    console.warn("Unable to persist live stream status", error);
  }
}

function applyStreamStatus(card, statusIndicator, thumbBadge, state) {
  if (!statusIndicator) return;
  const normalized = state === "up" ? "up" : state === "down" ? "down" : "pending";
  statusIndicator.classList.remove(
    "stream-status--pending",
    "stream-status--up",
    "stream-status--down"
  );
  if (normalized === "up") {
    statusIndicator.classList.add("stream-status--up");
    statusIndicator.textContent = "Up";
  } else if (normalized === "down") {
    statusIndicator.classList.add("stream-status--down");
    statusIndicator.textContent = "Down";
  } else {
    statusIndicator.classList.add("stream-status--pending");
    statusIndicator.textContent = "Checking…";
  }

  if (thumbBadge) {
    thumbBadge.classList.remove("thumb-status--up", "thumb-status--down");
    if (normalized === "up") {
      thumbBadge.hidden = false;
      thumbBadge.classList.add("thumb-status--up");
      thumbBadge.textContent = "Up";
    } else if (normalized === "down") {
      thumbBadge.hidden = false;
      thumbBadge.classList.add("thumb-status--down");
      thumbBadge.textContent = "Server down";
    } else {
      thumbBadge.hidden = true;
    }
  }

  if (card) {
    card.dataset.streamStatus = normalized;
  }
}

function queueStreamStatusCheck(channel, onUpdate) {
  if (!channel) return;
  const cacheKey = channel.stream?.url || channel.id;
  const now = Date.now();
  if (cacheKey && streamStatusCache.has(cacheKey)) {
    const cached = streamStatusCache.get(cacheKey);
    if (now - cached.timestamp < STREAM_STATUS_CACHE_TTL) {
      onUpdate(cached.status);
      return;
    }
  }

  const stored = readChannelStatus(channel.id);
  if (stored === "up" || stored === "down") {
    onUpdate(stored);
  }

  streamStatusQueue.push({ channel, onUpdate, cacheKey });
  processStreamStatusQueue();
}

function processStreamStatusQueue() {
  if (streamStatusActive >= STREAM_STATUS_MAX_CONCURRENT) return;
  const next = streamStatusQueue.shift();
  if (!next) return;
  streamStatusActive += 1;
  performStreamStatusCheck(next.channel)
    .then((result) => {
      const status = result === "up" ? "up" : "down";
      if (next.cacheKey) {
        streamStatusCache.set(next.cacheKey, { status, timestamp: Date.now() });
      }
      writeChannelStatus(next.channel.id, status);
      next.onUpdate(status);
    })
    .catch(() => {
      if (next.cacheKey) {
        streamStatusCache.set(next.cacheKey, { status: "down", timestamp: Date.now() });
      }
      writeChannelStatus(next.channel.id, "down");
      next.onUpdate("down");
    })
    .finally(() => {
      streamStatusActive -= 1;
      processStreamStatusQueue();
    });
}

async function performStreamStatusCheck(channel) {
  if (!channel?.stream?.url) return "down";
  try {
    return await pingStream(channel.stream.url);
  } catch (error) {
    return "down";
  }
}

async function pingStream(url) {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), STREAM_STATUS_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "GET",
      mode: "cors",
      signal: controller.signal,
      cache: "no-store",
      credentials: "omit",
      redirect: "follow",
      headers: {
        Accept: "application/vnd.apple.mpegurl,text/plain;q=0.9,*/*;q=0.1",
      },
    });
    if (response && (response.ok || response.status === 416)) {
      if (response.body && typeof response.body.cancel === "function") {
        try {
          response.body.cancel();
        } catch (error) {
          /* ignore cancellation errors */
        }
      }
      return "up";
    }
    return "down";
  } catch (error) {
    return "down";
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function createChannelCard(channel) {
  const card = document.createElement("a");
  card.className = "card card--channel";
  card.dataset.channelId = channel.id;
  card.dataset.mode = channel.inlinePlayable ? "inline" : "external";
  const shouldMonitorStream = Boolean(
    channel.inlinePlayable &&
      channel.playbackKind === "hls" &&
      channel.stream?.url
  );
  card.href = channel.inlinePlayable && channel.stream?.url ? buildPlayerUrl(channel) : channel.stream?.url || "#";
  card.rel = "noopener";
  if (!channel.inlinePlayable) {
    card.target = "_blank";
  }
  card.setAttribute(
    "aria-label",
    channel.inlinePlayable
      ? `Watch ${channel.name} live in the built-in player`
      : `Open the ${channel.name} stream link`
  );

  if (channel.inlinePlayable) {
    card.addEventListener("click", () => storeChannel(channel));
  }

  const thumb = document.createElement("div");
  thumb.className = "thumb";

  let thumbStatusBadge = null;
  const logoImg = createChannelLogoElement(channel.name, channel.logo, {
    aspect: "landscape",
  });
  const updateThumbPlaceholderState = () => {
    if (logoImg.dataset.placeholder === "true") {
      thumb.classList.add("thumb--placeholder");
    } else {
      thumb.classList.remove("thumb--placeholder");
    }
  };
  logoImg.addEventListener("load", updateThumbPlaceholderState);
  logoImg.addEventListener("error", updateThumbPlaceholderState);
  thumb.appendChild(logoImg);
  updateThumbPlaceholderState();

  if (channel.qualityLabel) {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = channel.qualityLabel;
    thumb.appendChild(badge);
  }

  if (shouldMonitorStream) {
    thumbStatusBadge = document.createElement("span");
    thumbStatusBadge.className = "thumb-status";
    thumbStatusBadge.hidden = true;
    thumb.appendChild(thumbStatusBadge);
  }

  const meta = document.createElement("div");
  meta.className = "meta";

  const title = document.createElement("p");
  title.className = "title";
  title.textContent = channel.name;
  meta.appendChild(title);

  const details = [];
  if (state.selectedCountry === "all" && channel.countryName) {
    const locationLabel = channel.countryFlag
      ? `${channel.countryFlag} ${channel.countryName}`
      : channel.countryName;
    details.push(locationLabel);
  }
  if (channel.categoryLabel) details.push(channel.categoryLabel);
  const playbackLabel = channel.inlinePlayable
    ? channel.playbackKind === "file"
      ? "Direct playback"
      : "In-browser playback"
    : "External stream";
  details.push(playbackLabel);
  if (channel.network) details.push(channel.network);
  const sub = document.createElement("p");
  sub.className = "sub";
  sub.textContent = details.join(" • ") || "Live channel";
  meta.appendChild(sub);

  const actions = document.createElement("div");
  actions.className = "actions";
  const actionLabel = channel.inlinePlayable ? "Watch live" : "Open stream link";
  actions.innerHTML =
    `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m8 5.14 10 6-10 6V5.14Z"/></svg><span>${actionLabel}</span>`;

  if (shouldMonitorStream) {
    const statusIndicator = document.createElement("span");
    statusIndicator.className = "stream-status stream-status--pending";
    statusIndicator.textContent = "Checking…";
    actions.appendChild(statusIndicator);
    card.dataset.streamStatus = "pending";
    queueStreamStatusCheck(channel, (state) => {
      applyStreamStatus(card, statusIndicator, thumbStatusBadge, state);
    });
  }

  meta.appendChild(actions);

  card.appendChild(thumb);
  card.appendChild(meta);

  return card;
}

function matchesQuery(channel, query) {
  if (!query) return true;
  const normalized = query.toLowerCase();
  if (channel.name.toLowerCase().includes(normalized)) return true;
  if (channel.altNames?.some((name) => name.toLowerCase().includes(normalized))) return true;
  if (channel.network && channel.network.toLowerCase().includes(normalized)) return true;
  if (channel.categoryNames?.some((name) => name.toLowerCase().includes(normalized))) return true;
  return false;
}

function filterChannels(channels) {
  const currentFilter = state.filter;
  const query = state.query.trim().toLowerCase();
  return channels.filter((channel) => {
    if (currentFilter !== "all") {
      if (!channel.categoryIds.includes(currentFilter)) return false;
    }
    if (query && !matchesQuery(channel, query)) return false;
    return true;
  });
}

function getSelectedCountryMeta() {
  if (state.selectedCountry === "all") return null;
  return state.countryMap.get(state.selectedCountry) || null;
}

function getChannelsForSelection() {
  if (state.selectedCountry !== "all") {
    return state.channelsByCountry.get(state.selectedCountry) || [];
  }
  if (state.selectedRegion !== "all") {
    return state.channelsByRegion.get(state.selectedRegion) || [];
  }
  return state.channels;
}

function getRegionCount(regionId) {
  if (regionId === "all") return state.channels.length;
  const list = state.channelsByRegion.get(regionId);
  return list ? list.length : 0;
}

function rebuildFilters(channels) {
  const { list, map } = buildFilterOptions(channels, state.categoriesMap);
  state.filterOptions = map;
  if (state.filter !== "all" && !map.has(state.filter)) {
    state.filter = "all";
  }
  if (filtersEl) {
    filtersEl.innerHTML = "";
    const fragment = document.createDocumentFragment();
    fragment.appendChild(createChip("all", "All", channels.length));
    for (const option of list) {
      fragment.appendChild(createChip(option.id, option.label, option.count));
    }
    filtersEl.appendChild(fragment);
  }
  updateActiveFilter();
}

function populateRegionSelect() {
  if (!regionSelect) return;
  regionSelect.innerHTML = "";
  const fragment = document.createDocumentFragment();
  for (const option of REGION_OPTIONS) {
    const opt = document.createElement("option");
    opt.value = option.id;
    const count = getRegionCount(option.id);
    const countLabel = count ? ` (${count.toLocaleString()})` : "";
    opt.textContent = `${option.label}${countLabel}`;
    if (option.id !== "all" && count === 0) {
      opt.disabled = true;
    }
    fragment.appendChild(opt);
  }
  regionSelect.appendChild(fragment);
  regionSelect.value = state.selectedRegion;
  regionSelect.disabled = false;
}

function createCountryButton({ code, name, flag, count }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "country-item";
  button.dataset.country = code;
  button.setAttribute("role", "listitem");
  if (state.selectedCountry === code) {
    button.classList.add("is-active");
    button.setAttribute("aria-pressed", "true");
  } else {
    button.setAttribute("aria-pressed", "false");
  }

  const flagSpan = document.createElement("span");
  flagSpan.className = "country-flag";
  flagSpan.textContent = flag || "🌐";
  button.appendChild(flagSpan);

  const metaWrap = document.createElement("span");
  metaWrap.className = "country-meta";

  const nameSpan = document.createElement("span");
  nameSpan.className = "country-name";
  nameSpan.textContent = name;
  metaWrap.appendChild(nameSpan);

  const countSpan = document.createElement("span");
  countSpan.className = "country-count";
  countSpan.textContent = count.toLocaleString();
  metaWrap.appendChild(countSpan);

  button.appendChild(metaWrap);

  return button;
}

function renderCountryList() {
  const regionMeta = REGION_OPTION_MAP.get(state.selectedRegion);
  const baseCount = getRegionCount(state.selectedRegion);
  const entries = [
    {
      code: "all",
      name:
        state.selectedRegion === "all"
          ? "All countries"
          : `All ${regionMeta?.label || "regions"}`,
      flag: "🌍",
      count: baseCount,
    },
    ...state.countryOptions.filter((option) =>
      state.selectedRegion === "all" ? true : option.regionCodes?.has(state.selectedRegion)
    ),
  ];

  if (countryListEl) {
    countryListEl.innerHTML = "";
    const fragment = document.createDocumentFragment();
    for (const entry of entries) {
      fragment.appendChild(createCountryButton(entry));
    }
    countryListEl.appendChild(fragment);
  }

  if (countrySelectMobile) {
    const previousValue = countrySelectMobile.value;
    countrySelectMobile.innerHTML = "";
    const selectFragment = document.createDocumentFragment();
    for (const entry of entries) {
      const option = document.createElement("option");
      option.value = entry.code;
      const labelParts = [];
      if (entry.flag) labelParts.push(entry.flag);
      labelParts.push(entry.name);
      if (entry.count != null) {
        labelParts.push(`(${entry.count.toLocaleString()})`);
      }
      option.textContent = labelParts.join(" ");
      if (entry.code === state.selectedCountry) {
        option.selected = true;
      }
      selectFragment.appendChild(option);
    }
    countrySelectMobile.appendChild(selectFragment);
    const normalizedValue = entries.find((entry) => entry.code === previousValue)
      ? previousValue
      : state.selectedCountry;
    countrySelectMobile.value = normalizedValue;
    countrySelectMobile.disabled = false;
  }
}

function updateCountrySummary(baseChannels) {
  if (!countrySummary) return;
  const count = baseChannels.length;
  const plural = count === 1 ? "channel" : "channels";
  const formattedCount = `${count.toLocaleString()} ${plural}`;

  if (state.selectedCountry === "all") {
    if (state.selectedRegion === "all") {
      countrySummary.textContent = `${formattedCount} worldwide`;
    } else {
      const regionMeta = REGION_OPTION_MAP.get(state.selectedRegion);
      countrySummary.textContent = `${formattedCount} · ${regionMeta?.label || "Selected region"}`;
    }
  } else {
    const countryMeta = getSelectedCountryMeta();
    const label = countryMeta
      ? `${countryMeta.flag ? `${countryMeta.flag} ` : ""}${countryMeta.name}`
      : "Selected country";
    countrySummary.textContent = `${formattedCount} · ${label}`;
  }
}

function updateActiveFilter() {
  if (!filtersEl) return;
  const buttons = filtersEl.querySelectorAll(".chip");
  buttons.forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.filter === state.filter);
  });
}

function updateViewTitle() {
  if (!viewTitle) return;
  const countryMeta = getSelectedCountryMeta();
  const regionMeta = REGION_OPTION_MAP.get(state.selectedRegion);
  let baseLabel = "Live channels";
  if (state.selectedCountry === "all") {
    baseLabel =
      state.selectedRegion === "all"
        ? "Global live channels"
        : `${regionMeta?.label || "Regional"} live channels`;
  } else if (countryMeta) {
    baseLabel = `${countryMeta.name} live channels`;
  }

  if (state.filter === "all") {
    viewTitle.textContent = baseLabel;
    return;
  }

  const meta = state.filterOptions.get(state.filter);
  if (meta) {
    viewTitle.textContent = `${meta.label} · ${baseLabel}`;
  } else {
    viewTitle.textContent = baseLabel;
  }
}

function createPaginationButton(label, targetPage, disabled, ariaLabel) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "pagination__button";
  button.textContent = label;
  if (ariaLabel) {
    button.setAttribute("aria-label", ariaLabel);
  }
  if (disabled) {
    button.disabled = true;
  } else {
    button.dataset.page = String(targetPage);
  }
  return button;
}

function renderPagination(totalResults, totalPages, rangeStart, rangeEnd) {
  if (!paginationEl) return;
  if (!totalResults || totalPages <= 1) {
    paginationEl.innerHTML = "";
    paginationEl.hidden = true;
    return;
  }

  paginationEl.hidden = false;
  paginationEl.innerHTML = "";

  const fragment = document.createDocumentFragment();

  const status = document.createElement("span");
  status.className = "pagination__status";
  const statusPlural = totalResults === 1 ? "channel" : "channels";
  status.textContent = `Showing ${rangeStart.toLocaleString()}–${rangeEnd.toLocaleString()} of ${totalResults.toLocaleString()} ${statusPlural}`;
  fragment.appendChild(status);

  const controls = document.createElement("div");
  controls.className = "pagination__controls";

  controls.appendChild(
    createPaginationButton("Previous", Math.max(1, state.page - 1), state.page === 1, "Go to previous page")
  );

  const indicator = document.createElement("span");
  indicator.className = "pagination__indicator";
  indicator.textContent = `Page ${state.page} of ${totalPages}`;
  controls.appendChild(indicator);

  controls.appendChild(
    createPaginationButton(
      "Next",
      Math.min(totalPages, state.page + 1),
      state.page === totalPages,
      "Go to next page"
    )
  );

  fragment.appendChild(controls);

  paginationEl.appendChild(fragment);
}

function setPage(page) {
  const baseChannels = getChannelsForSelection();
  const results = filterChannels(baseChannels);
  const totalPages = Math.max(1, Math.ceil(results.length / PAGE_SIZE));
  const normalized = Math.min(Math.max(page, 1), totalPages);
  if (normalized === state.page) return;
  state.page = normalized;
  render();
}

function onPaginationClick(event) {
  const button = event.target.closest("button[data-page]");
  if (!button) return;
  const page = Number.parseInt(button.dataset.page, 10);
  if (!Number.isFinite(page)) return;
  setPage(page);
}

function render() {
  if (!grid) return;
  grid.innerHTML = "";
  const baseChannels = getChannelsForSelection();
  updateCountrySummary(baseChannels);

  if (!baseChannels.length) {
    let message = "No live channels available right now.";
    if (state.selectedCountry !== "all") {
      const countryMeta = getSelectedCountryMeta();
      if (countryMeta) {
        message = `No live channels are available for ${countryMeta.name} right now.`;
      } else {
        message = "No live channels available for the selected country.";
      }
    } else if (state.selectedRegion !== "all") {
      const regionMeta = REGION_OPTION_MAP.get(state.selectedRegion);
      message = regionMeta
        ? `No live channels are available in the ${regionMeta.label} region right now.`
        : "No live channels available for this region.";
    }
    renderPagination(0, 0, 0, 0);
    setStatus(message);
    return;
  }

  const results = filterChannels(baseChannels);

  if (!results.length) {
    renderPagination(0, 0, 0, 0);
    setStatus(
      state.query
        ? `No live channels match “${state.query}”.`
        : "No live channels found for this filter."
    );
    return;
  }

  const totalResults = results.length;
  const totalPages = Math.max(1, Math.ceil(totalResults / PAGE_SIZE));
  if (state.page > totalPages) {
    state.page = totalPages;
  } else if (state.page < 1) {
    state.page = 1;
  }

  const startIndex = (state.page - 1) * PAGE_SIZE;
  const endIndex = Math.min(startIndex + PAGE_SIZE, totalResults);
  const visibleResults = results.slice(startIndex, endIndex);

  const fragment = document.createDocumentFragment();
  for (const channel of visibleResults) {
    fragment.appendChild(createChannelCard(channel));
  }
  grid.appendChild(fragment);

  renderPagination(totalResults, totalPages, startIndex + 1, endIndex);

  const filterMeta = state.filter === "all" ? null : state.filterOptions.get(state.filter);
  const filterLabel = filterMeta ? ` in ${filterMeta.label}` : "";
  const searchLabel = state.query ? ` matching “${state.query}”` : "";
  const locationLabel = (() => {
    if (state.selectedCountry === "all") {
      if (state.selectedRegion === "all") return " worldwide";
      const regionMeta = REGION_OPTION_MAP.get(state.selectedRegion);
      return regionMeta ? ` in ${regionMeta.label}` : "";
    }
    const countryMeta = getSelectedCountryMeta();
    return countryMeta ? ` in ${countryMeta.name}` : "";
  })();

  const summary = `Showing ${
    (startIndex + 1).toLocaleString()
  }–${endIndex.toLocaleString()} of ${totalResults.toLocaleString()} ${
    totalResults === 1 ? "channel" : "channels"
  }${locationLabel}${filterLabel}${searchLabel}. Ready for in-browser playback.`;
  setStatus(summary);
}

function onFilterClick(event) {
  const button = event.target.closest("button[data-filter]");
  if (!button) return;
  const filter = button.dataset.filter || "all";
  if (state.filter === filter) return;
  state.filter = filter;
  state.page = 1;
  updateActiveFilter();
  updateViewTitle();
  render();
}

function onSearchInput(event) {
  state.page = 1;
  state.query = event.target.value || "";
  render();
}

function onCountryListClick(event) {
  const button = event.target.closest("button.country-item");
  if (!button) return;
  const code = button.dataset.country || "all";
  if (state.selectedCountry === code) return;
  state.selectedCountry = code;
  state.filter = "all";
  state.page = 1;
  renderCountryList();
  const baseChannels = getChannelsForSelection();
  rebuildFilters(baseChannels);
  updateViewTitle();
  render();
}

function onCountrySelectChange(event) {
  const value = event.target.value || "all";
  if (state.selectedCountry === value) return;
  state.selectedCountry = value;
  state.filter = "all";
  state.page = 1;
  renderCountryList();
  const baseChannels = getChannelsForSelection();
  rebuildFilters(baseChannels);
  updateViewTitle();
  render();
}

function onRegionChange(event) {
  const value = event.target.value || "all";
  const normalized = REGION_OPTION_MAP.has(value) ? value : "all";
  if (state.selectedRegion === normalized) return;
  state.selectedRegion = normalized;
  const availableCountries = new Set(
    state.countryOptions
      .filter((option) =>
        normalized === "all" ? true : option.regionCodes?.has(normalized)
      )
      .map((option) => option.code)
  );
  if (normalized !== "all" && state.selectedCountry !== "all" && !availableCountries.has(state.selectedCountry)) {
    state.selectedCountry = "all";
  }
  state.filter = "all";
  state.page = 1;
  renderCountryList();
  const baseChannels = getChannelsForSelection();
  rebuildFilters(baseChannels);
  updateViewTitle();
  render();
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-cache" });
  if (!response.ok) {
    throw new Error(`Request failed for ${url}: ${response.status}`);
  }
  return response.json();
}

async function loadData() {
  setBusy(true);
  setStatus("Loading live channels…");
  if (countrySummary) {
    countrySummary.textContent = "";
  }
  if (countryListEl) {
    countryListEl.innerHTML = "";
  }
  if (countrySelectMobile) {
    countrySelectMobile.innerHTML = '<option value="all">All countries</option>';
    countrySelectMobile.disabled = true;
  }
  try {
    const [channels, streams, logos, categories, countries, regions] = await Promise.all([
      fetchJson(CHANNELS_URL),
      fetchJson(STREAMS_URL),
      fetchJson(LOGOS_URL),
      fetchJson(CATEGORIES_URL),
      fetchJson(COUNTRIES_URL),
      fetchJson(REGIONS_URL),
    ]);

    const categoriesMap = new Map((categories || []).map((cat) => [cat.id, cat]));
    state.categoriesMap = categoriesMap;
    const { logosByChannel, streamsByChannel } = buildMaps(logos, streams);

    const countriesMap = new Map((countries || []).map((entry) => [entry.code, entry]));
    if (!countriesMap.has("INT")) {
      countriesMap.set("INT", { code: "INT", name: "International", flag: "🌐" });
    }

    const allowedRegionCodes = new Set(
      REGION_OPTIONS.filter((option) => option.id !== "all").map((option) => option.id)
    );
    const regionMembership = new Map();
    for (const region of regions || []) {
      if (!region || !allowedRegionCodes.has(region.code)) continue;
      for (const code of region.countries || []) {
        if (!regionMembership.has(code)) regionMembership.set(code, new Set());
        regionMembership.get(code).add(region.code);
      }
    }

    const filtered = [];
    const channelsByCountry = new Map();
    const channelsByRegion = new Map();

    const registerChannel = (map, key, channel) => {
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(channel);
    };

    for (const channel of channels || []) {
      if (!channel || channel.is_nsfw) continue;
      const countryCode = channel.country || "INT";
      const streamCandidates = streamsByChannel.get(channel.id);
      if (!streamCandidates || !streamCandidates.length) continue;
      const { stream, inlinePlayable, playbackKind } = chooseStream(streamCandidates);
      if (!stream || !inlinePlayable) continue;

      const categoryIds = (channel.categories || []).filter((id) => id && id !== "xxx");
      if (!categoryIds.length) categoryIds.push("general");

      const categoryNames = categoryIds.map((id) => labelForCategory(id, categoriesMap));
      const categoryLabel = categoryNames[0] || "General";
      const qualityLabel = formatQualityLabel(stream.quality);
      const logoEntries = logosByChannel.get(channel.id);
      const logo = pickLogo(logoEntries);

      const countryMeta = countriesMap.get(countryCode) || { name: countryCode, flag: "" };
      const regionCodesSet = regionMembership.get(countryCode) || new Set();
      const regionCodes = Array.from(regionCodesSet);

      const entry = {
        id: channel.id,
        name: channel.name || channel.id,
        altNames: channel.alt_names || [],
        network: channel.network || "",
        owners: channel.owners || [],
        website: channel.website || "",
        countryCode,
        countryName: countryMeta.name || countryCode,
        countryFlag: countryMeta.flag || "",
        regionCodes,
        categoryIds,
        categoryNames,
        categoryLabel,
        qualityLabel,
        stream,
        inlinePlayable,
        playbackKind,
        logo,
      };

      filtered.push(entry);
      registerChannel(channelsByCountry, countryCode, entry);
      if (regionCodes.length) {
        for (const regionId of regionCodes) {
          registerChannel(channelsByRegion, regionId, entry);
        }
      }
    }

    filtered.sort((a, b) => a.name.localeCompare(b.name));
    for (const [, list] of channelsByCountry) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    for (const [, list] of channelsByRegion) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }

    const countryOptions = [];
    for (const [code, list] of channelsByCountry) {
      if (!list.length) continue;
      const meta = countriesMap.get(code) || { name: code, flag: "" };
      countryOptions.push({
        code,
        name: meta.name || code,
        flag: meta.flag || "",
        count: list.length,
        regionCodes: regionMembership.get(code) || new Set(),
      });
    }
    countryOptions.sort((a, b) => a.name.localeCompare(b.name));

    state.channels = filtered;
    state.channelsByCountry = channelsByCountry;
    state.channelsByRegion = channelsByRegion;
    state.countryOptions = countryOptions;
    state.countryMap = new Map(countryOptions.map((option) => [option.code, option]));
    state.filterOptions = new Map();
    state.filter = "all";
    state.selectedCountry = "all";
    state.selectedRegion = "all";
    state.page = 1;

    populateRegionSelect();
    renderCountryList();

    const baseChannels = getChannelsForSelection();
    rebuildFilters(baseChannels);
    updateViewTitle();
    render();
  } catch (error) {
    console.error(error);
    setStatus("Unable to load live channels right now. Please try again later.");
  } finally {
    setBusy(false);
    if (searchInput) {
      searchInput.disabled = false;
    }
  }
}

if (filtersEl) {
  filtersEl.addEventListener("click", onFilterClick);
}

if (searchInput) {
  searchInput.addEventListener("input", onSearchInput);
}

if (countryListEl) {
  countryListEl.addEventListener("click", onCountryListClick);
}

if (regionSelect) {
  regionSelect.addEventListener("change", onRegionChange);
}

if (countrySelectMobile) {
  countrySelectMobile.addEventListener("change", onCountrySelectChange);
}

if (paginationEl) {
  paginationEl.addEventListener("click", onPaginationClick);
}

loadData();
