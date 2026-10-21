import {
  mergeHistoryEntries,
  readStoredHistory,
  replaceHistoryEntries,
} from "./continue_watching.js?v=11";
import {
  formatRelativeTime,
  getRecentlyWatched,
  mergeRecentlyWatched,
  replaceRecentlyWatched,
} from "./recently_watched.js?v=11";

const SYNC_STORAGE_KEY = "tbb:sync:v1";
const SAVE_DEBOUNCE_MS = 1200;
const EVENT_NAME = "progresssyncchange";

const state = {
  syncKey: null,
  connected: false,
  isConnecting: false,
  isSaving: false,
  pendingSave: false,
  lastSyncedAt: null,
  mode: "idle",
  message: "",
};

let suppressSyncWrites = false;
let saveTimer = null;

function readStoredSession() {
  try {
    const raw = localStorage.getItem(SYNC_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch (error) {
    console.warn("Unable to read sync session", error);
    return null;
  }
}

function persistStoredSession() {
  if (!state.syncKey) return;
  try {
    localStorage.setItem(
      SYNC_STORAGE_KEY,
      JSON.stringify({
        syncKey: state.syncKey,
        lastSyncedAt: state.lastSyncedAt,
      }),
    );
  } catch (error) {
    console.warn("Unable to persist sync session", error);
  }
}

function clearStoredSession() {
  try {
    localStorage.removeItem(SYNC_STORAGE_KEY);
  } catch (error) {
    console.warn("Unable to clear sync session", error);
  }
}

function emitChange() {
  window.dispatchEvent(
    new CustomEvent(EVENT_NAME, {
      detail: {
        ...state,
      },
    }),
  );
}

function setState(patch) {
  Object.assign(state, patch);
  emitChange();
}

function normalizePassphrase(passphrase) {
  return typeof passphrase === "string" ? passphrase.trim() : "";
}

async function deriveSyncKey(passphrase) {
  const normalized = normalizePassphrase(passphrase);
  if (!normalized) {
    throw new Error("Enter a passphrase to connect sync.");
  }
  if (!window.crypto?.subtle) {
    throw new Error("This browser cannot create a sync key right now.");
  }
  const digest = await window.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(normalized),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function postJson(path, payload, { keepalive = false } = {}) {
  const response = await fetch(path, {
    method: "POST",
    keepalive,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(payload),
  });

  let parsed = null;
  try {
    parsed = await response.json();
  } catch (error) {
    parsed = null;
  }

  if (!response.ok) {
    const message =
      parsed?.error ||
      parsed?.detail ||
      `Request failed with status ${response.status}`;
    throw new Error(message);
  }
  return parsed || {};
}

function applyMergedPayload(payload, { merge = false } = {}) {
  suppressSyncWrites = true;
  try {
    if (merge) {
      mergeHistoryEntries(payload.history || []);
      mergeRecentlyWatched(payload.recent || []);
      return;
    }
    replaceHistoryEntries(payload.history || []);
    replaceRecentlyWatched(payload.recent || []);
  } finally {
    suppressSyncWrites = false;
  }
}

function connectedMessage() {
  if (!state.lastSyncedAt) {
    return "Sync connected. New progress will follow you between devices.";
  }
  return `Last sync ${formatRelativeTime(state.lastSyncedAt)}.`;
}

async function flushSave({ announce = false, keepalive = false } = {}) {
  if (!state.syncKey || state.isSaving || state.isConnecting) return null;
  clearTimeout(saveTimer);
  saveTimer = null;
  setState({
    isSaving: true,
    mode: announce ? "saving" : state.mode,
    message: announce ? "Saving progress to sync…" : state.message,
  });

  try {
    const response = await postJson("/api/sync/save", {
      syncKey: state.syncKey,
      history: readStoredHistory(),
      recent: getRecentlyWatched(),
    }, { keepalive });
    applyMergedPayload(response, { merge: false });
    state.pendingSave = false;
    state.connected = true;
    state.lastSyncedAt = response.lastSyncedAt || Date.now();
    state.mode = "connected";
    state.message = connectedMessage();
    persistStoredSession();
    return response;
  } catch (error) {
    state.pendingSave = true;
    state.connected = false;
    state.mode = navigator.onLine === false ? "offline" : "error";
    state.message = "Sync is unavailable right now. Local progress is still safe.";
    persistStoredSession();
    return null;
  } finally {
    state.isSaving = false;
    emitChange();
  }
}

function scheduleSave() {
  if (!state.syncKey || suppressSyncWrites) return;
  state.pendingSave = true;
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    flushSave();
  }, SAVE_DEBOUNCE_MS);
  emitChange();
}

async function connectWithSyncKey(syncKey, { announce = true } = {}) {
  if (!syncKey) return false;
  setState({
    syncKey,
    isConnecting: true,
    connected: false,
    mode: "connecting",
    message: "Connecting sync…",
  });

  try {
    const payload = await postJson("/api/sync/connect", { syncKey });
    applyMergedPayload(payload, { merge: true });
    state.syncKey = syncKey;
    state.connected = true;
    state.lastSyncedAt = payload.lastSyncedAt || null;
    state.mode = "connected";
    state.message = connectedMessage();
    persistStoredSession();
    emitChange();
    await flushSave({ announce: !payload.lastSyncedAt && announce });
    return true;
  } catch (error) {
    state.syncKey = syncKey;
    state.connected = false;
    state.mode = navigator.onLine === false ? "offline" : "error";
    state.message = "Unable to reach sync right now. Local progress is still saved.";
    persistStoredSession();
    emitChange();
    return false;
  } finally {
    state.isConnecting = false;
    emitChange();
  }
}

async function connectWithPassphrase(passphrase) {
  const syncKey = await deriveSyncKey(passphrase);
  return connectWithSyncKey(syncKey);
}

function disconnectSync({ message = "This device is back to local-only progress." } = {}) {
  clearTimeout(saveTimer);
  saveTimer = null;
  clearStoredSession();
  setState({
    syncKey: null,
    connected: false,
    isConnecting: false,
    isSaving: false,
    pendingSave: false,
    lastSyncedAt: null,
    mode: "disconnected",
    message,
  });
}

function getElements() {
  return {
    panel: document.getElementById("syncPanel"),
    form: document.getElementById("syncForm"),
    passphrase: document.getElementById("syncPassphrase"),
    disconnected: document.getElementById("syncDisconnected"),
    connected: document.getElementById("syncConnected"),
    stateLine: document.getElementById("syncStateLine"),
    status: document.getElementById("syncStatus"),
    lastSynced: document.getElementById("syncLastSynced"),
    switchButton: document.getElementById("syncSwitch"),
    disconnectButton: document.getElementById("syncDisconnect"),
  };
}

function renderHomePanel() {
  const elements = getElements();
  if (!elements.panel) return;

  const showConnected = Boolean(state.syncKey);
  if (elements.disconnected) {
    elements.disconnected.hidden = showConnected;
  }
  if (elements.connected) {
    elements.connected.hidden = !showConnected;
  }

  if (elements.stateLine) {
    elements.stateLine.textContent = showConnected
      ? "This device will keep trying to sync your saved progress."
      : "Use a private passphrase to carry your progress between devices.";
  }

  if (elements.status) {
    const showStatus = Boolean(state.message);
    elements.status.hidden = !showStatus;
    elements.status.textContent = state.message;
    elements.status.dataset.state = state.mode || "idle";
  }

  if (elements.lastSynced) {
    elements.lastSynced.textContent = state.lastSyncedAt
      ? `Last sync ${formatRelativeTime(state.lastSyncedAt)}`
      : "Waiting for your first synced update.";
  }

  if (elements.form) {
    const button = elements.form.querySelector('button[type="submit"]');
    if (button) {
      button.disabled = state.isConnecting || state.isSaving;
      button.textContent = state.isConnecting ? "Connecting…" : "Connect sync";
    }
  }

  if (elements.passphrase && !showConnected && !state.isConnecting) {
    elements.passphrase.disabled = false;
  }
}

function bindHomePanel() {
  const elements = getElements();
  if (!elements.panel || !elements.form || !elements.passphrase) return;

  elements.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const passphrase = elements.passphrase.value;
    try {
      await connectWithPassphrase(passphrase);
      elements.passphrase.value = "";
    } catch (error) {
      setState({
        mode: "error",
        message: error instanceof Error ? error.message : "Unable to connect sync.",
      });
    }
  });

  elements.switchButton?.addEventListener("click", () => {
    disconnectSync({
      message: "Enter a different passphrase to connect another progress history.",
    });
    elements.passphrase.value = "";
    elements.passphrase.focus();
  });

  elements.disconnectButton?.addEventListener("click", () => {
    disconnectSync({});
    elements.passphrase.value = "";
  });

  renderHomePanel();
  window.addEventListener(EVENT_NAME, renderHomePanel);
}

