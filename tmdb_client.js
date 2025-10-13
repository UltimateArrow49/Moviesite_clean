const IMG_BASE = "https://image.tmdb.org/t/p/w500";
const BACKDROP_BASE = "https://image.tmdb.org/t/p/w780";
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_API_KEY = "REDACTED";
const TMDB_READ_TOKEN =
  "REDACTED";

async function requestTmdb(path, params = {}, { signal } = {}) {
  const query = new URLSearchParams(params);
  const cleanPath = String(path || "").replace(/^\/+/, "");

  const attempt = async (target, extraOptions = {}) => {
    const response = await fetch(target, {
      cache: "no-store",
      signal,
      ...extraOptions,
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(text || `TMDB request failed (${response.status})`);
    }
    if (!text) return {};

    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error("Received invalid JSON from TMDB");
    }
  };

  const headers = { Accept: "application/json" };
  if (TMDB_READ_TOKEN) {
    headers.Authorization = `Bearer ${TMDB_READ_TOKEN}`;
  }

  const directUrl = new URL(`${TMDB_BASE}/${cleanPath}`);
  for (const [key, value] of query.entries()) {
    directUrl.searchParams.set(key, value);
  }

  if (!headers.Authorization && !directUrl.searchParams.has("api_key")) {
    directUrl.searchParams.set("api_key", TMDB_API_KEY);
  }

  try {
    return await attempt(directUrl.toString(), { headers });
  } catch (directError) {
    if (directError.name === "AbortError") throw directError;
    console.warn("Direct TMDB request failed, retrying via proxy", directError);
  }

  try {
    const proxyQuery = query.toString();
    const proxyUrl = `/api/tmdb/${cleanPath}${proxyQuery ? `?${proxyQuery}` : ""}`;
    return await attempt(proxyUrl);
  } catch (proxyError) {
    if (proxyError.name === "AbortError") throw proxyError;
    throw proxyError;
  }
}

export { BACKDROP_BASE, IMG_BASE, requestTmdb };
