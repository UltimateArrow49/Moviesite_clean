async function requestBooks(path, params = {}, options = {}) {
  const query = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value == null || value === "") return;
    query.set(key, String(value));
  });

  const cleanPath = String(path || "").replace(/^\/+/, "");
  const target = `/api/books/${cleanPath}${query.toString() ? `?${query.toString()}` : ""}`;
  const response = await fetch(target, {
    cache: options.cache || "no-store",
    signal: options.signal,
    headers: {
      Accept: "application/json",
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(text || `Books request failed (${response.status})`);
  }
  return text ? JSON.parse(text) : {};
}

function coverSources(book) {
  const sources = [];
  if (book?.coverUrl) sources.push(book.coverUrl);
  for (const fallback of book?.coverFallbacks || []) {
    if (fallback && !sources.includes(fallback)) {
      sources.push(fallback);
    }
  }
  return sources;
}

function primaryAction(book) {
  const availability = book?.availability || "unavailable";
  if ((availability === "read" || availability === "preview" || availability === "borrow") && book?.id) {
    return {
      label:
        availability === "borrow"
          ? "Open reader"
          : availability === "preview"
            ? "Preview"
            : "Read",
      href: `/reader.html?id=${encodeURIComponent(book.id)}`,
      kind: availability,
      external: false,
    };
  }

  const fallback = (book?.actions || [])[0];
  if (fallback?.url) {
    return {
      label: fallback.label || "View source",
      href: fallback.url,
      kind: fallback.kind || availability,
      external: true,
    };
  }

  return null;
}

function joinBookFacts(book) {
  const facts = [];
  if (book?.publishedYear) facts.push(String(book.publishedYear));
  if (book?.language) facts.push(String(book.language).toUpperCase());
  if (book?.pageCount) facts.push(`${book.pageCount} pages`);
  if (book?.sourceLabel) facts.push(book.sourceLabel);
  return facts.join(" · ");
}

export { coverSources, joinBookFacts, primaryAction, requestBooks };
