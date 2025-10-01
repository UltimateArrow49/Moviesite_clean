const VIDKING_BASE = "https://www.vidking.net/";

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
  const url = new URL(`embed/movie/${encodeURIComponent(tmdbId)}`, VIDKING_BASE);
  return applyOptions(url, options);
}

export function tvEmbed(tmdbId, season, episode, options = {}) {
  if (!tmdbId) return "";
  const safeSeason = season == null ? "" : encodeURIComponent(season);
  const safeEpisode = episode == null ? "" : encodeURIComponent(episode);
  const url = new URL(
    `embed/tv/${encodeURIComponent(tmdbId)}/${safeSeason || 1}/${safeEpisode || 1}`,
    VIDKING_BASE,
  );
  return applyOptions(url, options);
}
