import { coverSources, joinBookFacts, primaryAction, requestBooks } from "./book_client.js?v=3";
import { setupAnimatedList } from "./ui_effects.js?v=16";

const SEARCH_DEBOUNCE_MS = 240;
const BOOK_PAGE_APPEND_COUNT = 24;

const searchForm = document.getElementById("bookSearchForm");
const searchInput = document.getElementById("bookSearch");
const statusLine = document.getElementById("booksStatus");
const grid = document.getElementById("booksGrid");
const loadMoreButton = document.getElementById("booksLoadMore");
const availabilityButtons = Array.from(document.querySelectorAll("[data-availability]"));

const sheet = document.getElementById("bookSheet");
const sheetTitle = document.getElementById("bookSheetTitle");
const sheetSource = document.getElementById("bookSheetSource");
const sheetAuthors = document.getElementById("bookSheetAuthors");
const sheetFacts = document.getElementById("bookSheetFacts");
const sheetDescription = document.getElementById("bookSheetDescription");
const sheetAvailability = document.getElementById("bookSheetAvailability");
const sheetActions = document.getElementById("bookSheetActions");
const sheetCover = document.getElementById("bookSheetCover");
const sheetPlaceholder = document.getElementById("bookSheetPlaceholder");
const closeSheetButton = document.getElementById("bookSheetClose");

const state = {
  query: "",
  availability: "all",
  page: 1,
  hasMore: false,
  items: [],
  isLoading: false,
  isAppending: false,
  requestId: 0,
  debounceId: null,
  activeController: null,
  detailsCache: new Map(),
};

if (grid) {
  setupAnimatedList(grid, { axis: "y" });
}

function setStatus(message) {
  if (!statusLine) return;
  statusLine.textContent = message || "";
  statusLine.hidden = !message;
}

function syncUrl() {
  const url = new URL(window.location.href);
  if (state.query) {
    url.searchParams.set("q", state.query);
  } else {
    url.searchParams.delete("q");
  }
  if (state.availability && state.availability !== "all") {
    url.searchParams.set("availability", state.availability);
  } else {
    url.searchParams.delete("availability");
  }
  history.replaceState({}, "", url);
}

function syncFilterButtons() {
  availabilityButtons.forEach((button) => {
    const active = button.dataset.availability === state.availability;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  });
}

function setBusyState({ append = false, loading = false } = {}) {
  state.isLoading = loading;
  state.isAppending = loading && append;
  if (grid) {
    grid.setAttribute("aria-busy", loading ? "true" : "false");
  }
  if (!loadMoreButton) return;

  loadMoreButton.hidden = !state.hasMore && !loading;
  loadMoreButton.disabled = loading;
  loadMoreButton.classList.toggle("btn--loading", loading);
  loadMoreButton.textContent = loading ? "Loading more..." : "Load more";
}

function setCoverImage(image, placeholder, book, coverElement) {
  const sources = coverSources(book);
  if (!image || !placeholder || !coverElement) return;

  image.loading = "lazy";
  image.decoding = "async";
  image.hidden = true;
  image.removeAttribute("src");
  image.onerror = null;
  image.onload = null;
  placeholder.hidden = true;
  placeholder.textContent = "No cover";
  coverElement.classList.remove("is-empty");

  if (!sources.length) {
    coverElement.classList.remove("is-loading");
    coverElement.classList.add("is-empty");
    placeholder.hidden = false;
    return;
  }

  let index = 0;
  coverElement.classList.add("is-loading");

  const loadAtIndex = () => {
    image.hidden = false;
    image.alt = `${book?.title || "Book"} cover`;
    image.src = sources[index];
  };

  image.onload = () => {
    coverElement.classList.remove("is-loading");
    coverElement.classList.remove("is-empty");
    placeholder.hidden = true;
  };

  image.onerror = () => {
    index += 1;
    if (index < sources.length) {
      loadAtIndex();
      return;
    }
    coverElement.classList.remove("is-loading");
    coverElement.classList.add("is-empty");
    image.hidden = true;
    image.removeAttribute("src");
    placeholder.hidden = false;
  };

  loadAtIndex();
}

