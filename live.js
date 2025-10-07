const API_BASE = "https://iptv-org.github.io/api";
const CHANNELS_URL = `${API_BASE}/channels.json`;
const STREAMS_URL = `${API_BASE}/streams.json`;
const LOGOS_URL = `${API_BASE}/logos.json`;
const CATEGORIES_URL = `${API_BASE}/categories.json`;
const TARGET_COUNTRY = "UK";
const STORAGE_PREFIX = "live:channel:";

const grid = document.getElementById("grid");
const filtersEl = document.getElementById("filters");
const searchInput = document.getElementById("search");
const statusLine = document.getElementById("statusLine");
const viewTitle = document.getElementById("viewTitle");

const state = {
  channels: [],
  filter: "all",
  query: "",
  filterOptions: new Map(),
};

function setBusy(isBusy) {
  if (grid) {
    grid.setAttribute("aria-busy", isBusy ? "true" : "false");
  }
  if (searchInput) {
    searchInput.disabled = isBusy;
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

function chooseStream(streams = []) {
  const valid = streams.filter((stream) =>
    /^https?:/i.test(stream.url || "")
  );
  if (!valid.length) return { stream: null, inlinePlayable: false };

  const httpsStreams = valid.filter((stream) => /^https:/i.test(stream.url));
  const hlsHttps = httpsStreams.filter((stream) => isHls(stream.url));
  const inlineCandidates = hlsHttps.length ? hlsHttps : httpsStreams;

  const candidates = inlineCandidates.length ? inlineCandidates : valid;
  const ranked = [...candidates].sort((a, b) => {
    const qualityDelta = qualityScore(b.quality) - qualityScore(a.quality);
    if (qualityDelta) return qualityDelta;
    const isHlsScore = (value) => (isHls(value.url) ? 1 : 0);
    const protocolScore = (value) => (/^https:/i.test(value.url) ? 1 : 0);
    return (
      isHlsScore(b) - isHlsScore(a) ||
      protocolScore(b) - protocolScore(a)
    );
  });

  const selected = ranked[0] || null;
  let playbackKind = "external";
  if (selected) {
    if (isHls(selected.url)) playbackKind = "hls";
    else if (isDirectVideo(selected.url)) playbackKind = "file";
    else if (/^https:/i.test(selected.url)) playbackKind = "https";
  }

  const inlinePlayable = Boolean(
    selected &&
    /^https:/i.test(selected.url) &&
    (isHls(selected.url) || isDirectVideo(selected.url))
  );
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

function createChannelCard(channel) {
  const card = document.createElement("a");
  card.className = "card card--channel";
  card.dataset.channelId = channel.id;
  card.dataset.mode = channel.inlinePlayable ? "inline" : "external";
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

  if (channel.logo) {
    const img = document.createElement("img");
    img.src = channel.logo;
    img.alt = `${channel.name} logo`;
    thumb.appendChild(img);
  } else {
    const placeholder = document.createElement("div");
    placeholder.className = "placeholder";
    placeholder.textContent = channel.name.charAt(0).toUpperCase();
    thumb.appendChild(placeholder);
  }

  if (channel.qualityLabel) {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = channel.qualityLabel;
    thumb.appendChild(badge);
  }

  const meta = document.createElement("div");
  meta.className = "meta";

  const title = document.createElement("p");
  title.className = "title";
  title.textContent = channel.name;
  meta.appendChild(title);

  const details = [];
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

function filterChannels() {
  const currentFilter = state.filter;
  const query = state.query.trim().toLowerCase();
  return state.channels.filter((channel) => {
    if (currentFilter !== "all") {
      if (!channel.categoryIds.includes(currentFilter)) return false;
    }
    if (query && !matchesQuery(channel, query)) return false;
    return true;
  });
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
  if (state.filter === "all") {
    viewTitle.textContent = "Live channels";
    return;
  }
  const meta = state.filterOptions.get(state.filter);
  if (meta) {
    viewTitle.textContent = `${meta.label} live channels`;
  } else {
    viewTitle.textContent = "Live channels";
  }
}

function render() {
  if (!grid) return;
  grid.innerHTML = "";
  const results = filterChannels();
  const inlineCount = results.filter((channel) => channel.inlinePlayable).length;
  const externalCount = results.length - inlineCount;

  if (!results.length) {
    setStatus(
      state.query
        ? `No live channels match “${state.query}”.`
        : "No live channels found for this filter."
    );
    return;
  }

  const fragment = document.createDocumentFragment();
  for (const channel of results) {
    fragment.appendChild(createChannelCard(channel));
  }
  grid.appendChild(fragment);

  const filterMeta = state.filter === "all" ? null : state.filterOptions.get(state.filter);
  const filterLabel = filterMeta ? ` in ${filterMeta.label}` : "";
  const searchLabel = state.query ? ` matching “${state.query}”` : "";
  let summary = `${results.length} ${results.length === 1 ? "channel" : "channels"}${filterLabel}${searchLabel}.`;
  if (inlineCount && externalCount) {
    summary += ` ${inlineCount} ready in-browser, ${externalCount} open externally.`;
  } else if (inlineCount) {
    summary += ` ${inlineCount} ready in-browser.`;
  } else if (externalCount) {
    summary += ` ${externalCount} require an external player.`;
  }
  setStatus(summary);
}

function onFilterClick(event) {
  const button = event.target.closest("button[data-filter]");
  if (!button) return;
  const filter = button.dataset.filter || "all";
  if (state.filter === filter) return;
  state.filter = filter;
  updateActiveFilter();
  updateViewTitle();
  render();
}

function onSearchInput(event) {
  state.query = event.target.value || "";
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
  try {
    const [channels, streams, logos, categories] = await Promise.all([
      fetchJson(CHANNELS_URL),
      fetchJson(STREAMS_URL),
      fetchJson(LOGOS_URL),
      fetchJson(CATEGORIES_URL),
    ]);

    const categoriesMap = new Map((categories || []).map((cat) => [cat.id, cat]));
    const { logosByChannel, streamsByChannel } = buildMaps(logos, streams);

    const filtered = [];
    for (const channel of channels || []) {
      if (!channel || channel.country !== TARGET_COUNTRY || channel.is_nsfw) continue;
      const streamCandidates = streamsByChannel.get(channel.id);
      if (!streamCandidates || !streamCandidates.length) continue;
      const { stream, inlinePlayable, playbackKind } = chooseStream(streamCandidates);
      if (!stream) continue;

      const categoryIds = (channel.categories || [])
        .filter((id) => id && id !== "xxx");
      if (!categoryIds.length) categoryIds.push("general");

      const categoryNames = categoryIds.map((id) => labelForCategory(id, categoriesMap));
      const categoryLabel = categoryNames[0] || "General";
      const qualityLabel = formatQualityLabel(stream.quality);
      const logoEntries = logosByChannel.get(channel.id);
      const logo = pickLogo(logoEntries);

      filtered.push({
        id: channel.id,
        name: channel.name || channel.id,
        altNames: channel.alt_names || [],
        network: channel.network || "",
        owners: channel.owners || [],
        website: channel.website || "",
        categoryIds,
        categoryNames,
        categoryLabel,
        qualityLabel,
        stream,
        inlinePlayable,
        playbackKind,
        logo,
      });
    }

    filtered.sort((a, b) => a.name.localeCompare(b.name));
    state.channels = filtered;

    const { list, map } = buildFilterOptions(filtered, categoriesMap);
    state.filterOptions = map;

    if (filtersEl) {
      filtersEl.innerHTML = "";
      const fragment = document.createDocumentFragment();
      fragment.appendChild(createChip("all", "All", filtered.length));
      for (const option of list) {
        fragment.appendChild(createChip(option.id, option.label, option.count));
      }
      filtersEl.appendChild(fragment);
    }

    updateActiveFilter();
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

loadData();
