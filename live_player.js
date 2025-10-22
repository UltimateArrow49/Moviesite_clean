import { applyChannelLogo } from "./logo-placeholder.js";

const STORAGE_PREFIX = "live:channel:";

const HLS_PATTERN = /\.m3u8(\?|$)/i;
const DIRECT_VIDEO_PATTERN = /\.(mp4|m4v|mov|webm|ogg)(\?|$)/i;
const HTTPS_PATTERN = /^https:/i;

const url = new URL(window.location.href);
const params = url.searchParams;
const channelId = params.get("channel") || "";
const streamUrl = params.get("stream") || "";
const channelName = params.get("name") || "Live channel";
const categoryParam = params.get("category") || "";
const qualityParam = params.get("quality") || "";
const logoParam = params.get("logo") || "";
const countryCodeParam = params.get("country") || "";
const countryNameParam = params.get("countryName") || "";
const countryFlagParam = params.get("countryFlag") || "";
const referrerParam = params.get("ref") || "";
const userAgentParam = params.get("ua") || "";
const feedParam = params.get("feed") || "";
const titleParam = params.get("title") || "";

const channelTitleEl = document.getElementById("channelTitle");
const channelSubtitleEl = document.getElementById("channelSubtitle");
const channelDescriptionEl = document.getElementById("channelDescription");
const channelTagsEl = document.getElementById("channelTags");
const channelWebsiteEl = document.getElementById("channelWebsite");
const channelLogoEl = document.getElementById("channelLogo");
const streamDetailsEl = document.getElementById("streamDetails");
const statusWrap = document.getElementById("statusWrap");
const loadingIndicator = document.getElementById("loadingIndicator");
const loadingText = document.getElementById("loadingText");
const statusEl = document.getElementById("playerStatus");
const videoEl = document.getElementById("liveVideo");
const backButton = document.getElementById("backButton");
const playerStageEl = document.getElementById("playerStage");
const playerOverlayEl = document.getElementById("playerOverlay");
let overlayHideTimer = null;

