import { movieEmbed, tvEmbed } from "./providers/vidking.js";
import { getEntryById, historyId } from "./continue_watching.js";

const HOVER_MEDIA_QUERY = window.matchMedia ? window.matchMedia("(hover: hover)") : null;
const SUPPORTS_HOVER = !!(HOVER_MEDIA_QUERY && HOVER_MEDIA_QUERY.matches);
const REDUCE_MOTION_QUERY = window.matchMedia
  ? window.matchMedia("(prefers-reduced-motion: reduce)")
  : null;

function onReduceMotionChange(callback) {
  if (!REDUCE_MOTION_QUERY || typeof callback !== "function") {
    return () => {};
  }
  if (typeof REDUCE_MOTION_QUERY.addEventListener === "function") {
    REDUCE_MOTION_QUERY.addEventListener("change", callback);
    return () => REDUCE_MOTION_QUERY.removeEventListener("change", callback);
  }
  if (typeof REDUCE_MOTION_QUERY.addListener === "function") {
    REDUCE_MOTION_QUERY.addListener(callback);
    return () => REDUCE_MOTION_QUERY.removeListener(callback);
  }
  return () => {};
}

function createPreviewFrame() {
  const wrapper = document.createElement("div");
  wrapper.className = "mini-preview";
  wrapper.hidden = true;

  const iframe = document.createElement("iframe");
  iframe.className = "mini-preview__frame";
  iframe.title = "Preview stream";
  iframe.setAttribute("frameborder", "0");
  iframe.setAttribute("allow", "autoplay; fullscreen; encrypted-media");
  iframe.setAttribute("referrerpolicy", "no-referrer");
  iframe.setAttribute("loading", "lazy");
  wrapper.appendChild(iframe);

  return { wrapper, iframe };
}

function computeEmbed(card, fallbackMode) {
  if (!card) return null;
  const tmdbId = card.dataset.tmdbId;
  if (!tmdbId) return null;
  const mode = card.dataset.mode === "tv" ? "tv" : fallbackMode === "tv" ? "tv" : "movie";
  const season = Number(card.dataset.season || "1") || 1;
  const episode = Number(card.dataset.episode || "1") || 1;
  const entryId = historyId(mode, tmdbId, season, episode);
  const entry = getEntryById(entryId);
  const progress = entry?.progress || 0;

  if (mode === "tv") {
    return tvEmbed(tmdbId, season, episode, {
      autoplay: false,
      idleCheck: 0,
      progress,
    });
  }
  return movieEmbed(tmdbId, {
    autoplay: false,
    idleCheck: 0,
    progress,
  });
}

export function setupPreviewForGrid(container, { mode = "movie" } = {}) {
  if (!container) return;
  if (!SUPPORTS_HOVER) return;

  let activeCard = null;
  let previewTimer = null;
  const { wrapper, iframe } = createPreviewFrame();
  let thumbHost = null;
  let disablePreviews = !!(REDUCE_MOTION_QUERY && REDUCE_MOTION_QUERY.matches);

  function clearTimer() {
    if (previewTimer) {
      window.clearTimeout(previewTimer);
      previewTimer = null;
    }
  }

  function teardownPreview() {
    clearTimer();
    if (activeCard) {
      activeCard.classList.remove("card--previewing");
    }
    activeCard = null;
    if (thumbHost && wrapper.parentElement === thumbHost) {
      thumbHost.removeChild(wrapper);
    }
    thumbHost = null;
    iframe.removeAttribute("src");
    wrapper.hidden = true;
  }

  function showPreview(card) {
    if (!card || disablePreviews) return;
    const thumb = card.querySelector(".thumb");
    if (!thumb) return;
    const src = computeEmbed(card, mode);
    if (!src) return;
    clearTimer();
    if (thumbHost && wrapper.parentElement !== thumbHost) {
      thumbHost.removeChild(wrapper);
    }
    thumbHost = thumb;
    thumb.appendChild(wrapper);
    iframe.src = src;
    card.classList.add("card--previewing");
    wrapper.hidden = false;
    activeCard = card;
  }

  function schedulePreview(card) {
    if (!card || disablePreviews) return;
    if (activeCard === card && !wrapper.hidden) return;
    clearTimer();
    previewTimer = window.setTimeout(() => {
      previewTimer = null;
      if (disablePreviews) return;
      showPreview(card);
    }, 350);
  }

  function handleEnter(event) {
    const card = event.target.closest(".card");
    if (!card || !container.contains(card)) return;
    schedulePreview(card);
  }

  function handleLeave(event) {
    const related = event.relatedTarget;
    if (related && container.contains(related)) return;
    teardownPreview();
  }

  function handleFocus(event) {
    const card = event.target.closest(".card");
    if (!card || !container.contains(card)) return;
    schedulePreview(card);
  }

  function handleBlur(event) {
    const card = event.target.closest(".card");
    if (!card) return;
    if (card.contains(event.relatedTarget)) return;
    teardownPreview();
  }

  const removeMotionListener = onReduceMotionChange((event) => {
    disablePreviews = !!event.matches;
    if (disablePreviews) {
      teardownPreview();
    }
  });

  container.addEventListener("mouseenter", handleEnter, true);
  container.addEventListener("mouseleave", handleLeave, true);
  container.addEventListener("focusin", handleFocus, true);
  container.addEventListener("focusout", handleBlur, true);

  window.addEventListener("scroll", teardownPreview, true);
  window.addEventListener("blur", teardownPreview);

  return () => {
    teardownPreview();
    removeMotionListener();
    container.removeEventListener("mouseenter", handleEnter, true);
    container.removeEventListener("mouseleave", handleLeave, true);
    container.removeEventListener("focusin", handleFocus, true);
    container.removeEventListener("focusout", handleBlur, true);
    window.removeEventListener("scroll", teardownPreview, true);
    window.removeEventListener("blur", teardownPreview);
  };
}
