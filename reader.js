import { joinBookFacts, requestBooks } from "./book_client.js?v=3";

const SWIPE_THRESHOLD = 48;
const MIN_TEXT_SCALE = 90;
const MAX_TEXT_SCALE = 180;
const MIN_PDF_ZOOM = 0.85;
const MAX_PDF_ZOOM = 2.2;

const readerBackButton = document.getElementById("readerBack");
const readerSourceLink = document.getElementById("readerSourceLink");
const readerSourceLabel = document.getElementById("readerSourceLabel");
const readerTitle = document.getElementById("readerTitle");
const readerSubtitle = document.getElementById("readerSubtitle");
const readerStatus = document.getElementById("readerStatus");
const readerControls = document.getElementById("readerControls");
const readerPrev = document.getElementById("readerPrev");
const readerNext = document.getElementById("readerNext");
const readerProgress = document.getElementById("readerProgress");
const readerSurface = document.getElementById("readerSurface");
const readerEmpty = document.getElementById("readerEmpty");
const readerZoomOut = document.getElementById("readerZoomOut");
const readerZoomIn = document.getElementById("readerZoomIn");
const readerFullscreen = document.getElementById("readerFullscreen");

const state = {
  cleanup: null,
  prevAction: null,
  nextAction: null,
  zoomInAction: null,
  zoomOutAction: null,
  immersiveFallback: false,
  touchStartX: 0,
  touchStartY: 0,
  touchTracking: false,
  touchAxis: null,
};

function setStatus(message) {
  if (readerStatus) readerStatus.textContent = message || "";
}

function setControls({ visible = false, prevDisabled = true, nextDisabled = true, progress = "" } = {}) {
  if (!readerControls || !readerPrev || !readerNext || !readerProgress) return;
  readerControls.hidden = !visible;
  readerPrev.disabled = prevDisabled;
  readerNext.disabled = nextDisabled;
  readerProgress.textContent = progress;
}

function setZoomControls({ enabled = false, zoomInDisabled = false, zoomOutDisabled = false } = {}) {
  if (readerZoomIn) readerZoomIn.disabled = !enabled || zoomInDisabled;
  if (readerZoomOut) readerZoomOut.disabled = !enabled || zoomOutDisabled;
}

function setNavigationHandlers({ prev = null, next = null } = {}) {
  state.prevAction = prev;
  state.nextAction = next;
}

function setZoomHandlers({ zoomIn = null, zoomOut = null } = {}) {
  state.zoomInAction = zoomIn;
  state.zoomOutAction = zoomOut;
}

function syncFullscreenButton() {
  if (!readerFullscreen) return;
  readerFullscreen.textContent =
    document.fullscreenElement || state.immersiveFallback ? "Exit reader" : "Fullscreen";
}

function setImmersiveFallback(enabled) {
  state.immersiveFallback = Boolean(enabled);
  document.body.classList.toggle("reader-immersive", state.immersiveFallback);
  readerSurface?.classList.toggle("is-immersive", state.immersiveFallback);
  syncFullscreenButton();
}

function clearSurface() {
  if (typeof state.cleanup === "function") {
    try {
      state.cleanup();
    } catch (error) {
      console.warn("Unable to clean up reader state", error);
    }
  }
  state.cleanup = null;
  setNavigationHandlers();
  setZoomHandlers();
  setZoomControls({ enabled: false });
  setControls({ visible: false });

  if (readerSurface) {
    readerSurface.innerHTML = "";
    readerSurface.scrollTop = 0;
    readerSurface.classList.remove("reader-surface--stepped");
  }

  if (readerSurface && readerEmpty) {
    readerEmpty.hidden = false;
    readerSurface.appendChild(readerEmpty);
  }
}

