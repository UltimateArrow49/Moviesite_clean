const doc = document.documentElement;
if (doc) {
  const state = { raf: null };
  const config = {
    maxOffsetX: 6,
    maxOffsetY: 4,
    radiusShift: 6,
    hueRange: 28,
    tiltRange: 4,
    stopShiftRange: 6,
  };

  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  const applyMotion = () => {
    state.raf = null;

    const scrollY = window.scrollY || doc.scrollTop || 0;
    const maxScroll = Math.max(1, doc.scrollHeight - window.innerHeight);
    const progress = clamp(scrollY / maxScroll, 0, 1);
    const eased = Math.pow(progress, 0.65);
    const oscillation = Math.sin(progress * Math.PI * 2);
    const secondaryOscillation = Math.cos(progress * Math.PI * 1.5);

    const primaryOffsetX = oscillation * config.maxOffsetX;
    const secondaryOffsetX = -oscillation * (config.maxOffsetX * 0.8);
    const verticalOffset = secondaryOscillation * config.maxOffsetY;

    const radiusPulse = Math.sin(progress * Math.PI) * config.radiusShift;
    const hueDrift = (eased - 0.5) * config.hueRange;
    const gradientTilt = oscillation * config.tiltRange;
    const gradientStopShift = secondaryOscillation * config.stopShiftRange;

    doc.style.setProperty("--bg-radial-1-offset-x", `${primaryOffsetX.toFixed(2)}%`);
    doc.style.setProperty("--bg-radial-1-offset-y", `${verticalOffset.toFixed(2)}%`);
    doc.style.setProperty("--bg-radial-2-offset-x", `${secondaryOffsetX.toFixed(2)}%`);
    doc.style.setProperty("--bg-radial-2-offset-y", `${(-verticalOffset * 0.6).toFixed(2)}%`);

    doc.style.setProperty("--bg-radial-1-radius-shift", `${radiusPulse.toFixed(2)}%`);
    doc.style.setProperty("--bg-radial-2-radius-shift", `${(-radiusPulse * 0.6).toFixed(2)}%`);

    doc.style.setProperty("--bg-hue-drift", `${hueDrift.toFixed(2)}deg`);
    doc.style.setProperty("--bg-gradient-tilt", `${gradientTilt.toFixed(2)}deg`);
    doc.style.setProperty("--bg-gradient-stop-shift", `${gradientStopShift.toFixed(2)}%`);
  };

  const requestMotionFrame = () => {
    if (state.raf != null) return;
    state.raf = window.requestAnimationFrame(applyMotion);
  };

  window.addEventListener("scroll", requestMotionFrame, { passive: true });
  window.addEventListener("resize", requestMotionFrame);

  requestMotionFrame();
}
