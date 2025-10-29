const hasWindow = typeof window !== "undefined";
const reduceMotionQuery =
  hasWindow && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;
const supportsPointerEvents = hasWindow && "PointerEvent" in window;

function prefersReducedMotion() {
  return reduceMotionQuery?.matches ?? false;
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
  requestAnimationFrame(() => {
    element.classList.remove("is-instant");
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
  const navs = document.querySelectorAll(".topbar nav");
  navs.forEach((nav) => {
    if (nav.dataset.dockReady === "true") return;
    nav.dataset.dockReady = "true";
    const items = Array.from(nav.querySelectorAll("a"));
    if (!items.length) return;
    nav.classList.add("dock-nav");
    if (prefersReducedMotion()) {
      nav.style.setProperty("--dock-transition", "0ms");
    }
    const indicator = document.createElement("span");
    indicator.className = "dock-nav__indicator";
    nav.appendChild(indicator);

    items.forEach((item) => {
      item.classList.add("dock-nav__item");
    });

    let activeItem = resolveActiveItem(items);

    const moveIndicator = (item, immediate = false) => {
      if (!indicator) return;
      if (!item) {
        indicator.style.setProperty("--dock-opacity", "0");
        return;
      }
      const navRect = nav.getBoundingClientRect();
      const itemRect = item.getBoundingClientRect();
      const x = itemRect.left - navRect.left + nav.scrollLeft;
      const y = itemRect.top - navRect.top + nav.scrollTop;
      indicator.style.setProperty("--dock-width", `${itemRect.width}px`);
      indicator.style.setProperty("--dock-height", `${itemRect.height}px`);
      indicator.style.setProperty("--dock-x", `${x}px`);
      indicator.style.setProperty("--dock-y", `${y}px`);
      indicator.style.setProperty("--dock-opacity", "1");
      if (immediate) {
        transitionInstantly(indicator);
      }
    };

    const applyActive = (item) => {
      activeItem = item;
      items.forEach((entry) => {
        if (entry === activeItem) {
          entry.setAttribute("aria-current", "page");
          entry.classList.add("is-active");
        } else {
          entry.removeAttribute("aria-current");
          entry.classList.remove("is-active");
        }
      });
      moveIndicator(activeItem);
    };

    applyActive(activeItem);
    moveIndicator(activeItem, true);

    const handleResize = () => {
      if (activeItem) {
        moveIndicator(activeItem, true);
      }
    };

    nav.addEventListener("scroll", handleResize);
    window.addEventListener("resize", handleResize, { passive: true });

    const handleNavLeave = () => moveIndicator(activeItem);

    if (supportsPointerEvents) {
      nav.addEventListener("pointerleave", handleNavLeave);
    } else {
      nav.addEventListener("mouseleave", handleNavLeave);
    }

    items.forEach((item) => {
      const hoverHandler = () => moveIndicator(item);
      const leaveHandler = () => moveIndicator(activeItem);
      if (supportsPointerEvents) {
        item.addEventListener("pointerenter", hoverHandler);
        item.addEventListener("pointerleave", leaveHandler);
      } else {
        item.addEventListener("mouseenter", hoverHandler);
        item.addEventListener("mouseleave", leaveHandler);
      }
      item.addEventListener("focus", () => moveIndicator(item));
      item.addEventListener("blur", () => {
        const nextFocus = document.activeElement;
        if (!nav.contains(nextFocus)) {
          moveIndicator(activeItem);
        }
      });
      item.addEventListener("click", () => {
        applyActive(item);
      });
    });
  });
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

    const moveIndicator = (item, immediate = false) => {
      if (!indicator) return;
      if (!item) {
        indicator.style.setProperty("--magic-opacity", "0");
        return;
      }
      const gridRect = grid.getBoundingClientRect();
      const itemRect = item.getBoundingClientRect();
      const x = itemRect.left - gridRect.left;
      const y = itemRect.top - gridRect.top;
      indicator.style.setProperty("--magic-width", `${itemRect.width}px`);
      indicator.style.setProperty("--magic-height", `${itemRect.height}px`);
      indicator.style.setProperty("--magic-x", `${x}px`);
      indicator.style.setProperty("--magic-y", `${y}px`);
      indicator.style.setProperty("--magic-opacity", "1");
      if (immediate) {
        transitionInstantly(indicator);
      }
    };

    indicator.style.setProperty("--magic-opacity", "0");

    const handlePointer = (event, item) => {
      const rect = item.getBoundingClientRect();
      const offsetX = ((event.clientX - rect.left) / rect.width - 0.5) * 12;
      const offsetY = ((event.clientY - rect.top) / rect.height - 0.5) * 12;
      grid.style.setProperty("--magic-tilt-x", `${offsetX}deg`);
      grid.style.setProperty("--magic-tilt-y", `${-offsetY}deg`);
    };

    items.forEach((item) => {
      const enter = (event) => {
        ensureActiveItem(item);
        moveIndicator(item);
        handlePointer(event, item);
      };
      const leave = () => {
        grid.style.setProperty("--magic-tilt-x", "0deg");
        grid.style.setProperty("--magic-tilt-y", "0deg");
      };
      if (supportsPointerEvents) {
        item.addEventListener("pointerenter", enter);
        item.addEventListener("pointermove", (event) => handlePointer(event, item));
        item.addEventListener("pointerleave", leave);
      } else {
        item.addEventListener("mouseenter", enter);
        item.addEventListener("mousemove", (event) => handlePointer(event, item));
        item.addEventListener("mouseleave", leave);
      }
      item.addEventListener("focus", (event) => {
        ensureActiveItem(item);
        moveIndicator(item);
        if (supportsPointerEvents && event instanceof PointerEvent) {
          handlePointer(event, item);
        } else {
          grid.style.setProperty("--magic-tilt-x", "0deg");
          grid.style.setProperty("--magic-tilt-y", "0deg");
        }
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
      grid.style.setProperty("--magic-tilt-x", "0deg");
      grid.style.setProperty("--magic-tilt-y", "0deg");
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
