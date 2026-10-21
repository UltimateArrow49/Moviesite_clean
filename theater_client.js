const THEATER_STORAGE_KEY = "tbb:theater:v2";
const THEATER_PLAYER_VERSION = "20260413c";

function readAllSessions() {
  try {
    const raw = localStorage.getItem(THEATER_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    console.warn("Unable to read theater sessions", error);
    return {};
  }
}

function writeAllSessions(value) {
  try {
    localStorage.setItem(THEATER_STORAGE_KEY, JSON.stringify(value));
  } catch (error) {
    console.warn("Unable to persist theater session", error);
  }
}

async function fetchJson(path, payload, { method = "POST" } = {}) {
  const response = await fetch(path, {
    method,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: payload == null || method === "GET" ? undefined : JSON.stringify(payload),
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = data?.detail || data?.error || `Request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.payload = data;
    throw error;
  }
  return data;
}

function normalizeInviteKey(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function getStoredTheaterSession(inviteKeyOrRoomId) {
  const key = normalizeInviteKey(inviteKeyOrRoomId);
  if (!key) return null;
  const sessions = readAllSessions();
  if (sessions[key] && typeof sessions[key] === "object") {
    return sessions[key];
  }
  return (
    Object.values(sessions).find(
      (session) => session && typeof session === "object" && session.roomId === key,
    ) || null
  );
}

export function saveTheaterSession(session) {
  const inviteKey = normalizeInviteKey(session?.inviteKey || session?.inviteToken);
  if (!inviteKey) return;
  const sessions = readAllSessions();
  sessions[inviteKey] = {
    roomId: session.roomId || null,
    inviteKey,
    inviteToken: inviteKey,
    hostToken: session.hostToken || null,
    memberToken: session.memberToken || null,
    memberId: session.memberId || null,
    displayName: session.displayName || "",
    role: session.role || "guest",
    shareUrl: session.shareUrl || buildJoinUrl(inviteKey),
  };
  writeAllSessions(sessions);
}

export function clearTheaterSession(inviteKeyOrRoomId) {
  const key = normalizeInviteKey(inviteKeyOrRoomId);
  if (!key) return;
  const sessions = readAllSessions();
  if (sessions[key]) {
    delete sessions[key];
    writeAllSessions(sessions);
    return;
  }
  const nextEntries = Object.entries(sessions).filter(([, session]) => session?.roomId !== key);
  writeAllSessions(Object.fromEntries(nextEntries));
}

export function buildEntryUrl(message = "") {
  const url = new URL("/theater.html", window.location.origin);
  url.searchParams.set("v", THEATER_PLAYER_VERSION);
  if (message) {
    url.searchParams.set("message", message);
  }
  return url.toString();
}

export function buildJoinUrl(inviteKey) {
  const url = new URL("/theater_join.html", window.location.origin);
  url.searchParams.set("invite", normalizeInviteKey(inviteKey));
  url.searchParams.set("v", THEATER_PLAYER_VERSION);
  return url.toString();
}

export function buildLobbyUrl(inviteKey, options = {}) {
  const url = new URL("/theater_lobby.html", window.location.origin);
  url.searchParams.set("invite", normalizeInviteKey(inviteKey));
  url.searchParams.set("v", THEATER_PLAYER_VERSION);
  return url.toString();
}

export function buildSearchUrl(inviteKey, options = {}) {
  const url = new URL("/theater_search.html", window.location.origin);
  url.searchParams.set("invite", normalizeInviteKey(inviteKey));
  url.searchParams.set("v", THEATER_PLAYER_VERSION);
  if (options.mode) url.searchParams.set("mode", options.mode);
  return url.toString();
}

export function buildPlayerUrl(media, inviteKey, options = {}) {
  const params = new URLSearchParams({
    mode: media.mode === "tv" ? "tv" : "movie",
    tmdb: String(media.tmdb),
    title: media.title || media.episodeTitle || media.showTitle || "theblackbox",
    autoplay: options.autoplay === false ? "false" : "true",
    color: "14ff9f",
    v: THEATER_PLAYER_VERSION,
  });
  if (media.poster) params.set("poster", media.poster);
  if (media.backdrop) params.set("backdrop", media.backdrop);
  if (media.releaseLabel) params.set("release", media.releaseLabel);
  if (media.mode === "tv") {
    if (media.showTitle) params.set("showTitle", media.showTitle);
    if (media.episodeTitle) params.set("episodeTitle", media.episodeTitle);
    if (Number.isFinite(Number(media.season))) params.set("season", String(media.season));
    if (Number.isFinite(Number(media.episode))) params.set("episode", String(media.episode));
  }
  const normalizedInvite = normalizeInviteKey(inviteKey);
  if (normalizedInvite) params.set("invite", normalizedInvite);
  if (options.audience) params.set("view", "audience");
  if (options.serverId) params.set("serverId", options.serverId);
  if (options.playbackMode) params.set("playbackMode", options.playbackMode);
  if (options.pendingStart) params.set("pendingStart", "1");
  if (options.commandId) params.set("commandId", options.commandId);
  if (options.sourceSessionId) params.set("sourceSessionId", options.sourceSessionId);
  if (options.syncHealth) params.set("syncHealth", options.syncHealth);
  if (Number.isFinite(Number(options.progress)) && Number(options.progress) > 0) {
    params.set("progress", String(Math.max(0, Math.floor(Number(options.progress)))));
  }
  return `/player.html?${params.toString()}`;
}

export function buildMoviePlayerUrl(media, inviteKey, options = {}) {
  return buildPlayerUrl(media, inviteKey, options);
}

export async function createTheaterRoom(displayName) {
  return fetchJson("/api/theater/rooms", { displayName });
}

export async function joinTheaterRoom(inviteKey, displayName) {
  return fetchJson(`/api/theater/rooms/${encodeURIComponent(normalizeInviteKey(inviteKey))}/join`, {
    displayName,
  });
}

export async function fetchTheaterState(inviteKey, memberToken) {
  const url = new URL(
    `/api/theater/rooms/${encodeURIComponent(normalizeInviteKey(inviteKey))}/state`,
    window.location.origin,
  );
  url.searchParams.set("memberToken", memberToken);
  return fetchJson(url.toString(), null, { method: "GET" });
}

export async function addTheaterSuggestion(inviteKey, memberToken, media) {
  return fetchJson(`/api/theater/rooms/${encodeURIComponent(normalizeInviteKey(inviteKey))}/suggestions`, {
    memberToken,
    media,
  });
}

export async function setTheaterVote(inviteKey, memberToken, suggestionId, active) {
  return fetchJson(`/api/theater/rooms/${encodeURIComponent(normalizeInviteKey(inviteKey))}/votes`, {
    memberToken,
    suggestionId,
    active,
  });
}

export async function selectTheaterMedia(inviteKey, hostToken, { suggestionId = null, media = null } = {}) {
  return fetchJson(`/api/theater/rooms/${encodeURIComponent(normalizeInviteKey(inviteKey))}/select`, {
    hostToken,
    suggestionId,
    media,
  });
}

export async function sendTheaterPresence(inviteKey, memberToken) {
  return fetchJson(`/api/theater/rooms/${encodeURIComponent(normalizeInviteKey(inviteKey))}/presence`, {
    memberToken,
  });
}

export async function reportTheaterReady(inviteKey, memberToken, commandId, options = {}) {
  return fetchJson(`/api/theater/rooms/${encodeURIComponent(normalizeInviteKey(inviteKey))}/ready`, {
    memberToken,
    commandId,
    status: options.status || "ready",
    currentTime: options.currentTime ?? 0,
  });
}

export async function publishTheaterPlayback(inviteKey, hostToken, payload) {
  return fetchJson(`/api/theater/rooms/${encodeURIComponent(normalizeInviteKey(inviteKey))}/playback`, {
    ...payload,
    hostToken,
  });
}

export async function resetTheaterScreening(inviteKey, hostToken) {
  return fetchJson(`/api/theater/rooms/${encodeURIComponent(normalizeInviteKey(inviteKey))}/reset`, {
    hostToken,
  });
}

export async function postTheaterChat(inviteKey, memberToken, body) {
  return fetchJson(`/api/theater/rooms/${encodeURIComponent(normalizeInviteKey(inviteKey))}/chat`, {
    memberToken,
    body,
  });
}

export async function closeTheaterRoom(inviteKey, hostToken, reason = "host_closed") {
  return fetchJson(`/api/theater/rooms/${encodeURIComponent(normalizeInviteKey(inviteKey))}/close`, {
    hostToken,
    reason,
  });
}

export function openTheaterEventStream(inviteKey, memberToken, { since = 0 } = {}) {
  const url = new URL(
    `/api/theater/rooms/${encodeURIComponent(normalizeInviteKey(inviteKey))}/events`,
    window.location.origin,
  );
  url.searchParams.set("memberToken", memberToken);
  if (since > 0) {
    url.searchParams.set("since", String(since));
  }
  return new EventSource(url);
}