function availabilityLabel(availability) {
  switch (availability) {
    case "read":
      return "Readable now";
    case "preview":
      return "Preview available";
    case "borrow":
      return "Borrow from source";
    case "external":
      return "Open on source";
    default:
      return "Metadata only";
  }
}

function renderSheet(book) {
  if (!book || !sheet) return;
  sheet.hidden = false;
  sheet.setAttribute("aria-hidden", "false");
  document.body.classList.add("sheet-open");

  sheetTitle.textContent = book.title || "Untitled";
  sheetSource.textContent = book.sourceLabel || "Book source";
  sheetAuthors.textContent = (book.authors || []).join(", ") || "Author information unavailable";
  sheetFacts.textContent = joinBookFacts(book) || "Availability stitched from multiple free sources.";
  sheetDescription.textContent =
    book.description ||
    "This edition does not include a full blurb yet, but you can still open the source if it is available.";
  sheetAvailability.textContent = availabilityLabel(book.availability);
  setCoverImage(sheetCover, sheetPlaceholder, book, sheetCover.parentElement);

  sheetActions.innerHTML = "";
  const action = primaryAction(book);
  if (action) {
    const link = document.createElement("a");
    link.className = "btn btn--primary";
    link.textContent = action.label;
    link.href = action.href;
    if (action.external) {
      link.target = "_blank";
      link.rel = "noreferrer noopener";
    }
    sheetActions.appendChild(link);
  }

  if (book.actions?.length > 1) {
    book.actions.slice(1, 3).forEach((actionItem) => {
      if (!actionItem?.url) return;
      const link = document.createElement("a");
      link.className = "btn btn--ghost";
      link.textContent = actionItem.label || "View source";
      link.href = actionItem.url;
      link.target = "_blank";
      link.rel = "noreferrer noopener";
      sheetActions.appendChild(link);
    });
  }
}

function closeSheet() {
  if (!sheet) return;
  sheet.hidden = true;
  sheet.setAttribute("aria-hidden", "true");
  document.body.classList.remove("sheet-open");
}

async function hydrateBook(book) {
  if (!book?.id) return;
  if (state.detailsCache.has(book.id)) {
    renderSheet({ ...book, ...state.detailsCache.get(book.id) });
    return;
  }
  try {
    const hydrated = await requestBooks(`item/${encodeURIComponent(book.id)}`, {}, { cache: "force-cache" });
    state.detailsCache.set(book.id, hydrated);
    renderSheet({ ...book, ...hydrated });
  } catch (error) {
    console.error(error);
  }
}

function createCard(book) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "book-card";
  button.dataset.bookId = book.id;

  const cover = document.createElement("div");
  cover.className = "book-card__cover";
  const image = document.createElement("img");
  const placeholder = document.createElement("div");
  placeholder.className = "book-card__placeholder";
  placeholder.textContent = "No cover";
  placeholder.hidden = true;
  cover.append(image, placeholder);
  setCoverImage(image, placeholder, book, cover);

  const badge = document.createElement("span");
  badge.className = `book-card__badge book-card__badge--${book.availability || "unavailable"}`;
  badge.textContent = availabilityLabel(book.availability);
  cover.appendChild(badge);

  const meta = document.createElement("div");
  meta.className = "book-card__meta";
  const title = document.createElement("h2");
  title.className = "book-card__title";
  title.textContent = book.title || "Untitled";
  const authors = document.createElement("p");
  authors.className = "book-card__authors";
  authors.textContent = (book.authors || []).join(", ") || "Unknown author";
  const facts = document.createElement("p");
  facts.className = "book-card__facts";
  facts.textContent = joinBookFacts(book) || availabilityLabel(book.availability);
  meta.append(title, authors, facts);

  button.append(cover, meta);
  button.addEventListener("click", () => {
    renderSheet(book);
    hydrateBook(book);
  });

  return button;
}

