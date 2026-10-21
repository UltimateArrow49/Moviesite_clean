const ICON_PATHS = {
  play: "m8 5.14 10 6-10 6V5.14Z",
  browse: "M4 4h16v2H4zm0 14h16v2H4zm0-7h16v2H4z",
  previous: "M15.41 7.41 14 6l-6 6 6 6 1.41-1.41L10.83 12z",
  next: "m8.59 16.59 1.41 1.41 6-6-6-6-1.41 1.41L12.17 12z",
};

export const ACTION_ICONS = {
  play: ICON_PATHS.play,
  browse: ICON_PATHS.browse,
};

function createIcon(pathData) {
  const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");

  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  path.setAttribute("fill", "currentColor");
  path.setAttribute("d", pathData);

  icon.appendChild(path);
  return icon;
}

function createThumb({
  imageSrc,
  imageAlt,
  badgeText = "",
  placeholderText = "No artwork",
  lazy = true,
  className = "thumb",
}) {
  const thumb = document.createElement("div");
  thumb.className = className;

  if (imageSrc) {
    const img = document.createElement("img");
    img.src = imageSrc;
    img.alt = imageAlt;
    img.decoding = "async";
    img.loading = lazy ? "lazy" : "eager";
    thumb.appendChild(img);
  } else {
    const fallback = document.createElement("div");
    fallback.className = "placeholder";
    fallback.textContent = placeholderText;
    thumb.appendChild(fallback);
  }

  if (badgeText) {
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = badgeText;
    thumb.appendChild(badge);
  }

  return thumb;
}

function applyDataset(element, dataset = {}) {
  Object.entries(dataset).forEach(([key, value]) => {
    if (value == null) return;
    element.dataset[key] = String(value);
  });
}

export function joinFacts(parts) {
  return parts.filter(Boolean).join(" \u2022 ");
}

export function createMediaCard({
  href,
  title,
  imageSrc,
  imageAlt,
  badgeText = "",
  factsText = "",
  ariaLabel,
  actionLabel,
  actionIconPath,
  dataset = {},
  lazyImage = true,
}) {
  const card = document.createElement("a");
  card.className = "card";
  card.href = href;
  if (ariaLabel) {
    card.setAttribute("aria-label", ariaLabel);
  }
  applyDataset(card, dataset);

  const thumb = createThumb({
    imageSrc,
    imageAlt,
    badgeText,
    lazy: lazyImage,
  });

  const meta = document.createElement("div");
  meta.className = "meta";

  const titleEl = document.createElement("p");
  titleEl.className = "title";
  titleEl.textContent = title || "Untitled";
  meta.appendChild(titleEl);

  if (factsText) {
    const sub = document.createElement("p");
    sub.className = "sub";
    sub.textContent = factsText;
    meta.appendChild(sub);
  }

  const actions = document.createElement("div");
  actions.className = "actions";
  actions.appendChild(createIcon(actionIconPath));

  const label = document.createElement("span");
  label.textContent = actionLabel;
  actions.appendChild(label);

  meta.appendChild(actions);
  card.appendChild(thumb);
  card.appendChild(meta);
  return card;
}

export function createContinueProgressCard({
  href,
  title,
  imageSrc,
  imageAlt,
  progressPercent = 0,
  resumeText,
  ariaLabel,
  dataset = {},
}) {
  const card = document.createElement("a");
  card.className = "card card--continue";
  card.href = href;
  if (ariaLabel) {
    card.setAttribute("aria-label", ariaLabel);
  }
  applyDataset(card, dataset);

  const thumb = createThumb({
    imageSrc,
    imageAlt,
    className: "thumb thumb--continue",
    lazy: true,
  });
  card.appendChild(thumb);

  const progressBar = document.createElement("div");
  progressBar.className = "card-progress";

  const fill = document.createElement("span");
  fill.style.width =
    progressPercent > 0 ? `${Math.max(5, Math.min(100, progressPercent))}%` : "0%";
  progressBar.appendChild(fill);
  card.appendChild(progressBar);

  const meta = document.createElement("div");
  meta.className = "meta meta--continue";

  const titleEl = document.createElement("p");
  titleEl.className = "title";
  titleEl.textContent = title || "Untitled";
  meta.appendChild(titleEl);

  const resume = document.createElement("p");
  resume.className = "resume";
  resume.textContent = resumeText;
  meta.appendChild(resume);

  card.appendChild(meta);
  return card;
}