function showEmpty(title, body, action = null) {
  clearSurface();
  if (!readerEmpty) return;
  readerEmpty.innerHTML = "";
  const heading = document.createElement("h2");
  heading.textContent = title;
  const copy = document.createElement("p");
  copy.textContent = body;
  readerEmpty.append(heading, copy);
  if (action?.href) {
    const link = document.createElement("a");
    link.className = "btn btn--primary";
    link.href = action.href;
    link.textContent = action.label || "View source";
    if (action.external) {
      link.target = "_blank";
      link.rel = "noreferrer noopener";
    }
    readerEmpty.appendChild(link);
  }
}

function setSourceLink(book) {
  if (!readerSourceLink) return;
  const sourceAction = (book?.actions || []).find((action) => action?.url);
  if (!sourceAction?.url) {
    readerSourceLink.hidden = true;
    readerSourceLink.removeAttribute("href");
    return;
  }
  readerSourceLink.hidden = false;
  readerSourceLink.href = sourceAction.url;
  readerSourceLink.textContent = sourceAction.label || "View source";
}

function updateHeader(book) {
  if (readerSourceLabel) readerSourceLabel.textContent = book?.sourceLabel || "Books";
  if (readerTitle) readerTitle.textContent = book?.title || "Untitled";
  if (readerSubtitle) {
    const authors = (book?.authors || []).join(", ");
    const facts = joinBookFacts(book);
    readerSubtitle.textContent = [authors, facts].filter(Boolean).join(" · ");
  }
  setSourceLink(book);
}