function getStoredChannel(id) {
  if (!id) return null;
  try {
    const raw = sessionStorage.getItem(`${STORAGE_PREFIX}${id}`);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (error) {
    console.warn("Unable to read cached channel info", error);
    return null;
  }
}

const storedChannel = getStoredChannel(channelId);
const fallbackKind = (function () {
  if (HLS_PATTERN.test(streamUrl)) return "hls";
  if (DIRECT_VIDEO_PATTERN.test(streamUrl)) return "file";
  if (HTTPS_PATTERN.test(streamUrl)) return "https";
  return "external";
})();

const channelData = {
  id: channelId,
  name: storedChannel?.name || channelName,
  countryCode: storedChannel?.countryCode || countryCodeParam,
  countryName: storedChannel?.countryName || countryNameParam,
  countryFlag: storedChannel?.countryFlag || countryFlagParam,
  categoryLabel: storedChannel?.categoryLabel || categoryParam,
  categoryNames: storedChannel?.categoryNames || (categoryParam ? [categoryParam] : []),
  network: storedChannel?.network || "",
  website: storedChannel?.website || "",
  logo: storedChannel?.logo || logoParam,
  qualityLabel: storedChannel?.qualityLabel || qualityParam,
  playbackKind: storedChannel?.playbackKind || storedChannel?.stream?.kind || fallbackKind,
  stream: {
    url: storedChannel?.stream?.url || streamUrl,
    title: storedChannel?.stream?.title || titleParam,
    feed: storedChannel?.stream?.feed || feedParam,
    quality: storedChannel?.stream?.quality || qualityParam,
    referrer: storedChannel?.stream?.referrer || referrerParam,
    userAgent: storedChannel?.stream?.userAgent || userAgentParam,
    inlinePlayable: storedChannel?.stream?.inlinePlayable ?? true,
    kind: storedChannel?.stream?.kind || storedChannel?.playbackKind || fallbackKind,
  },
};

function setLoading(isLoading, label = "Preparing live stream…") {
  if (!loadingIndicator) return;
  if (label && loadingText) {
    loadingText.textContent = label;
  }
  if (isLoading) {
    loadingIndicator.hidden = false;
    loadingIndicator.removeAttribute("aria-hidden");
    statusWrap?.classList.add("is-loading");
  } else {
    loadingIndicator.hidden = true;
    loadingIndicator.setAttribute("aria-hidden", "true");
    statusWrap?.classList.remove("is-loading");
  }
}

function setStatus(message) {
  if (statusEl) {
    statusEl.textContent = message;
  }
}

function recordChannelStatus(status) {
  if (!channelId) return;
  try {
    sessionStorage.setItem(`${STORAGE_PREFIX}${channelId}:status`, status);
  } catch (error) {
    console.warn("Unable to persist stream status", error);
  }
}

function showStreamOverlay(message, tone = "down") {
  if (!playerOverlayEl) return;
  if (overlayHideTimer) {
    window.clearTimeout(overlayHideTimer);
    overlayHideTimer = null;
  }
  playerOverlayEl.textContent = message;
  if (tone) {
    playerOverlayEl.dataset.tone = tone;
  } else {
    delete playerOverlayEl.dataset.tone;
  }
  playerOverlayEl.hidden = false;
  playerOverlayEl.setAttribute("aria-hidden", "false");
  void playerOverlayEl.offsetWidth;
  playerOverlayEl.classList.add("player-overlay--visible");
  playerStageEl?.classList.add("has-overlay");
}

function hideStreamOverlay() {
  if (!playerOverlayEl) return;
  playerOverlayEl.classList.remove("player-overlay--visible");
  playerOverlayEl.setAttribute("aria-hidden", "true");
  playerOverlayEl.removeAttribute("data-tone");
  playerStageEl?.classList.remove("has-overlay");

  const finalize = () => {
    playerOverlayEl.hidden = true;
    playerOverlayEl.removeAttribute("aria-hidden");
  };

  playerOverlayEl.addEventListener(
    "transitionend",
    () => {
      finalize();
      if (overlayHideTimer) {
        window.clearTimeout(overlayHideTimer);
        overlayHideTimer = null;
      }
    },
    { once: true },
  );

  overlayHideTimer = window.setTimeout(() => {
    overlayHideTimer = null;
    finalize();
  }, 360);
}

function addTag(label) {
  if (!channelTagsEl || !label) return;
  const tag = document.createElement("span");
  tag.className = "meta-tag";
  tag.textContent = label;
  channelTagsEl.appendChild(tag);
}

function formatRequirements(data) {
  const hints = [];
  if (data.referrer) {
    hints.push(`Referer header: ${data.referrer}`);
  }
  if (data.userAgent) {
    hints.push("Custom User-Agent required");
  }
  if (!HTTPS_PATTERN.test(data.url || "")) {
    hints.push("Stream served over HTTP (may be blocked by browsers)");
  }
  if (!HLS_PATTERN.test(data.url || "") && !DIRECT_VIDEO_PATTERN.test(data.url || "")) {
    hints.push("Non-HLS stream – compatibility depends on your browser");
  }
  return hints;
}

function populateDetails() {
  document.title = `${channelData.name} · Live · theblackbox`;
  if (channelTitleEl) channelTitleEl.textContent = channelData.name;

  const subtitleParts = [];
  if (channelData.countryName) {
    const location = channelData.countryFlag
      ? `${channelData.countryFlag} ${channelData.countryName}`
      : channelData.countryName;
    subtitleParts.push(`Live from ${location}`);
  } else {
    subtitleParts.push("Live stream");
  }
  if (channelData.categoryLabel) subtitleParts.push(channelData.categoryLabel);
  if (channelData.qualityLabel) subtitleParts.push(channelData.qualityLabel);
  channelSubtitleEl.textContent = subtitleParts.join(" • ");

  if (channelLogoEl) {
    applyChannelLogo(channelLogoEl, channelData.name, channelData.logo, {
      aspect: "square",
      lazy: false,
    });
    channelLogoEl.hidden = false;
  }

  if (channelDescriptionEl) {
    if (channelData.network) {
      const origin = channelData.countryName ? ` from ${channelData.countryName}` : "";
      channelDescriptionEl.textContent = `${channelData.network} delivers ${channelData.name}${origin} live.`;
    } else {
      const origin = channelData.countryName ? ` from ${channelData.countryName}` : "";
      channelDescriptionEl.textContent = `${channelData.name}${origin} is streaming live via the IPTV-Org catalog.`;
    }
  }

  if (channelTagsEl) {
    channelTagsEl.innerHTML = "";
    if (channelData.countryName) {
      const locationTag = channelData.countryFlag
        ? `${channelData.countryFlag} ${channelData.countryName}`
        : channelData.countryName;
      addTag(locationTag);
    }
    if (channelData.categoryNames?.length) {
      channelData.categoryNames.slice(0, 3).forEach((name) => addTag(name));
    }
    const playbackTag =
      channelData.playbackKind === "file"
        ? "Direct stream"
        : channelData.playbackKind === "hls"
        ? "HLS stream"
        : null;
    if (playbackTag) {
      addTag(playbackTag);
    }
    if (channelData.stream?.feed) {
      addTag(`Feed ${channelData.stream.feed}`);
    }
  }

  if (channelWebsiteEl) {
    channelWebsiteEl.innerHTML = "";
    if (channelData.website) {
      const link = document.createElement("a");
      link.href = channelData.website;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = "Visit official site";
      channelWebsiteEl.appendChild(link);
    }
  }

  if (streamDetailsEl) {
    const requirements = formatRequirements(channelData.stream);
    const parts = [];
    if (channelData.stream.title) parts.push(channelData.stream.title);
    if (channelData.qualityLabel) parts.push(`Reported quality: ${channelData.qualityLabel}`);
    if (channelData.stream.kind === "file") {
      parts.push("Direct stream playback");
    } else if (channelData.stream.kind === "hls") {
      parts.push("HLS stream playback");
    }
    if (requirements.length) {
      parts.push(requirements.join(" • "));
    } else {
      parts.push("Ready for in-browser playback.");
    }
    streamDetailsEl.textContent = parts.join(" • ");
  }
}

function setupBackButton() {
  if (!backButton) return;
  backButton.addEventListener("click", () => {
    if (window.history.length > 1) {
      window.history.back();
    } else {
      window.location.href = "live.html";
    }
  });
}

function attachVideoListeners() {
  if (!videoEl) return;
  videoEl.addEventListener("playing", () => {
    setLoading(false);
    setStatus("Live stream playing.");
    hideStreamOverlay();
    recordChannelStatus("up");
  });
  videoEl.addEventListener("waiting", () => {
    setLoading(true, "Buffering live signal…");
    setStatus("Buffering live signal…");
  });
  videoEl.addEventListener("pause", () => {
    setLoading(false);
    setStatus("Live stream paused.");
  });
  videoEl.addEventListener("ended", () => {
    setLoading(false);
    setStatus("Live stream ended.");
  });
  videoEl.addEventListener("error", () => {
    setLoading(false);
    const error = videoEl.error;
    if (!error) {
      setStatus("Unexpected playback error.");
      return;
    }
    let message = "Playback failed.";
    switch (error.code) {
      case error.MEDIA_ERR_ABORTED:
        message = "Stream aborted by the user.";
        break;
      case error.MEDIA_ERR_NETWORK:
        message = "Network error while fetching the stream.";
        break;
      case error.MEDIA_ERR_DECODE:
        message = "Unable to decode the live stream.";
        break;
      case error.MEDIA_ERR_SRC_NOT_SUPPORTED:
        message = "Stream format not supported by this browser.";
        break;
      default:
        message = "Unknown error during playback.";
    }
    setStatus(message);
    if (error.code === error.MEDIA_ERR_NETWORK) {
      showStreamOverlay("Server down", "down");
      recordChannelStatus("down");
    }
  });
}

function playWithNativeHls(url) {
  hideStreamOverlay();
  videoEl.src = url;
  const promise = videoEl.play();
  if (promise && typeof promise.catch === "function") {
    promise.catch(() => {
      setStatus("Press play to start the live stream.");
    });
  }
}

function startPlayback() {
  if (!videoEl) return;
  if (!channelData.stream.url) {
    setLoading(false);
    setStatus("No stream URL provided.");
    return;
  }

  hideStreamOverlay();
  setLoading(true);
  setStatus("Preparing live stream…");

  if (channelData.stream.inlinePlayable === false) {
    setLoading(false);
    setStatus("This stream requires an external player. Launch it directly from the live guide.");
    return;
  }

  const stream = channelData.stream.url;
  const isHttps = HTTPS_PATTERN.test(stream);
  const isHls = HLS_PATTERN.test(stream);
  const isDirect = DIRECT_VIDEO_PATTERN.test(stream);

  if (!isHttps) {
    setStatus("Stream requires HTTP access; open the link in an external player.");
    setLoading(false);
    return;
  }

  if (isHls && window.Hls && window.Hls.isSupported()) {
    const hls = new window.Hls({ enableWorker: true });
    hls.attachMedia(videoEl);
    hls.on(window.Hls.Events.MEDIA_ATTACHED, () => {
      hls.loadSource(stream);
    });
    hls.on(window.Hls.Events.MANIFEST_PARSED, () => {
      setLoading(false);
      setStatus("Live stream ready.");
      hideStreamOverlay();
      recordChannelStatus("up");
      const promise = videoEl.play();
      if (promise && typeof promise.catch === "function") {
        promise.catch(() => setStatus("Press play to start the live stream."));
      }
    });
    hls.on(window.Hls.Events.ERROR, (event, data) => {
      if (data?.fatal) {
        setLoading(false);
        setStatus("Server down. Please try again later.");
        showStreamOverlay("Server down", "down");
        recordChannelStatus("down");
        hls.destroy();
      }
    });
    return;
  }

  if (isHls && videoEl.canPlayType("application/vnd.apple.mpegurl")) {
    playWithNativeHls(stream);
    return;
  }

  if (!isHls && !isDirect) {
    setStatus("Attempting direct playback. Compatibility may vary.");
  }

  hideStreamOverlay();
  videoEl.src = stream;
  const playPromise = videoEl.play();
  if (playPromise && typeof playPromise.catch === "function") {
    playPromise.catch(() => {
      setStatus("Press play to start the live stream.");
    });
  }
  setLoading(false);
}

populateDetails();
setupBackButton();
attachVideoListeners();
startPlayback();
