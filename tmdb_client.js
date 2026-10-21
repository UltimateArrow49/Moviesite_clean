const IMG_BASE = "https://image.tmdb.org/t/p/w500";
const BACKDROP_BASE = "https://image.tmdb.org/t/p/w780";
const INFO_RELAY_BASE = "https://info-relay.theblackbox.run";

async function requestTmdb(path, params = {}, { signal } = {}) {
  const query = new URLSearchParams(params);
  const cleanPath = String(path || "").replace(/^\/+/, "");
  const queryString = query.toString();
  const proxyPath = `/api/tmdb/${cleanPath}${queryString ? `?${queryString}` : ""}`;

  const attempt = async (target) => {
    const response = await fetch(target, {
      cache: "no-store",
      signal,
      headers: {
        Accept: "application/json",
      },
    });

    const text = await response.text();
    if (!response.ok) {
      throw new Error(text || `TMDB request failed (${response.status})`);
    }
    if (!text) {
      return {};
    }

    try {
      return JSON.parse(text);
    } catch (error) {
      throw new Error("Received invalid JSON from TMDB");
    }
  };

  const attempts = [proxyPath];
  if (INFO_RELAY_BASE) {
    attempts.push(`${INFO_RELAY_BASE.replace(/\/+$/, "")}${proxyPath}`);
  }

  let lastError = null;
  for (const target of attempts) {
    try {
      return await attempt(target);
    } catch (error) {
      if (error.name === "AbortError") throw error;
      lastError = error;
      console.warn(`TMDB fetch via ${target} failed`, error);
    }
  }

  throw lastError || new Error("TMDB request failed");
}

export { BACKDROP_BASE, IMG_BASE, requestTmdb };
