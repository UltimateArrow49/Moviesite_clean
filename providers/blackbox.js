const DEFAULT_HOSTS = [
  "https://theblackbox.watch",
  "https://theblackbox.ddns.net",
  "https://vidsrc.net",
  "https://vidsrc.me",
  "https://vidsrc.cc",
];

const STORAGE_KEY = "blackbox:last-mirror";

function sanitiseBase(base) {
  if (!base) return null;
  try {
    const url = new URL(
      base,
      typeof window !== "undefined" ? window.location.origin : undefined,
    );
    const pathname = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
    return `${url.origin}${pathname}`;
  } catch (error) {
    console.warn("Invalid BLACKBOX base URL provided, ignoring", error);
    return null;
  }
}

function unique(list) {
  return Array.from(new Set(list.filter(Boolean)));
}

function storedHost() {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage?.getItem(STORAGE_KEY) || window.localStorage?.getItem(STORAGE_KEY) || null;
  } catch (error) {
    console.warn("Unable to read stored BLACKBOX mirror", error);
    return null;
  }
}

function rememberHost(base) {
  if (typeof window === "undefined" || !base) return;
  try {
    window.sessionStorage?.setItem(STORAGE_KEY, base);
    window.localStorage?.setItem(STORAGE_KEY, base);
  } catch (error) {
    console.warn("Unable to persist BLACKBOX mirror", error);
  }
}

function collectHosts() {
  const hosts = [];

  if (typeof window !== "undefined") {
    if (window.BLACKBOX_BASE) hosts.push(window.BLACKBOX_BASE);
    if (Array.isArray(window.BLACKBOX_PROVIDERS)) hosts.push(...window.BLACKBOX_PROVIDERS);
    hosts.push(storedHost());
  }

  hosts.push(...DEFAULT_HOSTS);

  return unique(hosts.map(sanitiseBase));
}

function applyOptions(url, options = {}) {
  const params = url.searchParams;
  if (options.autoPlay) params.set("autoplay", "1");
  if (options.color) params.set("color", String(options.color).replace(/^#/, ""));
  if (options.nextEpisode) params.set("next", "1");
  if (options.episodeSelector) params.set("selector", "1");
  if (options.poster) params.set("poster", options.poster);
  if (options.extra && typeof options.extra === "object") {
    for (const [key, value] of Object.entries(options.extra)) {
      if (value == null) continue;
      params.set(key, String(value));
    }
  }
  return url.toString();
}

function toCandidate(url, baseHint) {
  if (!url) return null;
  try {
    const parsed = new URL(url, baseHint || undefined);
    return { url: parsed.toString(), base: `${parsed.origin}/` };
  } catch (error) {
    console.warn("Unable to normalise BLACKBOX candidate", url, error);
    if (typeof url === "string") {
      return { url, base: baseHint || url };
    }
    return null;
  }
}

function buildCandidates(builder) {
  const hosts = collectHosts();
  const candidates = [];

  if (typeof window !== "undefined" && window.BLACKBOX_PROVIDER) {
    const custom = builder(window.BLACKBOX_PROVIDER, true);
    if (Array.isArray(custom) && custom.length) {
      return custom;
    }
  }

  for (const base of hosts) {
    if (!base) continue;
    const candidate = builder(base);
    if (candidate) candidates.push(candidate);
  }

  return candidates;
}

export function movieEmbedCandidates(tmdbId, options = {}) {
  return buildCandidates((base, isProviderObject = false) => {
    if (isProviderObject) {
      const provider = base;
      if (typeof provider.movie === "function") {
        const out = provider.movie(tmdbId, options);
        if (!out) return null;
        const list = Array.isArray(out) ? out : [out];
        return list
          .map((entry) => toCandidate(entry, null))
          .filter(Boolean);
      }
      return null;
    }

    const url = new URL("embed/movie", base);
    url.searchParams.set("tmdb", String(tmdbId));
    return toCandidate(applyOptions(url, options), base);
  }).flat();
}

export function tvEmbedCandidates(tmdbId, season, episode, options = {}) {
  return buildCandidates((base, isProviderObject = false) => {
    if (isProviderObject) {
      const provider = base;
      if (typeof provider.tv === "function") {
        const out = provider.tv(tmdbId, season, episode, options);
        if (!out) return null;
        const list = Array.isArray(out) ? out : [out];
        return list
          .map((entry) => toCandidate(entry, null))
          .filter(Boolean);
      }
      return null;
    }

    const url = new URL("embed/tv", base);
    url.searchParams.set("tmdb", String(tmdbId));
    url.searchParams.set("season", String(season));
    url.searchParams.set("episode", String(episode));
    return toCandidate(applyOptions(url, options), base);
  }).flat();
}

export function movieEmbed(tmdbId, options = {}) {
  const [first] = movieEmbedCandidates(tmdbId, options);
  return first ? first.url : "";
}

export function tvEmbed(tmdbId, season, episode, options = {}) {
  const [first] = tvEmbedCandidates(tmdbId, season, episode, options);
  return first ? first.url : "";
}

export function registerWorkingBase(base) {
  rememberHost(base);
}

export function resolveEmbedBase() {
  const [first] = collectHosts();
  return first || null;
}

export function availableMirrors() {
  return collectHosts();
}
