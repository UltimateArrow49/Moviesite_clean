const userAgent = navigator.userAgent || navigator.vendor || window.opera || "";
const platform = navigator.platform || "";
const maxTouchPoints = navigator.maxTouchPoints || 0;

const coarsePointerQuery = window.matchMedia ? window.matchMedia("(pointer: coarse)") : null;
const finePointerQuery = window.matchMedia ? window.matchMedia("(pointer: fine)") : null;

const isIOS =
  /iPad|iPhone|iPod/.test(userAgent) ||
  (platform === "MacIntel" && maxTouchPoints > 1);
const isAndroid = /Android/i.test(userAgent);
const isWindows = /Windows NT/i.test(userAgent);
const isMac = /Macintosh/i.test(userAgent) && !isIOS;
const isChromeOS = /CrOS/.test(userAgent);
const isLinux = /Linux/i.test(userAgent) && !isAndroid && !isChromeOS;

const hasTouch =
  (coarsePointerQuery && coarsePointerQuery.matches) ||
  "ontouchstart" in window ||
  maxTouchPoints > 1;
const hasFinePointer = finePointerQuery ? finePointerQuery.matches : false;

const screenMin = Math.min(window.screen.width, window.screen.height);
const screenMax = Math.max(window.screen.width, window.screen.height);

const likelyTablet =
  (isIOS && !/iPhone/.test(userAgent)) ||
  (isAndroid && !/Mobile/.test(userAgent)) ||
  (hasTouch && screenMin >= 600 && screenMax <= 1400);

const isMobile =
  (isAndroid && /Mobile/.test(userAgent)) ||
  (/iPhone|iPod/.test(userAgent)) ||
  (!likelyTablet && hasTouch && screenMax <= 900);
const isTablet = !isMobile && likelyTablet;
const isDesktop = !isMobile && !isTablet;

const os = isIOS
  ? "ios"
  : isAndroid
  ? "android"
  : isMac
  ? "mac"
  : isWindows
  ? "windows"
  : isChromeOS
  ? "chromeos"
  : isLinux
  ? "linux"
  : "other";

const device = isMobile ? "mobile" : isTablet ? "tablet" : "desktop";

const detection = {
  userAgent,
  platform,
  os,
  device,
  isMobile,
  isTablet,
  isDesktop,
  isTouch: hasTouch,
  hasFinePointer,
  isIOS,
  isAndroid,
  isWindows,
  isMac,
  isLinux,
  isChromeOS,
};

function applyDetectionClasses(target) {
  if (!target) return;
  const { classList, dataset } = target;
  if (dataset) {
    dataset.device = device;
    dataset.os = os;
    dataset.pointer = hasTouch ? "coarse" : hasFinePointer ? "fine" : "unknown";
  }
  if (!classList) return;

  classList.add(`device-${device}`);
  classList.add(`os-${os}`);
  classList.add(hasTouch ? "has-touch" : "has-pointer");
  if (isMobile) classList.add("is-mobile");
  if (isTablet) classList.add("is-tablet");
  if (isDesktop) classList.add("is-desktop");
  if (isIOS) classList.add("is-ios");
  if (isAndroid) classList.add("is-android");
  if (isMac) classList.add("is-mac");
  if (isWindows) classList.add("is-windows");
  if (isLinux) classList.add("is-linux");
  if (isChromeOS) classList.add("is-chromeos");
}

applyDetectionClasses(document.documentElement);

const applyToBody = () => applyDetectionClasses(document.body);
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", applyToBody, { once: true });
} else {
  applyToBody();
}

window.__DEVICE__ = detection;

export default detection;
export { detection, applyDetectionClasses };
