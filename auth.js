const USER_STORAGE_KEY = "tbb:user:v1";
const SESSION_USER_STORAGE_KEY = "tbb:user:session:v1";
const ACCOUNT_STORAGE_KEY = "tbb:accounts:v1";
const listeners = new Set();

const MIN_NAME_LENGTH = 3;
const MIN_PASSWORD_LENGTH = 8;

function sanitizeName(input) {
  if (typeof input !== "string") return "";
  return input
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 48);
}

function slugify(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "profile";
}

function encodeBase64(buffer) {
  if (!(buffer instanceof ArrayBuffer)) return "";
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function toBytes(value) {
  return new TextEncoder().encode(value);
}

async function hashPassword(password, salt) {
  const value = `${salt}:${password}`;
  const cryptoApi = window.crypto?.subtle;
  if (cryptoApi && typeof cryptoApi.digest === "function") {
    const data = toBytes(value);
    const digest = await cryptoApi.digest("SHA-256", data);
    return encodeBase64(digest);
  }
  const bytes = toBytes(value);
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  return encodeBase64(buffer);
}

function generateSalt(length = 16) {
  const array = new Uint8Array(length);
  if (window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(array);
  } else {
    for (let i = 0; i < length; i += 1) {
      array[i] = Math.floor(Math.random() * 256);
    }
  }
  return encodeBase64(array.buffer || array);
}

function validatePassword(password, normalizedName) {
  if (typeof password !== "string" || !password) {
    return "Enter a password.";
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) {
    return "Include letters and numbers in your password.";
  }
  if (normalizedName && password.toLowerCase().includes(normalizedName.toLowerCase())) {
    return "Avoid using your name in the password.";
  }
  return "";
}

function readAccountStore() {
  try {
    const raw = localStorage.getItem(ACCOUNT_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((entry) => ({
        id: typeof entry.id === "string" ? entry.id : null,
        name: sanitizeName(entry.name || ""),
        salt: typeof entry.salt === "string" ? entry.salt : null,
        hash: typeof entry.hash === "string" ? entry.hash : null,
        createdAt: Number.isFinite(Number(entry.createdAt))
          ? Number(entry.createdAt)
          : Date.now(),
      }))
      .filter((entry) => entry.id && entry.name && entry.salt && entry.hash);
  } catch (error) {
    console.warn("Unable to read account store", error);
    return [];
  }
}

function persistAccountStore(accounts) {
  try {
    localStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify(accounts));
  } catch (error) {
    console.warn("Unable to store account registry", error);
  }
}

let accountCache = readAccountStore();

function findAccountById(id) {
  if (!id) return null;
  return accountCache.find((entry) => entry.id === id) || null;
}

function findAccountByName(name) {
  const normalized = sanitizeName(name);
  if (!normalized) return null;
  const slug = slugify(normalized);
  return accountCache.find((entry) => entry.id === slug) || null;
}

function readUserFromStorage(storage, key, accounts = accountCache) {
  if (!storage || typeof storage.getItem !== "function") return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const id = typeof parsed.id === "string" && parsed.id.trim();
    if (!id) return null;
    const account = accounts.find((entry) => entry.id === id);
    if (!account) return null;
    return {
      id: account.id,
      name: account.name,
      createdAt: Number.isFinite(Number(parsed.createdAt))
        ? Number(parsed.createdAt)
        : account.createdAt,
    };
  } catch (error) {
    console.warn("Unable to read user session", error);
    return null;
  }
}

function safeReadUser(accounts = accountCache) {
  const persistent = readUserFromStorage(localStorage, USER_STORAGE_KEY, accounts);
  if (persistent) {
    return persistent;
  }
  const transientStorage = typeof sessionStorage !== "undefined" ? sessionStorage : null;
  return readUserFromStorage(transientStorage, SESSION_USER_STORAGE_KEY, accounts);
}

function clearStoredUsers() {
  try {
    localStorage.removeItem(USER_STORAGE_KEY);
  } catch (error) {
    console.warn("Unable to clear persisted user session", error);
  }
  if (typeof sessionStorage !== "undefined") {
    try {
      sessionStorage.removeItem(SESSION_USER_STORAGE_KEY);
    } catch (error) {
      console.warn("Unable to clear in-memory user session", error);
    }
  }
}

