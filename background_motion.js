import {
  initDockNavigation,
  initMagicBento,
  initClickSpark,
} from "./ui_effects.js?v=14";

initDockNavigation();
initMagicBento();
initClickSpark();

const hasWindow = typeof window !== "undefined";
const doc = hasWindow ? document.documentElement : null;
const body = hasWindow ? document.body : null;
const reduceMotionQuery =
  hasWindow && typeof window.matchMedia === "function"
    ? window.matchMedia("(prefers-reduced-motion: reduce)")
    : null;
const coarsePointerQuery =
  hasWindow && typeof window.matchMedia === "function"
    ? window.matchMedia("(pointer: coarse), (hover: none)")
    : null;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);
const lerp = (start, end, amount) => start + (end - start) * amount;
const TAU = Math.PI * 2;

function prefersReducedMotion() {
  return reduceMotionQuery?.matches ?? false;
}

function hasCoarsePointer() {
  return coarsePointerQuery?.matches ?? false;
}

if (doc && body) {
  const state = {
    raf: null,
    lastFrame: 0,
    pointerEnabled: false,
    current: {
      scrollProgress: 0,
      pointerX: 0,
      pointerY: 0,
      clickPulse: 0,
    },
    target: {
      scrollProgress: 0,
      pointerX: 0,
      pointerY: 0,
    },
    pointer: {
      ratioX: 0.5,
      ratioY: 0.35,
      active: false,
    },
    click: {
      impulse: 0,
      xNorm: 0,
      yNorm: 0,
      xPercent: 50,
      yPercent: 18,
    },
    bubbles: null,
  };

  const getPageConfig = () => {
    if (body.classList.contains("home-minimal")) {
      return {
        depth: 1,
        baseOffsetX: 2.8,
        baseOffsetY: 2.2,
        overlayShiftX: 18,
        overlayShiftY: 14,
        haloShiftX: 10,
        haloShiftY: 8,
      };
    }

    return {
      depth: 0.58,
      baseOffsetX: 1.45,
      baseOffsetY: 1.15,
      overlayShiftX: 9,
      overlayShiftY: 7,
      haloShiftX: 5,
      haloShiftY: 4,
    };
  };

  const setVar = (name, value) => {
    doc.style.setProperty(name, value);
  };

  const getBubbleConfig = () => {
    if (body.classList.contains("home-minimal")) {
      return {
        count: 22,
        minRadius: 16,
        maxRadius: 58,
        speedMin: 8,
        speedMax: 22,
        repelRadius: 190,
        repelForce: 0.16,
        clickBoost: 0.72,
      };
    }

    return {
      count: 12,
      minRadius: 14,
      maxRadius: 34,
      speedMin: 6,
      speedMax: 16,
      repelRadius: 130,
      repelForce: 0.11,
      clickBoost: 0.46,
    };
  };

  const createBubble = (width, height, config, spawnFromBottom = false) => {
    const radius = config.minRadius + Math.random() * (config.maxRadius - config.minRadius);
    return {
      x: Math.random() * width,
      y: spawnFromBottom ? height + radius + Math.random() * height * 0.35 : Math.random() * height,
      radius,
      drift: (Math.random() - 0.5) * 18,
      speed: config.speedMin + Math.random() * (config.speedMax - config.speedMin),
      phase: Math.random() * TAU,
      alpha: 0.08 + Math.random() * 0.12,
      glow: 0.16 + Math.random() * 0.2,
      hueShift: Math.random() * 0.22,
      parallax: 0.35 + Math.random() * 0.8,
      vx: 0,
      vy: 0,
    };
  };

  const resizeBubbleField = () => {
    if (!state.bubbles) return;
    const width = Math.max(window.innerWidth || 1, 1);
    const height = Math.max(window.innerHeight || 1, 1);
    const ratio = window.devicePixelRatio || 1;
    state.bubbles.width = width;
    state.bubbles.height = height;
    state.bubbles.canvas.width = Math.round(width * ratio);
    state.bubbles.canvas.height = Math.round(height * ratio);
    state.bubbles.canvas.style.width = `${width}px`;
    state.bubbles.canvas.style.height = `${height}px`;
    state.bubbles.ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  };

  const setupBubbleField = () => {
    const shouldDisable = prefersReducedMotion() || hasCoarsePointer();
    if (shouldDisable) {
      if (state.bubbles?.canvas?.isConnected) {
        state.bubbles.canvas.remove();
      }
      state.bubbles = null;
      return;
    }

    const existingCanvas = state.bubbles?.canvas;
    if (existingCanvas && existingCanvas.isConnected) {
      resizeBubbleField();
      return;
    }

    const canvas = document.createElement("canvas");
    canvas.className = "background-orbs";
    canvas.setAttribute("aria-hidden", "true");
    body.insertBefore(canvas, body.firstChild);

    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    const config = getBubbleConfig();
    const width = Math.max(window.innerWidth || 1, 1);
    const height = Math.max(window.innerHeight || 1, 1);

    state.bubbles = {
      canvas,
      ctx,
      width,
      height,
      ratio: window.devicePixelRatio || 1,
      items: Array.from({ length: config.count }, () => createBubble(width, height, config)),
    };
    resizeBubbleField();
  };

  const updateBubbles = (deltaSeconds) => {
    if (!state.bubbles) return;
    const { ctx, width, height, items } = state.bubbles;
    const config = getBubbleConfig();
    const pointerActive = state.pointerEnabled && state.pointer.active;
    const pointerX = state.pointer.ratioX * width;
    const pointerY = state.pointer.ratioY * height;
    const clickX = (state.click.xPercent / 100) * width;
    const clickY = (state.click.yPercent / 100) * height;
    const clickStrength = state.current.clickPulse;
    const parallaxX = state.current.pointerX * 18;
    const parallaxY = state.current.pointerY * 14;

    ctx.clearRect(0, 0, width, height);

    items.forEach((bubble) => {
      const driftWave = Math.sin((state.current.scrollProgress * 3 + bubble.phase) * TAU);
      bubble.vx += (bubble.drift * 0.012 + driftWave * 0.02 - bubble.vx) * 0.06;
      bubble.vy += (-bubble.speed * 0.06 - bubble.vy) * 0.08;

      if (pointerActive) {
        const dx = bubble.x - pointerX;
        const dy = bubble.y - pointerY;
        const distance = Math.hypot(dx, dy);
        if (distance < config.repelRadius) {
          const strength = (1 - distance / config.repelRadius) * config.repelForce;
          const angle = Math.atan2(dy || 0.001, dx || 0.001);
          bubble.vx += Math.cos(angle) * strength * 42 * deltaSeconds * 60;
          bubble.vy += Math.sin(angle) * strength * 42 * deltaSeconds * 60;
        }
      }

      if (clickStrength > 0.015) {
        const dx = bubble.x - clickX;
        const dy = bubble.y - clickY;
        const distance = Math.max(24, Math.hypot(dx, dy));
        const impulse = clickStrength * config.clickBoost * Math.max(0, 1 - distance / 260);
        if (impulse > 0) {
          const angle = Math.atan2(dy || 0.001, dx || 0.001);
          bubble.vx += Math.cos(angle) * impulse * 12;
          bubble.vy += Math.sin(angle) * impulse * 12;
        }
      }

      bubble.vx *= 0.975;
      bubble.vy *= 0.978;
      bubble.x += bubble.vx + driftWave * 0.14;
      bubble.y += bubble.vy;

      const padding = bubble.radius * 2.6;
      if (bubble.y < -padding) {
        Object.assign(bubble, createBubble(width, height, config, true));
      }
      if (bubble.x < -padding) bubble.x = width + padding * 0.5;
      if (bubble.x > width + padding) bubble.x = -padding * 0.5;

      const drawX = bubble.x + parallaxX * bubble.parallax;
      const drawY = bubble.y + parallaxY * bubble.parallax;
      const radius = bubble.radius + clickStrength * 8 * bubble.parallax;

      const gradient = ctx.createRadialGradient(
        drawX - radius * 0.28,
        drawY - radius * 0.28,
        radius * 0.14,
        drawX,
        drawY,
        radius,
      );
      gradient.addColorStop(0, `rgba(255, 255, 255, ${0.22 + bubble.alpha})`);
      gradient.addColorStop(0.34, `rgba(120, 255, 226, ${0.09 + bubble.glow + bubble.hueShift * 0.1})`);
      gradient.addColorStop(0.72, `rgba(64, 170, 255, ${0.06 + bubble.hueShift * 0.12})`);
      gradient.addColorStop(1, "rgba(10, 16, 30, 0)");

      ctx.beginPath();
      ctx.fillStyle = gradient;
      ctx.arc(drawX, drawY, radius, 0, TAU);
      ctx.fill();

      ctx.beginPath();
      ctx.strokeStyle = `rgba(188, 255, 241, ${0.08 + bubble.alpha * 0.75})`;
      ctx.lineWidth = Math.max(1, radius * 0.03);
      ctx.arc(drawX, drawY, radius * 0.82, 0, TAU);
      ctx.stroke();
    });
  };

  const syncInputMode = () => {
    state.pointerEnabled = !prefersReducedMotion() && !hasCoarsePointer();
    if (!state.pointerEnabled) {
      state.target.pointerX = 0;
      state.target.pointerY = 0;
      state.click.impulse = 0;
      state.pointer.active = false;
    }
    setupBubbleField();
    requestMotionFrame();
  };

  const updateScrollTarget = () => {
    const scrollY = window.scrollY || doc.scrollTop || 0;
    const maxScroll = Math.max(1, doc.scrollHeight - window.innerHeight);
    state.target.scrollProgress = clamp(scrollY / maxScroll, 0, 1);
    requestMotionFrame();
  };

  const updatePointerTarget = (event) => {
    if (!state.pointerEnabled) return;
    const width = Math.max(window.innerWidth || 1, 1);
    const height = Math.max(window.innerHeight || 1, 1);
    state.pointer.ratioX = clamp(event.clientX / width, 0, 1);
    state.pointer.ratioY = clamp(event.clientY / height, 0, 1);
    state.pointer.active = true;
    state.target.pointerX = clamp((event.clientX / width - 0.5) * 2, -1, 1);
    state.target.pointerY = clamp((event.clientY / height - 0.5) * 2, -1, 1);
    requestMotionFrame();
  };

  const resetPointerTarget = () => {
    state.pointer.active = false;
    state.target.pointerX = 0;
    state.target.pointerY = 0;
    requestMotionFrame();
  };

  const applyClickImpulse = (event) => {
    if (prefersReducedMotion()) return;
    const detail = event.detail || {};
    const xNorm = clamp(Number(detail.xNorm ?? 0), -1, 1);
    const yNorm = clamp(Number(detail.yNorm ?? 0), -1, 1);
    const xPercent = clamp(Number(detail.xRatio ?? 0.5), 0, 1) * 100;
    const yPercent = clamp(Number(detail.yRatio ?? 0.18), 0, 1) * 100;
    const intensity = clamp(Number(detail.intensity ?? 0.85), 0, 1.25);

    state.click.xNorm = xNorm;
    state.click.yNorm = yNorm;
    state.click.xPercent = xPercent;
    state.click.yPercent = yPercent;
    state.click.impulse = Math.max(state.click.impulse, intensity);
    requestMotionFrame();
  };

  const renderMotion = () => {
    const page = getPageConfig();
    const scrollLerp = prefersReducedMotion() ? 0.2 : 0.08;
    const pointerLerp = state.pointerEnabled ? 0.11 : 0.18;

    state.current.scrollProgress = lerp(
      state.current.scrollProgress,
      state.target.scrollProgress,
      scrollLerp,
    );
    state.current.pointerX = lerp(
      state.current.pointerX,
      state.target.pointerX,
      pointerLerp,
    );
    state.current.pointerY = lerp(
      state.current.pointerY,
      state.target.pointerY,
      pointerLerp,
    );
    state.current.clickPulse = lerp(
      state.current.clickPulse,
      state.click.impulse,
      prefersReducedMotion() ? 0.16 : 0.14,
    );
    state.click.impulse = lerp(
      state.click.impulse,
      0,
      prefersReducedMotion() ? 0.18 : 0.12,
    );

    const progress = clamp(state.current.scrollProgress, 0, 1);
    const eased = Math.pow(progress, 0.65);
    const oscillation = Math.sin(progress * Math.PI * 2);
    const secondaryOscillation = Math.cos(progress * Math.PI * 1.5);
    const depthX = state.current.pointerX * page.baseOffsetX;
    const depthY = state.current.pointerY * page.baseOffsetY;
    const clickDriftX = state.click.xNorm * state.current.clickPulse * page.baseOffsetX * 0.45;
    const clickDriftY = state.click.yNorm * state.current.clickPulse * page.baseOffsetY * 0.35;

    const radial1OffsetX = oscillation * 6 + depthX + clickDriftX;
    const radial2OffsetX = -oscillation * 4.8 - depthX * 0.85 - clickDriftX * 0.6;
    const radial1OffsetY = secondaryOscillation * 4 + depthY + clickDriftY;
    const radial2OffsetY = -secondaryOscillation * 2.4 - depthY * 0.7 - clickDriftY * 0.45;
    const radiusPulse = Math.sin(progress * Math.PI) * 6 + state.current.clickPulse * 1.4;
    const gradientTilt = oscillation * 4 + depthX * 0.4;
    const gradientStopShift = secondaryOscillation * 6 + depthY * 0.75;
    const hueDrift = (eased - 0.5) * 18 + depthX * 1.2;

    const layer1X = state.current.pointerX * page.overlayShiftX + state.click.xNorm * state.current.clickPulse * 8;
    const layer1Y = state.current.pointerY * page.overlayShiftY + state.click.yNorm * state.current.clickPulse * 5;
    const layer2X = -state.current.pointerX * page.haloShiftX - state.click.xNorm * state.current.clickPulse * 4;
    const layer2Y = -state.current.pointerY * page.haloShiftY - state.click.yNorm * state.current.clickPulse * 3;
    const depthScale = page.depth * 0.012 + state.current.clickPulse * 0.032;

    setVar("--bg-page-depth", page.depth.toFixed(2));
    setVar("--bg-radial-1-offset-x", `${radial1OffsetX.toFixed(2)}%`);
    setVar("--bg-radial-1-offset-y", `${radial1OffsetY.toFixed(2)}%`);
    setVar("--bg-radial-2-offset-x", `${radial2OffsetX.toFixed(2)}%`);
    setVar("--bg-radial-2-offset-y", `${radial2OffsetY.toFixed(2)}%`);
    setVar("--bg-radial-1-radius-shift", `${radiusPulse.toFixed(2)}%`);
    setVar("--bg-radial-2-radius-shift", `${(-radiusPulse * 0.6).toFixed(2)}%`);
    setVar("--bg-gradient-tilt", `${gradientTilt.toFixed(2)}deg`);
    setVar("--bg-gradient-stop-shift", `${gradientStopShift.toFixed(2)}%`);
    setVar("--bg-hue-drift", `${hueDrift.toFixed(2)}deg`);
    setVar("--bg-layer-1-x", `${layer1X.toFixed(2)}px`);
    setVar("--bg-layer-1-y", `${layer1Y.toFixed(2)}px`);
    setVar("--bg-layer-2-x", `${layer2X.toFixed(2)}px`);
    setVar("--bg-layer-2-y", `${layer2Y.toFixed(2)}px`);
    setVar("--bg-depth-scale", depthScale.toFixed(4));
    setVar("--bg-click-pulse", state.current.clickPulse.toFixed(4));
    setVar("--bg-click-x", `${state.click.xPercent.toFixed(2)}%`);
    setVar("--bg-click-y", `${state.click.yPercent.toFixed(2)}%`);
  };

  const shouldKeepAnimating = () => {
    if (state.bubbles) return true;
    return (
      Math.abs(state.current.scrollProgress - state.target.scrollProgress) > 0.001 ||
      Math.abs(state.current.pointerX - state.target.pointerX) > 0.0015 ||
      Math.abs(state.current.pointerY - state.target.pointerY) > 0.0015 ||
      state.current.clickPulse > 0.003 ||
      state.click.impulse > 0.003
    );
  };

  const stepMotion = () => {
    const now = window.performance.now();
    const deltaSeconds = state.lastFrame
      ? clamp((now - state.lastFrame) / 1000, 0.001, 0.04)
      : 1 / 60;
    state.lastFrame = now;
    renderMotion();
    updateBubbles(deltaSeconds);
    if (shouldKeepAnimating()) {
      state.raf = window.requestAnimationFrame(stepMotion);
      return;
    }
    state.lastFrame = 0;
    state.raf = null;
  };

  function requestMotionFrame() {
    if (state.raf != null) return;
    state.raf = window.requestAnimationFrame(stepMotion);
  }

  if (typeof reduceMotionQuery?.addEventListener === "function") {
    reduceMotionQuery.addEventListener("change", syncInputMode);
  }
  if (typeof coarsePointerQuery?.addEventListener === "function") {
    coarsePointerQuery.addEventListener("change", syncInputMode);
  }

  window.addEventListener("scroll", updateScrollTarget, { passive: true });
  window.addEventListener("resize", () => {
    resizeBubbleField();
    updateScrollTarget();
  }, { passive: true });
  window.addEventListener("pointermove", updatePointerTarget, { passive: true });
  document.addEventListener("mouseleave", resetPointerTarget);
  window.addEventListener("blur", resetPointerTarget);
  window.addEventListener("blackbox:click-spark", applyClickImpulse);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      resetPointerTarget();
    } else {
      updateScrollTarget();
    }
  });

  syncInputMode();
  setupBubbleField();
  updateScrollTarget();
  requestMotionFrame();
}
