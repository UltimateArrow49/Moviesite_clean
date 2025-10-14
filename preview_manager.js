import { movieEmbed, tvEmbed } from "./providers/vidking.js";
import { getEntryById, historyId } from "./continue_watching.js";

const HOVER_MEDIA_QUERY = window.matchMedia ? window.matchMedia("(hover: hover)") : null;
const SUPPORTS_HOVER = !!(HOVER_MEDIA_QUERY && HOVER_MEDIA_QUERY.matches);
const REDUCE_MOTION_QUERY = window.matchMedia
  ? window.matchMedia("(prefers-reduced-motion: reduce)")
  : null;
const ALT_EMBED_ORIGINS = ["https://vidking.pro", "https://vidking.cloud"];
const OFFSCREEN_TRANSFORM = "translate3d(-9999px, -9999px, 0)";
const DEFAULT_PROGRESS = {
  movie: 1800,
  tv: 600,
};

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
  const progress = entry?.progress;
  const fallbackProgress = DEFAULT_PROGRESS[mode] || 0;
  const resolvedProgress = progress && progress > 0 ? progress : fallbackProgress;

  if (mode === "tv") {
    return tvEmbed(tmdbId, season, episode, {
      autoplay: false,
      idleCheck: 0,
      progress: resolvedProgress,
    });
  }
  return movieEmbed(tmdbId, {
    autoplay: false,
    idleCheck: 0,
    progress: resolvedProgress,
  });
}

export function setupPreviewForGrid(container, { mode = "movie" } = {}) {
  if (!container) return;
  if (!SUPPORTS_HOVER) return;

  let activeCard = null;
  let previewTimer = null;
  const { wrapper, iframe } = createPreviewFrame();
  document.body.appendChild(wrapper);
  wrapper.style.transform = OFFSCREEN_TRANSFORM;
  let disablePreviews = !!(REDUCE_MOTION_QUERY && REDUCE_MOTION_QUERY.matches);
  let pointerPosition = { x: 0, y: 0 };
  let fallbackTimer = null;
  let embedAttempt = null;

  function clearFallbackTimer() {
    if (fallbackTimer) {
      window.clearTimeout(fallbackTimer);
      fallbackTimer = null;
    }
  }

  function resetEmbed() {
    clearFallbackTimer();
    embedAttempt = null;
    iframe.removeAttribute("src");
  }

  function buildEmbedAttempt(src) {
    try {
      const baseUrl = new URL(src);
      const primaryOrigin = baseUrl.origin;
      const hosts = [primaryOrigin, ...ALT_EMBED_ORIGINS.filter((origin) => origin !== primaryOrigin)];
      return { baseUrl, hosts, index: 0 };
    } catch (error) {
      console.warn("Unable to parse preview embed URL", error);
      return null;
    }
  }

  function applyEmbedHost() {
    if (!embedAttempt) return;
    const host = embedAttempt.hosts[embedAttempt.index];
    if (!host) return;
    try {
      const hostUrl = new URL(host);
      const next = new URL(embedAttempt.baseUrl.toString());
      next.protocol = hostUrl.protocol;
      next.host = hostUrl.host;
      iframe.src = next.toString();
      scheduleFallback();
    } catch (error) {
      console.warn("Failed to apply preview host", error);
    }
  }

  function scheduleFallback() {
    clearFallbackTimer();
    if (!embedAttempt) return;
    fallbackTimer = window.setTimeout(() => {
      if (!embedAttempt) return;
      if (embedAttempt.index + 1 >= embedAttempt.hosts.length) {
        clearFallbackTimer();
        return;
      }
      embedAttempt.index += 1;
      applyEmbedHost();
    }, 3000);
  }

  function clearTimer() {
    if (previewTimer) {
      window.clearTimeout(previewTimer);
      previewTimer = null;
    }
  }

  function teardownPreview() {
    clearTimer();
    clearFallbackTimer();
    if (activeCard) {
      activeCard.classList.remove("card--previewing");
    }
    activeCard = null;
    resetEmbed();
    wrapper.classList.remove("is-visible");
    wrapper.hidden = true;
    wrapper.style.transform = OFFSCREEN_TRANSFORM;
    pointerPosition = { x: 0, y: 0 };
  }

  function getPreviewDimensions() {
    const width = wrapper.offsetWidth || 320;
    const height = wrapper.offsetHeight || Math.round(width * (9 / 16));
    return { width, height };
  }

  function positionPreview(x, y) {
    const { width, height } = getPreviewDimensions();
    const gutter = 16;
    let left = x + 24;
    let top = y + 24;

    if (left + width + gutter > window.innerWidth) {
      left = x - width - 24;
    }
    if (left < gutter) left = gutter;

    if (top + height + gutter > window.innerHeight) {
      top = Math.max(gutter, window.innerHeight - height - gutter);
    }
    if (top < gutter) top = gutter;

    wrapper.style.transform = `translate3d(${Math.round(left)}px, ${Math.round(top)}px, 0)`;
  }

  function positionByCard(card) {
    const rect = card.getBoundingClientRect();
    const x = rect.left + rect.width;
    const y = rect.top + rect.height / 2;
    pointerPosition = { x, y };
    positionPreview(x, y);
  }

  function showPreview(card) {
    if (!card || disablePreviews) return;
    const src = computeEmbed(card, mode);
    if (!src) return;
    clearTimer();
    if (activeCard && activeCard !== card) {
      activeCard.classList.remove("card--previewing");
    }
    activeCard = card;
    activeCard.classList.add("card--previewing");
    embedAttempt = buildEmbedAttempt(src);
    if (embedAttempt) {
      applyEmbedHost();
    } else {
      iframe.src = src;
    }
    wrapper.hidden = false;
    wrapper.classList.add("is-visible");
    if (pointerPosition.x || pointerPosition.y) {
      positionPreview(pointerPosition.x, pointerPosition.y);
    } else {
      positionByCard(card);
    }
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
    if (event.clientX || event.clientY) {
      pointerPosition = { x: event.clientX, y: event.clientY };
    }
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
    positionByCard(card);
    schedulePreview(card);
  }

  function handleBlur(event) {
    const card = event.target.closest(".card");
    if (!card) return;
    if (card.contains(event.relatedTarget)) return;
    teardownPreview();
  }

  function handlePointerMove(event) {
    pointerPosition = { x: event.clientX, y: event.clientY };
    if (!wrapper.hidden) {
      positionPreview(pointerPosition.x, pointerPosition.y);
    }
  }

  iframe.addEventListener("load", () => {
    clearFallbackTimer();
  });

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
  container.addEventListener("mousemove", handlePointerMove, true);

  window.addEventListener("scroll", teardownPreview, true);
  window.addEventListener("blur", teardownPreview);

  return () => {
    teardownPreview();
    removeMotionListener();
    container.removeEventListener("mouseenter", handleEnter, true);
    container.removeEventListener("mouseleave", handleLeave, true);
    container.removeEventListener("focusin", handleFocus, true);
    container.removeEventListener("focusout", handleBlur, true);
    container.removeEventListener("mousemove", handlePointerMove, true);
    window.removeEventListener("scroll", teardownPreview, true);
    window.removeEventListener("blur", teardownPreview);
  };
}