function persistUser(user, { remember = false } = {}) {
  clearStoredUsers();
  if (!user) {
    return;
  }
  const payload = JSON.stringify(user);
  try {
    if (remember) {
      localStorage.setItem(USER_STORAGE_KEY, payload);
    } else if (typeof sessionStorage !== "undefined") {
      sessionStorage.setItem(SESSION_USER_STORAGE_KEY, payload);
    }
  } catch (error) {
    console.warn("Unable to store user session", error);
  }
}

let currentUser = safeReadUser();

function setCurrentUser(nextUser) {
  const prevId = currentUser?.id || null;
  const prevName = currentUser?.name || null;
  const nextId = nextUser?.id || null;
  const nextName = nextUser?.name || null;
  if (prevId === nextId && prevName === nextName) {
    return false;
  }
  currentUser = nextUser || null;
  return true;
}

function notify() {
  for (const callback of listeners) {
    try {
      callback(currentUser);
    } catch (error) {
      console.warn("Error in auth change listener", error);
    }
  }
}

export function getCurrentUser() {
  return currentUser;
}

export function getActiveUserKey() {
  return currentUser?.id || "guest";
}

export async function createAccount(name, password) {
  const normalizedName = sanitizeName(name);
  if (!normalizedName) {
    return { success: false, error: "Enter a display name." };
  }
  if (normalizedName.length < MIN_NAME_LENGTH) {
    return {
      success: false,
      error: `Display name must be at least ${MIN_NAME_LENGTH} characters long.`,
    };
  }
  if (findAccountByName(normalizedName)) {
    return { success: false, error: "That name is already taken. Choose another." };
  }
  const passwordError = validatePassword(password, normalizedName);
  if (passwordError) {
    return { success: false, error: passwordError };
  }
  try {
    const salt = generateSalt();
    const hash = await hashPassword(password, salt);
    const account = {
      id: slugify(normalizedName),
      name: normalizedName,
      salt,
      hash,
      createdAt: Date.now(),
    };
    accountCache = [...accountCache.filter((entry) => entry.id !== account.id), account];
    persistAccountStore(accountCache);
    const userRecord = {
      id: account.id,
      name: account.name,
      createdAt: account.createdAt,
    };
    persistUser(userRecord, { remember: true });
    if (setCurrentUser(userRecord)) {
      notify();
    }
    return { success: true, user: userRecord };
  } catch (error) {
    console.warn("Unable to create account", error);
    return {
      success: false,
      error: error?.message || "We couldn't secure your password. Try again.",
    };
  }
}

export async function login(name, password, remember = false) {
  const normalizedName = sanitizeName(name);
  if (!normalizedName) {
    return { success: false, error: "Enter your display name." };
  }
  const account = findAccountByName(normalizedName);
  if (!account) {
    return { success: false, error: "No account found with that name." };
  }
  if (typeof password !== "string" || !password) {
    return { success: false, error: "Enter your password." };
  }
  try {
    const incoming = await hashPassword(password, account.salt);
    if (incoming !== account.hash) {
      return { success: false, error: "Incorrect password. Try again." };
    }
    const userRecord = {
      id: account.id,
      name: account.name,
      createdAt: account.createdAt,
    };
    persistUser(userRecord, { remember });
    if (setCurrentUser(userRecord)) {
      notify();
    }
    return { success: true, user: userRecord };
  } catch (error) {
    console.warn("Unable to verify password", error);
    return {
      success: false,
      error: error?.message || "Password check failed. Try again.",
    };
  }
}

export function logout() {
  persistUser(null);
  if (setCurrentUser(null)) {
    notify();
  }
}

export function onAuthChange(callback) {
  if (typeof callback !== "function") {
    return () => {};
  }
  listeners.add(callback);
  try {
    callback(currentUser);
  } catch (error) {
    console.warn("Error in auth change callback", error);
  }
  return () => {
    listeners.delete(callback);
  };
}

window.addEventListener("storage", (event) => {
  if (!event.key || (event.key !== USER_STORAGE_KEY && event.key !== ACCOUNT_STORAGE_KEY)) {
    return;
  }
  if (event.key === ACCOUNT_STORAGE_KEY) {
    accountCache = readAccountStore();
  }
  const stored = safeReadUser();
  if (!stored && currentUser) {
    persistUser(null);
  }
  if (setCurrentUser(stored)) {
    notify();
  }
});