function isProbablyGarbage(text) {
  const sample = String(text || "").trim();
  if (!sample) return true;
  if (/archive\.org\/details/i.test(sample)) return true;
  if (/digitized by the internet archive/i.test(sample)) return true;
  if (/presented to the library of/i.test(sample)) return true;
  const letters = (sample.match(/[A-Za-z]/g) || []).length;
  const strange = (sample.match(/[^A-Za-z0-9\s,.;:'"!?()[\]-]/g) || []).length;
  if (!letters && strange > 0) return true;
  if (sample.length > 12 && strange / Math.max(1, sample.length) > 0.22) return true;
  return false;
}

function normalizeParagraph(text) {
  return String(text || "")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function classifyBlock(text) {
  const trimmed = normalizeParagraph(text);
  if (!trimmed) return null;
  if (isProbablyGarbage(trimmed)) return null;
  if (trimmed.length < 90 && !/[.!?]["']?$/.test(trimmed)) {
    return { type: "heading", text: trimmed };
  }
  return { type: "paragraph", text: trimmed };
}

function extractBlocksFromHtml(rawHtml) {
  const parser = new DOMParser();
  const parsed = parser.parseFromString(rawHtml, "text/html");
  const root = parsed.body || parsed.documentElement;
  const selectors = "h1,h2,h3,h4,h5,h6,p,blockquote,li,pre,article,section,div";
  const nodes = Array.from(root.querySelectorAll(selectors));
  const blocks = [];

  for (const node of nodes) {
    const text = normalizeParagraph(node.textContent || "");
    if (!text) continue;
    if (text.length > 5000 && /\n/.test(text)) {
      text.split(/\n{2,}/).forEach((chunk) => {
        const block = classifyBlock(chunk);
        if (block) blocks.push(block);
      });
      continue;
    }
    const block = classifyBlock(text);
    if (block) blocks.push(block);
  }

  if (blocks.length) return blocks;
  return extractBlocksFromText(root.textContent || "");
}

function extractBlocksFromText(rawText) {
  const trimmed = normalizeParagraph(rawText);
  if (!trimmed) return [];
  const chunks = trimmed.split(/\n{2,}/);
  const blocks = [];
  for (const chunk of chunks) {
    const block = classifyBlock(chunk);
    if (block) blocks.push(block);
  }
  return blocks;
}

function chunkBlocksIntoPages(blocks, charsPerPage) {
  const pages = [];
  let current = [];
  let count = 0;

  const flush = () => {
    if (!current.length) return;
    pages.push(current);
    current = [];
    count = 0;
  };

  for (const block of blocks) {
    const weight = block.type === "heading" ? block.text.length + 120 : block.text.length + 40;
    if (current.length && count + weight > charsPerPage) {
      flush();
    }
    current.push(block);
    count += weight;
  }
  flush();
  return pages.length ? pages : [[{ type: "paragraph", text: "No readable content found." }]];
}

function createPagedBookRenderer(blocks, { title }) {
  if (!readerSurface) return;
  clearSurface();
  readerEmpty?.remove();

  const book = document.createElement("article");
  book.className = "reader-book";
  const sheet = document.createElement("div");
  sheet.className = "reader-book__sheet";
  const page = document.createElement("div");
  page.className = "reader-book__page";
  sheet.appendChild(page);
  book.appendChild(sheet);
  readerSurface.appendChild(book);
  readerSurface.classList.add("reader-surface--stepped");

  let textScale = 104;
  let currentPageIndex = 0;

  const charsPerPageForScale = () => {
    const isCompact = window.matchMedia("(max-width: 720px)").matches;
    const base = isCompact ? 1200 : 1900;
    return Math.max(680, Math.round(base * (100 / textScale)));
  };

  let pages = chunkBlocksIntoPages(blocks, charsPerPageForScale());

  const renderPage = () => {
    page.innerHTML = "";

    const header = document.createElement("div");
    header.className = "reader-book__header";
    header.textContent = title || "theblackbox library";
    page.appendChild(header);

    const body = document.createElement("div");
    body.className = "reader-book__body";
    for (const block of pages[currentPageIndex] || []) {
      const element = document.createElement(block.type === "heading" ? "h2" : "p");
      element.textContent = block.text;
      body.appendChild(element);
    }
    page.appendChild(body);

    const footer = document.createElement("div");
    footer.className = "reader-book__footer";
    footer.textContent = `Page ${currentPageIndex + 1} of ${pages.length}`;
    page.appendChild(footer);

    page.style.setProperty("--reader-book-scale", String(textScale / 100));
    setControls({
      visible: true,
      prevDisabled: currentPageIndex <= 0,
      nextDisabled: currentPageIndex >= pages.length - 1,
      progress: `Page ${currentPageIndex + 1} of ${pages.length}`,
    });
    setZoomControls({
      enabled: true,
      zoomOutDisabled: textScale <= MIN_TEXT_SCALE,
      zoomInDisabled: textScale >= MAX_TEXT_SCALE,
    });
  };

  const rebuildPages = () => {
    const beforeRatio = pages.length ? currentPageIndex / Math.max(1, pages.length - 1) : 0;
    pages = chunkBlocksIntoPages(blocks, charsPerPageForScale());
    currentPageIndex = Math.min(pages.length - 1, Math.round(beforeRatio * Math.max(0, pages.length - 1)));
    renderPage();
  };

  setNavigationHandlers({
    prev: () => {
      if (currentPageIndex <= 0) return;
      currentPageIndex -= 1;
      renderPage();
    },
    next: () => {
      if (currentPageIndex >= pages.length - 1) return;
      currentPageIndex += 1;
      renderPage();
    },
  });
  setZoomHandlers({
    zoomOut: () => {
      textScale = Math.max(MIN_TEXT_SCALE, textScale - 10);
      rebuildPages();
    },
    zoomIn: () => {
      textScale = Math.min(MAX_TEXT_SCALE, textScale + 10);
      rebuildPages();
    },
  });

  state.cleanup = () => {
    window.removeEventListener("resize", rebuildPages);
  };

  window.addEventListener("resize", rebuildPages);
  renderPage();
}

async function renderHtmlBook(book) {
  if (!book?.proxyUrl) throw new Error("Missing readable HTML source.");
  const response = await fetch(book.proxyUrl, { cache: "force-cache" });
  if (!response.ok) {
    throw new Error(`Unable to fetch HTML edition (${response.status})`);
  }
  const rawHtml = await response.text();
  const blocks = extractBlocksFromHtml(rawHtml);
  createPagedBookRenderer(blocks, { title: book.title });
  setStatus("Book pages loaded.");
}

async function renderTextBook(book) {
  if (!book?.proxyUrl) throw new Error("Missing readable text source.");
  const response = await fetch(book.proxyUrl, { cache: "force-cache" });
  if (!response.ok) {
    throw new Error(`Unable to fetch text edition (${response.status})`);
  }
  const text = await response.text();
  const blocks = extractBlocksFromText(text);
  createPagedBookRenderer(blocks, { title: book.title });
  setStatus("Book pages loaded.");
}

async function renderPdfBook(book) {
  if (!book?.proxyUrl || !readerSurface || !window.pdfjsLib) {
    throw new Error("PDF reader is unavailable.");
  }
  window.pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";

  const loadingTask = window.pdfjsLib.getDocument(book.proxyUrl);
  const pdf = await loadingTask.promise;
  let currentPage = 1;
  let zoomFactor = 1;

  clearSurface();
  readerEmpty?.remove();

  const wrap = document.createElement("div");
  wrap.className = "reader-canvas";
  const canvas = document.createElement("canvas");
  wrap.appendChild(canvas);
  readerSurface.appendChild(wrap);

  async function drawPage(pageNumber) {
    const page = await pdf.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1, rotation: page.rotate || 0 });
    const availableWidth = Math.max(280, readerSurface.clientWidth - 40);
    const fitScale = availableWidth / Math.max(1, baseViewport.width);
    const renderScale = Math.max(MIN_PDF_ZOOM, Math.min(MAX_PDF_ZOOM, fitScale * zoomFactor));
    const viewport = page.getViewport({ scale: renderScale, rotation: page.rotate || 0 });
    const context = canvas.getContext("2d");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    await page.render({ canvasContext: context, viewport }).promise;
    currentPage = pageNumber;
    setControls({
      visible: true,
      prevDisabled: currentPage <= 1,
      nextDisabled: currentPage >= pdf.numPages,
      progress: `Page ${currentPage} of ${pdf.numPages}`,
    });
    setZoomControls({
      enabled: true,
      zoomOutDisabled: zoomFactor <= MIN_PDF_ZOOM,
      zoomInDisabled: zoomFactor >= MAX_PDF_ZOOM,
    });
  }

  await drawPage(1);
  setNavigationHandlers({
    prev: () => {
      if (currentPage <= 1) return;
      drawPage(currentPage - 1).catch((error) => {
        console.error(error);
        setStatus("Unable to move to the previous page.");
      });
    },
    next: () => {
      if (currentPage >= pdf.numPages) return;
      drawPage(currentPage + 1).catch((error) => {
        console.error(error);
        setStatus("Unable to move to the next page.");
      });
    },
  });
  setZoomHandlers({
    zoomOut: () => {
      zoomFactor = Math.max(MIN_PDF_ZOOM, Number((zoomFactor - 0.12).toFixed(2)));
      drawPage(currentPage).catch((error) => {
        console.error(error);
        setStatus("Unable to zoom out.");
      });
    },
    zoomIn: () => {
      zoomFactor = Math.min(MAX_PDF_ZOOM, Number((zoomFactor + 0.12).toFixed(2)));
      drawPage(currentPage).catch((error) => {
        console.error(error);
        setStatus("Unable to zoom in.");
      });
    },
  });
  state.cleanup = () => {
    loadingTask.destroy();
  };
  setStatus("PDF edition loaded.");
}

async function renderEpubBook(book) {
  if (!book?.proxyUrl || !readerSurface || typeof window.ePub !== "function") {
    throw new Error("EPUB reader is unavailable.");
  }
  const response = await fetch(book.proxyUrl, { cache: "force-cache" });
  if (!response.ok) {
    throw new Error(`Unable to fetch EPUB edition (${response.status})`);
  }
  const epubBuffer = await response.arrayBuffer();

  clearSurface();
  readerEmpty?.remove();

  const wrap = document.createElement("div");
  wrap.className = "reader-epub";
  readerSurface.appendChild(wrap);

  const epubBook = window.ePub(epubBuffer);
  const rendition = epubBook.renderTo(wrap, {
    width: "100%",
    height: "100%",
    spread: "none",
    flow: "paginated",
  });

  rendition.themes.default({
    body: {
      color: "#2a1f17",
      "background-color": "#f7f0df",
      margin: "0",
      padding: "28px 22px 40px",
      "font-size": "1.08rem",
      "line-height": "1.85",
      "font-family": "Georgia, 'Iowan Old Style', 'Times New Roman', serif",
    },
    p: {
      "margin-bottom": "1em",
    },
    h1: {
      "font-size": "1.8rem",
      "line-height": "1.2",
    },
    h2: {
      "font-size": "1.35rem",
      "line-height": "1.25",
    },
  });

  let textScale = 108;
  const applyScale = () => {
    rendition.themes.fontSize(`${textScale}%`);
    setZoomControls({
      enabled: true,
      zoomOutDisabled: textScale <= MIN_TEXT_SCALE,
      zoomInDisabled: textScale >= MAX_TEXT_SCALE,
    });
  };

  await rendition.display();
  applyScale();

  rendition.on("relocated", (location) => {
    const start = location?.start?.displayed?.page || location?.start?.displayed?.location || 1;
    const total = location?.start?.displayed?.total || location?.end?.displayed?.total || 1;
    setControls({
      visible: true,
      prevDisabled: !location?.start?.cfi,
      nextDisabled: Boolean(location?.atEnd),
      progress: `Page ${start} of ${total}`,
    });
  });

  setNavigationHandlers({
    prev: () => rendition.prev().catch((error) => {
      console.error(error);
      setStatus("Unable to move to the previous page.");
    }),
    next: () => rendition.next().catch((error) => {
      console.error(error);
      setStatus("Unable to move to the next page.");
    }),
  });
  setZoomHandlers({
    zoomOut: () => {
      textScale = Math.max(MIN_TEXT_SCALE, textScale - 10);
      applyScale();
    },
    zoomIn: () => {
      textScale = Math.min(MAX_TEXT_SCALE, textScale + 10);
      applyScale();
    },
  });

  state.cleanup = () => {
    try {
      rendition.destroy();
    } catch (error) {
      console.warn("Unable to destroy EPUB rendition", error);
    }
    try {
      epubBook.destroy();
    } catch (error) {
      console.warn("Unable to destroy EPUB book", error);
    }
  };
  setStatus("EPUB edition loaded.");
}

async function renderBook(book) {
  const fallbackAction = (book?.actions || []).find((action) => action?.url);
  if (!book) {
    showEmpty("No book selected", "Pick a title from the library to open it here.");
    setStatus("No book selected.");
    return;
  }

  if (book.selectedFormat === "epub") {
    await renderEpubBook(book);
    return;
  }
  if (book.selectedFormat === "html") {
    await renderHtmlBook(book);
    return;
  }
  if (book.selectedFormat === "text") {
    await renderTextBook(book);
    return;
  }
  if (book.selectedFormat === "pdf") {
    await renderPdfBook(book);
    return;
  }

  showEmpty(
    book.availability === "borrow" ? "Borrow from source" : "No in-app edition yet",
    "This title does not expose a stable format we can render inside theblackbox right now. If you still want it, use the source link instead.",
    fallbackAction ? { href: fallbackAction.url, label: fallbackAction.label || "View source", external: true } : null,
  );
  setStatus("No in-app readable format is currently available.");
}

async function loadReader() {
  const url = new URL(window.location.href);
  const bookId = (url.searchParams.get("id") || "").trim();
  if (!bookId) {
    updateHeader(null);
    showEmpty("No book selected", "Pick a title from the library to open it here.");
    setStatus("Choose a book from the library to start reading.");
    return;
  }

  setStatus("Loading book...");
  try {
    const book = await requestBooks(`read/${encodeURIComponent(bookId)}`);
    updateHeader(book);
    await renderBook(book);
  } catch (error) {
    console.error(error);
    updateHeader({ title: "Reader unavailable", sourceLabel: "Books" });
    showEmpty(
      "Unable to open this book",
      "The source is unavailable right now. Please try another edition or come back in a moment.",
    );
    setStatus("We could not open this title right now.");
  }
}

readerBackButton?.addEventListener("click", () => {
  const referrer = document.referrer || "";
  if (referrer && referrer.startsWith(window.location.origin)) {
    history.back();
    return;
  }
  window.location.href = "books.html";
});

readerPrev?.addEventListener("click", () => state.prevAction?.());
readerNext?.addEventListener("click", () => state.nextAction?.());
readerZoomOut?.addEventListener("click", () => state.zoomOutAction?.());
readerZoomIn?.addEventListener("click", () => state.zoomInAction?.());

readerFullscreen?.addEventListener("click", async () => {
  if (!readerSurface) return;
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      setImmersiveFallback(false);
    } else if (document.fullscreenEnabled && typeof readerSurface.requestFullscreen === "function") {
      await readerSurface.requestFullscreen();
    } else {
      setImmersiveFallback(!state.immersiveFallback);
    }
  } catch (error) {
    console.warn("Fullscreen unavailable, using immersive fallback.", error);
    setImmersiveFallback(!state.immersiveFallback);
  }
});

document.addEventListener("fullscreenchange", () => {
  if (!document.fullscreenElement && state.immersiveFallback) {
    setImmersiveFallback(false);
    return;
  }
  syncFullscreenButton();
});
syncFullscreenButton();

window.addEventListener("keydown", (event) => {
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable) {
    return;
  }
  if (event.key === "ArrowLeft") {
    state.prevAction?.();
  } else if (event.key === "ArrowRight") {
    state.nextAction?.();
  } else if (event.key === "+" || event.key === "=") {
    state.zoomInAction?.();
  } else if (event.key === "-" || event.key === "_") {
    state.zoomOutAction?.();
  } else if (event.key.toLowerCase() === "f") {
    readerFullscreen?.click();
  } else if (event.key === "Escape" && state.immersiveFallback) {
    setImmersiveFallback(false);
  }
});

