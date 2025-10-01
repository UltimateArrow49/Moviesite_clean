const VIDKING_ORIGIN = "https://www.vidking.net";

function applyOptions(url, options = {}) {
  const params = url.searchParams;
  if (options.color) params.set("color", String(options.color).replace(/^#/, ""));
  if (options.autoPlay !== false && options.autoPlay !== "false") {
    params.set("autoPlay", "true");
  }
  if (options.nextEpisode) params.set("nextEpisode", "true");
  if (options.episodeSelector) params.set("episodeSelector", "true");
  if (typeof options.progress === "number" && Number.isFinite(options.progress)) {
    const clamped = Math.max(0, Math.floor(options.progress));
    if (clamped > 0) params.set("progress", String(clamped));
  }
  return url.toString();
}

export function movieEmbed(tmdbId, options = {}) {
  if (!tmdbId) return "";
  const base = `${VIDKING_ORIGIN}/embed/movie/${encodeURIComponent(tmdbId)}`;
  const url = new URL(base);
  return applyOptions(url, options);
}

export function tvEmbed(tmdbId, season, episode, options = {}) {
  if (!tmdbId) return "";
  const seasonSegment = season == null ? "1" : String(season);
  const episodeSegment = episode == null ? "1" : String(episode);
  const base = `${VIDKING_ORIGIN}/embed/tv/${encodeURIComponent(tmdbId)}/${encodeURIComponent(
    seasonSegment,
  )}/${encodeURIComponent(episodeSegment)}`;
  const url = new URL(base);
  return applyOptions(url, options);
}