function renderResults({ append = false } = {}) {
  if (!grid) return;
  if (!append) {
    grid.innerHTML = "";
  }

  if (!state.items.length) {
    const empty = document.createElement("div");
    empty.className = "books-empty";
    empty.innerHTML = "<h2>No matches yet</h2><p>Try a different title, author, or availability filter.</p>";
    grid.appendChild(empty);
    return;
  }

  const fragment = document.createDocumentFragment();
  const items = append ? state.items.slice(-BOOK_PAGE_APPEND_COUNT) : state.items;
  items.forEach((book) => fragment.appendChild(createCard(book)));
  grid.appendChild(fragment);
}

function applyStatusMessage() {
  const total = state.items.length;
  if (!total) {
    setStatus("No matching books found right now.");
    return;
  }

  if (state.availability === "all") {
    setStatus(`Showing ${total} book result${total === 1 ? "" : "s"}.`);
    return;
  }

  setStatus(
    `Showing ${total} book result${total === 1 ? "" : "s"} with ${availabilityLabel(state.availability).toLowerCase()} priority.`,
  );
}

async function loadBooks({ append = false } = {}) {
  if (state.isLoading) {
    if (append) return;
    state.activeController?.abort();
  }

  const requestId = ++state.requestId;
  const controller = new AbortController();
  state.activeController = controller;
  setBusyState({ append, loading: true });
  setStatus(append ? "Loading more books..." : state.query ? `Searching for "${state.query}"...` : "Loading book library...");

  try {
    const payload = await requestBooks(
      "search",
      {
        q: state.query,
        availability: state.availability,
        page: state.page,
      },
      { signal: controller.signal },
    );
    if (requestId !== state.requestId) return;

    const items = Array.isArray(payload.items) ? payload.items : [];
    state.hasMore = Boolean(payload.hasMore);
    state.items = append ? [...state.items, ...items] : items;
    renderResults({ append });
    applyStatusMessage();
  } catch (error) {
    if (error.name === "AbortError") return;
    console.error(error);
    if (!append) {
      state.items = [];
      renderResults({ append: false });
    }
    setStatus("Unable to load the library right now. Please try again shortly.");
    state.hasMore = false;
  } finally {
    if (requestId === state.requestId) {
      state.activeController = null;
      setBusyState({ append: false, loading: false });
    }
  }
}

function scheduleSearch({ immediate = false } = {}) {
  if (state.debounceId) {
    clearTimeout(state.debounceId);
    state.debounceId = null;
  }
  syncUrl();
  if (immediate) {
    loadBooks({ append: false });
    return;
  }
  state.debounceId = window.setTimeout(() => {
    state.debounceId = null;
    loadBooks({ append: false });
  }, SEARCH_DEBOUNCE_MS);
}

function applyUrlState() {
  const url = new URL(window.location.href);
  state.query = (url.searchParams.get("q") || "").trim();
  state.availability = url.searchParams.get("availability") || "all";
  if (searchInput) {
    searchInput.value = state.query;
  }
  syncFilterButtons();
}

searchForm?.addEventListener("submit", (event) => {
  event.preventDefault();
  state.page = 1;
  state.query = (searchInput?.value || "").replace(/\s+/g, " ").trim();
  scheduleSearch({ immediate: true });
});

searchInput?.addEventListener("input", (event) => {
  state.page = 1;
  state.query = (event.target.value || "").replace(/\s+/g, " ").trim();
  scheduleSearch();
});

availabilityButtons.forEach((button) => {
  button.addEventListener("click", () => {
    const nextAvailability = button.dataset.availability || "all";
    if (state.availability === nextAvailability && !state.isLoading) return;
    state.availability = nextAvailability;
    state.page = 1;
    syncFilterButtons();
    scheduleSearch({ immediate: true });
  });
});

loadMoreButton?.addEventListener("click", () => {
  if (state.isLoading || !state.hasMore) return;
  state.page += 1;
  loadBooks({ append: true });
});

sheet?.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) return;
  if (target.dataset.closeSheet === "true") {
    closeSheet();
  }
});

closeSheetButton?.addEventListener("click", closeSheet);
window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    closeSheet();
  }
});

applyUrlState();
loadBooks({ append: false });
