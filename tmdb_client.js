const IMG_BASE = "https://image.tmdb.org/t/p/w500";
const BACKDROP_BASE = "https://image.tmdb.org/t/p/w780";
const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_API_KEY = "b7d1cc8554fcab41e013428e2dc418de";
const TMDB_READ_TOKEN =
  "eyJhbGciOiJIUzI1NiJ9.eyJhdWQiOiJiN2QxY2M4NTU0ZmNhYjQxZTAxMzQyOGUyZGM0MThkZSIsIm5iZiI6MTc1ODQ5NjE2Ny4yMDMsInN1YiI6IjY4ZDA4NWE3YzliZWIyZmZjYmQ0MTliMCIsInNjb3BlcyI6WyJhcGlfcmVhZCJdLCJ2ZXJzaW9uIjoxfQ.Q2gi3xRWiPq8_2zICdbvvQ3hT0GQf6zQUGtRrBYXvcU";
const INFO_RELAY_BASE = "https://info-relay.theblackbox.run";

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

  const queryString = query.toString();
  const attempts = [
    { url: directUrl.toString(), options: { headers } },
  ];

  const proxyPath = `/api/tmdb/${cleanPath}${queryString ? `?${queryString}` : ""}`;
  attempts.push({ url: proxyPath, options: {} });

  if (INFO_RELAY_BASE) {
    const base = INFO_RELAY_BASE.replace(/\/+$/, "");
    const relayUrl = `${base}${proxyPath}`;
    attempts.push({ url: relayUrl, options: {} });
  }

  let lastError = null;
  for (const { url, options } of attempts) {
    try {
      return await attempt(url, options);
    } catch (error) {
      if (error.name === "AbortError") throw error;
      lastError = error;
      console.warn(`TMDB fetch via ${url} failed`, error);
    }
  }

  throw lastError || new Error("TMDB request failed");
}

export { BACKDROP_BASE, IMG_BASE, requestTmdb };
