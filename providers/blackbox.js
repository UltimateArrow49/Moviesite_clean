const DEFAULT_BASE = "https://theblackbox.ddns.net";

function sanitiseBase(base) {
  if (!base) return DEFAULT_BASE;
  try {
    const url = new URL(base, typeof window !== "undefined" ? window.location.origin : undefined);
    const pathname = url.pathname.endsWith("/") ? url.pathname : `${url.pathname}/`;
    return `${url.origin}${pathname}`;
  } catch (error) {
    console.warn("Invalid BLACKBOX base URL provided, falling back to default", error);
    return DEFAULT_BASE;
  }
}

function getBase() {
  if (typeof window !== "undefined" && window.BLACKBOX_BASE) {
    return sanitiseBase(window.BLACKBOX_BASE);
  }
  return DEFAULT_BASE;
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

function withBase(base) {
  return base.endsWith("/") ? base : `${base}/`;
}

function defaultMovieEmbed(tmdbId, options) {
  const base = withBase(getBase());
  const url = new URL("embed/movie", base);
  url.searchParams.set("tmdb", String(tmdbId));
  return applyOptions(url, options);
}

function defaultTvEmbed(tmdbId, season, episode, options) {
  const base = withBase(getBase());
  const url = new URL("embed/tv", base);
  url.searchParams.set("tmdb", String(tmdbId));
  url.searchParams.set("season", String(season));
  url.searchParams.set("episode", String(episode));
  return applyOptions(url, options);
}

export function movieEmbed(tmdbId, options = {}) {
  if (typeof window !== "undefined" && window.BLACKBOX_PROVIDER && typeof window.BLACKBOX_PROVIDER.movie === "function") {
    return window.BLACKBOX_PROVIDER.movie(tmdbId, options);
  }
  return defaultMovieEmbed(tmdbId, options);
}

export function tvEmbed(tmdbId, season, episode, options = {}) {
  if (typeof window !== "undefined" && window.BLACKBOX_PROVIDER && typeof window.BLACKBOX_PROVIDER.tv === "function") {
    return window.BLACKBOX_PROVIDER.tv(tmdbId, season, episode, options);
  }
  return defaultTvEmbed(tmdbId, season, episode, options);
}

export function resolveEmbedBase() {
  return getBase();
}