function initBackgroundSync() {
  window.addEventListener("continuewatchingchange", () => {
    if (suppressSyncWrites) return;
    scheduleSave();
  });
  window.addEventListener("recentlychange", () => {
    if (suppressSyncWrites) return;
    scheduleSave();
  });
  window.addEventListener("online", () => {
    if (!state.syncKey) return;
    if (state.connected || state.pendingSave) {
      flushSave({ announce: true });
      return;
    }
    connectWithSyncKey(state.syncKey, { announce: true });
  });
  window.addEventListener("pagehide", () => {
    if (!state.syncKey || !state.pendingSave) return;
    flushSave({ keepalive: true });
  });
}

function initStoredConnection() {
  const stored = readStoredSession();
  if (!stored?.syncKey) {
    setState({
      mode: "disconnected",
      message: "",
    });
    return;
  }
  state.syncKey = stored.syncKey;
  state.lastSyncedAt = Number.isFinite(Number(stored.lastSyncedAt))
    ? Number(stored.lastSyncedAt)
    : null;
  emitChange();
  connectWithSyncKey(stored.syncKey, { announce: false });
}

bindHomePanel();
initBackgroundSync();
initStoredConnection();

export {
  connectWithPassphrase,
  connectWithSyncKey,
  disconnectSync,
  flushSave,
};