function createSkeletonCard() {
  const card = document.createElement("div");
  card.className = "card card--skeleton";
  card.setAttribute("aria-hidden", "true");

  const thumb = document.createElement("div");
  thumb.className = "thumb";
  card.appendChild(thumb);

  const meta = document.createElement("div");
  meta.className = "meta";

  const title = document.createElement("span");
  title.className = "skeleton-line skeleton-line--title";
  meta.appendChild(title);

  const sub = document.createElement("span");
  sub.className = "skeleton-line skeleton-line--sub";
  meta.appendChild(sub);

  const action = document.createElement("span");
  action.className = "skeleton-line skeleton-line--action";
  meta.appendChild(action);

  card.appendChild(meta);
  return card;
}

function renderCarouselSkeletons(state, count = 6) {
  if (!state?.scroller) return;
  state.scroller.innerHTML = "";
  state.scroller.dataset.placeholder = "true";
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < count; index += 1) {
    fragment.appendChild(createSkeletonCard());
  }
  state.scroller.appendChild(fragment);
}

export function enableScrollerGestureGuard(scroller, { axis = "x", threshold = 8 } = {}) {
  if (!scroller || scroller.dataset.swipeGuard === "true") return;
  scroller.dataset.swipeGuard = "true";

  let activePointerId = null;
  let startX = 0;
  let startY = 0;
  let activeThreshold = threshold;
  let suppressClicksUntil = 0;
  let isDragging = false;

  const startGesture = (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    activePointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    activeThreshold = event.pointerType === "touch" ? Math.min(threshold, 4) : threshold;
    isDragging = false;
  };

  const moveGesture = (event) => {
    if (activePointerId !== event.pointerId) return;

    const dx = event.clientX - startX;
    const dy = event.clientY - startY;
    const primaryDelta = axis === "y" ? Math.abs(dy) : Math.abs(dx);
    const secondaryDelta = axis === "y" ? Math.abs(dx) : Math.abs(dy);

    if (!isDragging && primaryDelta > activeThreshold && primaryDelta > secondaryDelta) {
      isDragging = true;
      scroller.classList.add("is-dragging");
    }
  };

  const endGesture = () => {
    if (isDragging) {
      suppressClicksUntil = Date.now() + 360;
      scroller.classList.remove("is-dragging");
    }
    activePointerId = null;
    isDragging = false;
  };

  scroller.addEventListener("pointerdown", startGesture, { passive: true });
  scroller.addEventListener("pointermove", moveGesture, { passive: true });
  scroller.addEventListener("pointerup", endGesture, { passive: true });
  scroller.addEventListener("pointercancel", endGesture, { passive: true });
  scroller.addEventListener("pointerleave", endGesture, { passive: true });
  scroller.addEventListener("dragstart", (event) => {
    event.preventDefault();
  });

  scroller.addEventListener(
    "click",
    (event) => {
      if (Date.now() >= suppressClicksUntil) return;
      const interactive = event.target.closest("a, button");
      if (!interactive || !scroller.contains(interactive)) return;
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );
}

function createArrowButton(pathData) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "carousel__arrow";
  button.appendChild(createIcon(pathData));
  return button;
}

