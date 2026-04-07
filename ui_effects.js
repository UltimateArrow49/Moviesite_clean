const hasWindow = typeof window !== "undefined";
const reduceMotionQuery =
  hasWindow && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;
const coarsePointerQuery =
  hasWindow && typeof window.matchMedia === "function"
    ? window.matchMedia("(pointer: coarse)")
    : null;
const supportsPointerEvents = hasWindow && "PointerEvent" in window;

function prefersReducedMotion() {
  return reduceMotionQuery?.matches ?? false;
}

function hasCoarsePointer() {
  return coarsePointerQuery?.matches ?? false;
}

function createIntersectionObserver(callback, options) {
  if (typeof IntersectionObserver !== "function") return null;
  return new IntersectionObserver(callback, options);
}

function normalizeSelectorChildren(container, selector) {
  if (!container) return [];
  try {
    return Array.from(container.querySelectorAll(selector));
  } catch (error) {
    if (selector === ":scope > *") {
      return Array.from(container.children || []);
    }
    console.warn("Invalid selector provided to setupAnimatedList", selector, error);
    return [];
  }
}

export function setupAnimatedList(
  container,
  { childSelector = ":scope > *", axis = "y", once = true } = {},
) {
  if (!container) {
    return { refresh: () => {}, destroy: () => {} };
  }
  const isHorizontal = axis === "x";
  const observed = new Set();
  const state = {
    raf: null,
  };
  const observer = prefersReducedMotion()
    ? null
    : createIntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const target = entry.target;
            if (entry.isIntersecting) {
              target.classList.add("is-visible");
              if (once && observer) {
                observer.unobserve(target);
                observed.delete(target);
              }
            } else if (!once) {
              target.classList.remove("is-visible");
            }
          }
        },
        {
          root: isHorizontal ? container : null,
          threshold: isHorizontal ? 0.25 : 0.15,
          rootMargin: isHorizontal ? "0px 14%" : "12% 0px",
        },
      );

  container.classList.add("animated-list");
  container.classList.toggle("animated-list--horizontal", isHorizontal);

  const syncChildren = () => {
    state.raf = null;
    const children = normalizeSelectorChildren(container, childSelector);
    children.forEach((child, index) => {
      child.classList.add("animated-list__item");
      child.style.setProperty("--animate-index", index);
      if (observer && !observed.has(child)) {
        observer.observe(child);
        observed.add(child);
      } else if (!observer) {
        child.classList.add("is-visible");
      }
    });
    if (observer) {
      for (const item of [...observed]) {
        if (!item.isConnected || item.parentElement !== container) {
          observer.unobserve(item);
          observed.delete(item);
        }
      }
    }
  };

  const requestSync = () => {
    if (prefersReducedMotion() && observer) {
      observer.disconnect();
      observed.clear();
    }
    if (state.raf != null) return;
    state.raf = window.requestAnimationFrame(syncChildren);
  };

  const mutation = typeof MutationObserver === "function"
    ? new MutationObserver(() => requestSync())
    : null;

  if (mutation) {
    mutation.observe(container, { childList: true });
  }

  syncChildren();

  return {
    refresh: requestSync,
    destroy: () => {
      if (mutation) mutation.disconnect();
      if (observer) {
        for (const item of observed) {
          observer.unobserve(item);
        }
      }
      observed.clear();
    },
  };
}

function transitionInstantly(element) {
  if (!element) return;
  element.classList.add("is-instant");
  void element.offsetWidth;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      element.classList.remove("is-instant");
    });
  });
}

function resolveActiveItem(items) {
  if (!items.length) return null;
  const current = window.location.pathname.split("/").pop() || "index.html";
  const normalizedCurrent = current === "" ? "index.html" : current;
  for (const item of items) {
    const href = item.getAttribute("href");
    if (!href) continue;
    if (href === normalizedCurrent) return item;
    if (normalizedCurrent.endsWith(href)) return item;
  }
  return items[0];
}

export function initDockNavigation() {
  return;
}

