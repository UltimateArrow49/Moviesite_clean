const PLACEHOLDER_PALETTES = [
  {
    start: "#12ffb0",
    end: "#0b6751",
    accent: "#031b16",
    detail: "#5bffe0",
    text: "#f7fff9",
  },
  {
    start: "#7f5bff",
    end: "#140031",
    accent: "#100824",
    detail: "#c5a9ff",
    text: "#f4f0ff",
  },
  {
    start: "#ff5f6d",
    end: "#ffc371",
    accent: "#2c070b",
    detail: "#ffb7a5",
    text: "#fff7f4",
  },
  {
    start: "#56ccf2",
    end: "#2f80ed",
    accent: "#05172b",
    detail: "#9ed8ff",
    text: "#f5fbff",
  },
  {
    start: "#f857a6",
    end: "#ff5858",
    accent: "#300616",
    detail: "#ff9dd3",
    text: "#fff3fa",
  },
];

const PLACEHOLDER_CACHE = new Map();

function normalizeName(name) {
  if (typeof name !== "string") return "";
  return name.trim();
}

function computeInitials(name) {
  const normalized = normalizeName(name);
  if (!normalized) return "??";
  let cleaned = normalized.replace(/[_-]+/g, " ");
  try {
    cleaned = cleaned.replace(new RegExp("[^\\p{L}\\p{N}\\s]+", "gu"), " ");
  } catch (error) {
    cleaned = cleaned.replace(/[^A-Za-z0-9\s]+/g, " ");
  }
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  if (!cleaned) return "??";
  const parts = cleaned.split(" ").filter(Boolean);
  if (!parts.length) return "??";
  if (parts.length === 1) {
    const token = parts[0].slice(0, 2).toUpperCase();
    if (token.length === 1) return token;
    return token[0] + token[1];
  }
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function hashString(value) {
  const input = value || "";
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0; // Convert to 32bit integer
  }
  return Math.abs(hash);
}

function pickPalette(key) {
  const hash = hashString(key);
  const index = hash % PLACEHOLDER_PALETTES.length;
  return { palette: PLACEHOLDER_PALETTES[index], hash };
}

function encodeSvg(svg) {
  return `data:image/svg+xml,${encodeURIComponent(svg)
    .replace(/'/g, "%27")
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29")}`;
}

function buildPlaceholderSvg(initials, palette, aspect, hash) {
  const isSquare = aspect === "square";
  const width = isSquare ? 240 : 320;
  const height = isSquare ? 240 : 180;
  const radius = isSquare ? 56 : 36;
  const innerRadius = Math.max(radius - 8, 12);
  const gradientId = `grad${hash}`;
  const noiseId = `noise${hash}`;
  const glowId = `glow${hash}`;
  const fontSize = Math.round(height * 0.36);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-hidden="true">
    <defs>
      <linearGradient id="${gradientId}" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="${palette.start}" />
        <stop offset="100%" stop-color="${palette.end}" />
      </linearGradient>
      <radialGradient id="${glowId}" cx="50%" cy="50%" r="70%">
        <stop offset="0%" stop-color="${palette.detail}" stop-opacity="0.55" />
        <stop offset="100%" stop-color="${palette.detail}" stop-opacity="0" />
      </radialGradient>
      <pattern id="${noiseId}" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">
        <rect width="14" height="14" fill="transparent" />
        <path d="M0 14L14 0M-4 10L4 2M10 18L18 10" stroke="${palette.detail}" stroke-width="1" stroke-opacity="0.12" />
      </pattern>
    </defs>
    <rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" fill="${palette.accent}" />
    <rect x="8" y="8" width="${width - 16}" height="${height - 16}" rx="${innerRadius}" fill="url(#${gradientId})" />
    <rect x="8" y="8" width="${width - 16}" height="${height - 16}" rx="${innerRadius}" fill="url(#${noiseId})" opacity="0.18" />
    <circle cx="${width / 2}" cy="${height / 2}" r="${Math.min(width, height) * 0.42}" fill="url(#${glowId})" />
    <text x="50%" y="50%" fill="${palette.text}" font-family="'Inter','Segoe UI',sans-serif" font-size="${fontSize}" font-weight="700" text-anchor="middle" dominant-baseline="middle" letter-spacing="0.08em">${initials}</text>
  </svg>`;
  return svg;
}

function createPlaceholder(name, aspect = "landscape") {
  const normalized = normalizeName(name) || "channel";
  const cacheKey = `${aspect}:${normalized.toLowerCase()}`;
  if (PLACEHOLDER_CACHE.has(cacheKey)) {
    return PLACEHOLDER_CACHE.get(cacheKey);
  }
  const { palette, hash } = pickPalette(cacheKey);
  const initials = computeInitials(normalized);
  const svg = buildPlaceholderSvg(initials, palette, aspect, hash);
  const encoded = encodeSvg(svg);
  PLACEHOLDER_CACHE.set(cacheKey, encoded);
  return encoded;
}

export function resolveChannelLogo(name, logoUrl, options = {}) {
  const aspect = options.aspect || "landscape";
  const provided = typeof logoUrl === "string" ? logoUrl.trim() : "";
  if (provided) {
    return { url: provided, isPlaceholder: false };
  }
  return { url: createPlaceholder(name, aspect), isPlaceholder: true };
}

export function applyChannelLogo(img, name, logoUrl, options = {}) {
  if (!(img instanceof HTMLImageElement)) {
    return { isPlaceholder: false };
  }
  const { aspect = "landscape", lazy = true } = options;
  const title = normalizeName(name) || "Channel";
  const { url, isPlaceholder } = resolveChannelLogo(title, logoUrl, { aspect });
  if ("decoding" in img) {
    img.decoding = "async";
  }
  if ("loading" in img) {
    img.loading = lazy === false ? "eager" : "lazy";
  }
  img.src = url;
  img.alt = isPlaceholder ? `${title} placeholder logo` : `${title} logo`;
  if (isPlaceholder) {
    img.dataset.placeholder = "true";
  } else {
    img.removeAttribute("data-placeholder");
    img.addEventListener(
      "error",
      () => {
        const fallback = resolveChannelLogo(title, "", { aspect });
        img.src = fallback.url;
        img.alt = `${title} placeholder logo`;
        img.dataset.placeholder = "true";
      },
      { once: true }
    );
  }
  return { isPlaceholder };
}

export function createChannelLogoElement(name, logoUrl, options = {}) {
  const img = document.createElement("img");
  applyChannelLogo(img, name, logoUrl, options);
  return img;
}