export function createCarouselSection({
  definition,
  container,
  previewMode,
  setupPreviewForGrid,
  setupAnimatedList,
  axis = "x",
  initialLoadingLabel = `Loading titles\u2026`,
}) {
  if (!container) return null;

  const section = document.createElement("section");
  section.className = "carousel";
  section.dataset.carousel = definition.id;

  const header = document.createElement("div");
  header.className = "carousel__header";

  const title = document.createElement("h2");
  title.className = "carousel__title";
  title.textContent = definition.label;
  header.appendChild(title);

  const controls = document.createElement("div");
  controls.className = "carousel__controls";

  const prev = createArrowButton(ICON_PATHS.previous);
  prev.disabled = true;
  controls.appendChild(prev);

  const next = createArrowButton(ICON_PATHS.next);
  controls.appendChild(next);

  header.appendChild(controls);
  section.appendChild(header);

  const scroller = document.createElement("div");
  scroller.className = "carousel__scroller";
  scroller.setAttribute("role", "list");
  enableScrollerGestureGuard(scroller, { axis });
  section.appendChild(scroller);

  const loader = document.createElement("div");
  loader.className = "carousel__loader";
  loader.hidden = true;

  const spinner = document.createElement("span");
  spinner.className = "spinner";
  spinner.setAttribute("aria-hidden", "true");
  loader.appendChild(spinner);

  const loaderText = document.createElement("span");
  loaderText.className = "carousel__loader-text";
  loaderText.textContent = initialLoadingLabel;
  loader.appendChild(loaderText);
  section.appendChild(loader);

  const message = document.createElement("p");
  message.className = "carousel__message";
  message.hidden = true;
  section.appendChild(message);

  container.appendChild(section);

  const updateArrows = () => {
    const maxScroll = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
    prev.disabled = scroller.scrollLeft <= 8;
    next.disabled = scroller.scrollLeft >= maxScroll - 8;
  };

  const scrollByDirection = (direction) => {
    const amount = scroller.clientWidth * 0.9 * direction;
    scroller.scrollBy({ left: amount, behavior: "smooth" });
  };

  prev.addEventListener("click", () => {
    scrollByDirection(-1);
    window.setTimeout(updateArrows, 320);
  });

  next.addEventListener("click", () => {
    scrollByDirection(1);
    window.setTimeout(updateArrows, 320);
  });

  scroller.addEventListener("scroll", updateArrows);
  window.addEventListener("resize", updateArrows, { passive: true });

  if (typeof setupPreviewForGrid === "function" && previewMode) {
    setupPreviewForGrid(scroller, { mode: previewMode });
  }
  if (typeof setupAnimatedList === "function") {
    setupAnimatedList(scroller, { axis });
  }

  updateArrows();

  return {
    def: definition,
    section,
    scroller,
    prev,
    next,
    message,
    loader,
    loaderText,
    updateArrows,
  };
}

export function setCarouselLoading(state, isLoading, label = `Loading titles\u2026`) {
  if (!state?.loader) return;
  state.loaderText.textContent = label;
  state.loader.hidden = true;
  state.section.classList.toggle("carousel--loading", Boolean(isLoading));
  if (isLoading) {
    if (!state.scroller.children.length || state.scroller.dataset.placeholder === "true") {
      renderCarouselSkeletons(state);
    }
    state.scroller.setAttribute("aria-busy", "true");
    state.prev.disabled = true;
    state.next.disabled = true;
  } else {
    delete state.scroller.dataset.placeholder;
    state.scroller.removeAttribute("aria-busy");
  }
}

export function setCarouselMessage(state, message) {
  if (!state?.message) return;
  state.message.textContent = message || "";
  state.message.hidden = !message;
}

export function renderCarouselItems(state, items, createCard) {
  if (!state?.scroller) return;
  state.scroller.innerHTML = "";
  delete state.scroller.dataset.placeholder;
  const fragment = document.createDocumentFragment();
  items.forEach((item) => {
    const card = createCard(item);
    if (card) {
      fragment.appendChild(card);
    }
  });
  state.scroller.appendChild(fragment);
  state.updateArrows();
}

export function updateResultGroup(listEl, emptyEl, countEl, items, createCard) {
  if (!listEl || !emptyEl || !countEl) return;
  listEl.innerHTML = "";
  if (!items.length) {
    emptyEl.hidden = false;
    countEl.textContent = "";
    return;
  }

  emptyEl.hidden = true;
  const fragment = document.createDocumentFragment();
  items.forEach((item) => {
    const card = createCard(item);
    if (card) {
      fragment.appendChild(card);
    }
  });
  listEl.appendChild(fragment);
  countEl.textContent = `${items.length} match${items.length === 1 ? "" : "es"}`;
}