export function initMagicBento() {
  const grids = document.querySelectorAll(".landing-grid");
  grids.forEach((grid) => {
    if (grid.dataset.magicReady === "true") return;
    grid.dataset.magicReady = "true";
    const items = Array.from(grid.querySelectorAll("a"));
    if (!items.length) return;

    grid.classList.add("magic-bento");
    if (prefersReducedMotion()) {
      grid.style.setProperty("--magic-transition", "0ms");
    }

    const indicator = document.createElement("span");
    indicator.className = "magic-bento__indicator";
    grid.appendChild(indicator);

    items.forEach((item) => item.classList.add("magic-bento__item"));

    let activeItem = null;
    const ensureActiveItem = (item) => {
      activeItem = item;
    };

    const syncIndicatorTransform = (item) => {
      if (!indicator) return;
      const styles = item ? window.getComputedStyle(item) : null;
      indicator.style.setProperty("--magic-tilt-x", "0deg");
      indicator.style.setProperty("--magic-tilt-y", "0deg");
      indicator.style.setProperty(
        "--magic-raise",
        styles?.getPropertyValue("--tile-raise") || "0px",
      );
      indicator.style.setProperty(
        "--magic-scale",
        styles?.getPropertyValue("--tile-scale") || "1",
      );
    };

    const moveIndicator = (item, immediate = false) => {
      if (!indicator) return;
      if (!item) {
        indicator.style.setProperty("--magic-opacity", "0");
        indicator.style.setProperty("--magic-x", "0px");
        indicator.style.setProperty("--magic-y", "0px");
        syncIndicatorTransform(null);
        return;
      }
      const x = item.offsetLeft - grid.scrollLeft;
      const y = item.offsetTop - grid.scrollTop;
      indicator.style.setProperty("--magic-width", `${item.offsetWidth}px`);
      indicator.style.setProperty("--magic-height", `${item.offsetHeight}px`);
      indicator.style.setProperty("--magic-x", `${x}px`);
      indicator.style.setProperty("--magic-y", `${y}px`);
      indicator.style.setProperty("--magic-opacity", "1");
      syncIndicatorTransform(item);
      if (immediate) {
        transitionInstantly(indicator);
      }
    };

    indicator.style.setProperty("--magic-opacity", "0");

    const resetTileTilt = (item) => {
      if (!item) return;
      item.style.setProperty("--tile-tilt-x", "0deg");
      item.style.setProperty("--tile-tilt-y", "0deg");
      syncIndicatorTransform(item);
    };

    items.forEach((item) => {
      const enter = (event) => {
        ensureActiveItem(item);
        moveIndicator(item, true);
        resetTileTilt(item);
      };
      const leave = () => {
        resetTileTilt(item);
      };
      if (supportsPointerEvents) {
        item.addEventListener("pointerenter", enter);
        item.addEventListener("pointerleave", leave);
      } else {
        item.addEventListener("mouseenter", enter);
        item.addEventListener("mouseleave", leave);
      }
      item.addEventListener("focus", (event) => {
        ensureActiveItem(item);
        moveIndicator(item, true);
        resetTileTilt(item);
      });
      item.addEventListener("blur", () => {
        requestAnimationFrame(() => {
          if (!grid.contains(document.activeElement)) {
            indicator.style.setProperty("--magic-opacity", "0");
          }
        });
      });
    });

    const handleGridReset = () => {
      if (activeItem) {
        moveIndicator(activeItem, true);
      } else {
        indicator.style.setProperty("--magic-opacity", "0");
      }
      syncIndicatorTransform(activeItem);
    };

    if (supportsPointerEvents) {
      grid.addEventListener("pointerleave", () => {
        handleGridReset();
        if (!grid.contains(document.activeElement)) {
          indicator.style.setProperty("--magic-opacity", "0");
        }
      });
      grid.addEventListener("pointerenter", () => {
        if (activeItem) {
          indicator.style.setProperty("--magic-opacity", "1");
        }
      });
    } else {
      grid.addEventListener("mouseleave", () => {
        handleGridReset();
        if (!grid.contains(document.activeElement)) {
          indicator.style.setProperty("--magic-opacity", "0");
        }
      });
      grid.addEventListener("mouseenter", () => {
        if (activeItem) {
          indicator.style.setProperty("--magic-opacity", "1");
        }
      });
    }
    window.addEventListener("resize", () => moveIndicator(activeItem, true), {
      passive: true,
    });
    window.addEventListener("orientationchange", () => moveIndicator(activeItem, true));
  });
}

export function initClickSpark() {
  if (!supportsPointerEvents || prefersReducedMotion()) return;
  const body = document.body;
  if (!body || body.dataset.sparkReady === "true") return;
  body.dataset.sparkReady = "true";

  const particleCount = 8;

  const spawnSpark = (event) => {
    if (prefersReducedMotion()) return;
    if (event.button != null && event.button !== 0) return;
    const spark = document.createElement("span");
    spark.className = "click-spark";
    spark.style.left = `${event.clientX}px`;
    spark.style.top = `${event.clientY}px`;

    const width = Math.max(window.innerWidth || 1, 1);
    const height = Math.max(window.innerHeight || 1, 1);
    const xRatio = Math.min(Math.max(event.clientX / width, 0), 1);
    const yRatio = Math.min(Math.max(event.clientY / height, 0), 1);
    const xNorm = Math.min(Math.max((xRatio - 0.5) * 2, -1), 1);
    const yNorm = Math.min(Math.max((yRatio - 0.5) * 2, -1), 1);

    window.dispatchEvent(
      new CustomEvent("blackbox:click-spark", {
        detail: {
          x: event.clientX,
          y: event.clientY,
          xRatio,
          yRatio,
          xNorm,
          yNorm,
          intensity: 0.9,
        },
      }),
    );

    for (let index = 0; index < particleCount; index += 1) {
      const particle = document.createElement("span");
      particle.className = "click-spark__particle";
      const angle = (360 / particleCount) * index;
      particle.style.setProperty("--spark-angle", `${angle}deg`);
      particle.style.setProperty(
        "--spark-travel",
        `${18 + Math.random() * 16}px`,
      );
      particle.style.setProperty(
        "--spark-scale",
        (0.65 + Math.random() * 0.35).toFixed(2),
      );
      spark.appendChild(particle);
    }

    const glow = document.createElement("span");
    glow.className = "click-spark__glow";
    spark.appendChild(glow);

    body.appendChild(spark);
    spark.addEventListener(
      "animationend",
      () => {
        spark.remove();
      },
      { once: true },
    );
  };

  body.addEventListener("pointerdown", spawnSpark);
}