readerSurface?.addEventListener(
  "touchstart",
  (event) => {
    const touch = event.changedTouches[0];
    if (!touch) return;
    state.touchStartX = touch.clientX;
    state.touchStartY = touch.clientY;
    state.touchTracking = true;
    state.touchAxis = null;
  },
  { passive: true },
);

readerSurface?.addEventListener(
  "touchmove",
  (event) => {
    if (!state.touchTracking) return;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const deltaX = touch.clientX - state.touchStartX;
    const deltaY = touch.clientY - state.touchStartY;
    if (!state.touchAxis && (Math.abs(deltaX) > 10 || Math.abs(deltaY) > 10)) {
      state.touchAxis = Math.abs(deltaX) > Math.abs(deltaY) ? "x" : "y";
    }
    if (state.touchAxis === "x") {
      event.preventDefault();
    }
  },
  { passive: false },
);

readerSurface?.addEventListener(
  "touchend",
  (event) => {
    if (!state.touchTracking) return;
    state.touchTracking = false;
    const touch = event.changedTouches[0];
    if (!touch) return;
    const deltaX = touch.clientX - state.touchStartX;
    const deltaY = touch.clientY - state.touchStartY;
    state.touchAxis = null;
    if (Math.abs(deltaX) < SWIPE_THRESHOLD || Math.abs(deltaX) < Math.abs(deltaY)) return;
    if (deltaX < 0) {
      state.nextAction?.();
    } else {
      state.prevAction?.();
    }
  },
  { passive: true },
);

loadReader();
