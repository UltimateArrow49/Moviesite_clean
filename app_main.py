import concurrent.futures
import datetime
import json
import ipaddress
import logging
import os
import re
import sqlite3
import threading
import time
from typing import Any, Dict, Iterable, List, Optional
from urllib.parse import parse_qs, quote, urljoin, urlparse

import requests
from flask import Flask, Response, redirect, request, stream_with_context

# curl_cffi impersonates a real Chrome's TLS/HTTP2 fingerprint. Some stream CDNs
# and videasy itself fingerprint plain python-requests and serve junk/403 to it
# while a real browser gets the video. We route the source-API and media fetches
# through it so the server looks like Chrome; fall back to requests if unavailable.
try:
    from curl_cffi import requests as cffi_requests  # type: ignore
except Exception:  # pragma: no cover
    cffi_requests = None

_IMPERSONATE = "chrome"


def _browserlike_get(url, *, headers=None, params=None, timeout=20,
                     stream=False, allow_redirects=True):
    """GET that impersonates Chrome via curl_cffi when available."""
    if cffi_requests is not None:
        try:
            cffi_timeout = timeout[1] if isinstance(timeout, tuple) else timeout
            return cffi_requests.get(
                url, headers=headers, params=params, timeout=cffi_timeout,
                stream=stream, allow_redirects=allow_redirects, impersonate=_IMPERSONATE,
            )
        except Exception as exc:  # fall back to plain requests
            logging.getLogger(__name__).warning("curl_cffi GET failed (%s); falling back", str(exc)[:80])
    return requests.get(url, headers=headers, params=params, timeout=timeout,
                        stream=stream, allow_redirects=allow_redirects)
from books_backend import (
    ensure_books_tables,
    fetch_book_asset,
    fetch_book_page_image,
    get_book_item,
    get_book_loan_status,
    get_book_pages,
    get_book_read,
    search_books,
    update_book_loan,
)
from theater_backend import (
    TheaterError,
    add_suggestion,
    close_room,
    create_room,
    ensure_theater_tables,
    get_room_state,
    join_room,
    list_events,
    post_chat_message,
    report_ready,
    reset_screening,
    select_media,
    set_vote,
    update_playback,
    update_presence,
)

app = Flask(__name__)

SYNC_DB_PATH = os.environ.get("MOVIESITE_SYNC_DB") or os.path.join(
    os.path.dirname(__file__),
    "moviesite_sync.sqlite3",
)
SYNC_KEY_PATTERN = re.compile(r"^[0-9a-f]{64}$")
ADMIN_SYNC_KEY = "REDACTED"
HISTORY_LIMIT = 25
RECENT_LIMIT = 60
GOOGLE_BOOKS_API_KEY = os.environ.get("GOOGLE_BOOKS_API_KEY")
MIN_PROGRESS_TO_KEEP = 30
NEAR_COMPLETE_MIN_SECONDS = 90
NEAR_COMPLETE_PERCENT = 0.97
VIDKING_ORIGIN = "https://www.vidking.net"
VIDKING_AD_SCRIPT_PATTERN = re.compile(
    r'<script[^>]+src="http/home/user\.net/api/script\.js"[^>]*></script>',
    re.IGNORECASE,
)
VIDKING_IFRAME_GUARD_PATTERN = 'window.self!==window.top'
VIDKING_AD_CONDITION_PATTERN = 'sessionStorage.getItem("adsEnabled")!=="false"'
VIDKING_SOURCE_PAYLOAD_PATTERN = 'const n={url:"",sources:e.sources.filter(i=>i&&i.url&&i.quality),subtitles:e.subtitles||[]};'
VIDKING_DIRECT_SOURCE_PATTERN = 'const f={url:"",sources:m.sources,subtitles:m.subtitles||[]};'
# VidKing ships only 4 videasy source endpoints (Oxygen/mb-flix, Hydrogen/cdn,
# Lithium/downloader2, Helium/1movies); api.videasy.to exposes a few more on the
# same tmdbId-keyed encryption (VidKing's WASM decrypts them fine). We inject the
# extras + run every server in PARALLEL so all sources are tested, not just the
# first that hits. Extras that currently still return sources: tejo, lamovie,
# meine (hdmovie/superflix/m4uhd often error but are harmless under allSettled).
#
# IMPORTANT: this is done with REGEX (not exact-string .replace) so it survives
# VidKing bundle rotations — the minified var/function names ($e, Ze, At, Ct, yr,
# a, o ...) change on every rotation, but the structure + the stable string
# literals (server names, "Trying ${x} server", endpoint paths) do not. If we
# matched literal minified names, a rotation would silently no-op the injection
# and drop us back to the 4 stock servers (2 of which — downloader2/1movies — are
# now dead). Keep the anchors on the STABLE parts only.
VIDKING_EXTRA_SERVERS = [
    # (KEY, name, endpoint)
    ("TEJO", "Tejo", "tejo/sources-with-title"),
    ("LAMOVIE", "Lamovie", "lamovie/sources-with-title"),
    ("HDMOVIE", "Hdmovie", "hdmovie/sources-with-title"),
    ("SUPERFLIX", "Superflix", "superflix/sources-with-title"),
    ("M4UHD", "M4uhd", "m4uhd/sources-with-title"),
    ("MEINE", "Meine", "meine/sources-with-title"),
]
# Anchor on the (stable) HELIUM server definition + the object's closing brace;
# the object's var name ($e) is irrelevant. Inserts the extras before the close.
_RE_VIDKING_SERVER_LIST = re.compile(
    r'(HELIUM:\{name:"Helium",endpoint:"[^"]+",isActive:!0\})\}'
)
# Ze=[$e.OXYGEN.name,$e.HYDROGEN.name,$e.LITHIUM.name,$e.HELIUM.name] — capture
# the array var (g1) and the object var (g2), both of which change on rotation.
_RE_VIDKING_SERVER_ORDER = re.compile(
    r'(\w+)=\[(\$?\w+)\.OXYGEN\.name,\2\.HYDROGEN\.name,\2\.LITHIUM\.name,\2\.HELIUM\.name\]'
)
# Sequential try-loops → parallel Promise.allSettled (test every server, merge all
# sources). Anchored on the stable console.log strings; g1=success flag, g2=loop
# var, g3=order array, g4=the per-server body (await calls), g5=catch var. The
# minified function names live inside g4 and are preserved verbatim.
_RE_VIDKING_MOVIE_LOOP = re.compile(
    r'let (\w+)=!1;for\(const (\w+) of (\w+)\)\{if\(\1\)break;try\{'
    r'console\.log\(`Trying \$\{\2\} server for movie[^`]*`\);'
    r'(.+?),console\.log\(`Added \$\{\2\}[^`]*`\),\1=!0\}'
    r'catch\((\w+)\)\{console\.error\(`Error getting sources from \$\{\2\}:`,\5\)\}\}'
)
_RE_VIDKING_TV_LOOP = re.compile(
    r'let (\w+)=!1;for\(const (\w+) of (\w+)\)\{if\(\1\)break;try\{'
    r'console\.log\(`Trying \$\{\2\} server for TV[^`]*`\);'
    r'(.+?),console\.log\(`Added \$\{\2\}[^`]*`\),\1=!0\}'
    r'catch\((\w+)\)\{console\.error\(`Error getting sources from \$\{\2\}:`,\5\)\}\}'
)


def _inject_extra_videasy_servers(content: str) -> str:
    """Rotation-proof injection: widen VidKing's videasy server list to all known
    working endpoints and fetch them all in parallel. No-ops gracefully (leaves
    content unchanged) if a given anchor doesn't match the current bundle."""
    # 1) Server-list object: add the extra server definitions.
    if "tejo/sources-with-title" not in content:
        extra_defs = ",".join(
            f'{key}:{{name:"{name}",endpoint:"{endpoint}",isActive:!0}}'
            for key, name, endpoint in VIDKING_EXTRA_SERVERS
        )
        content = _RE_VIDKING_SERVER_LIST.sub(
            lambda m: f"{m.group(1)},{extra_defs}}}", content, count=1
        )

    # 2) Try-order array: insert the extras after Hydrogen, before Lithium/Helium.
    def _order_repl(m: "re.Match") -> str:
        arr, obj = m.group(1), m.group(2)
        names = [f"{obj}.OXYGEN.name", f"{obj}.HYDROGEN.name"]
        names += [f"{obj}.{key}.name" for key, _, _ in VIDKING_EXTRA_SERVERS]
        names += [f"{obj}.LITHIUM.name", f"{obj}.HELIUM.name"]
        return f"{arr}=[{','.join(names)}]"

    content = _RE_VIDKING_SERVER_ORDER.sub(_order_repl, content, count=1)

    # 3) Sequential loops → parallel allSettled (test all servers, merge sources).
    def _loop_repl(m: "re.Match") -> str:
        loop_var, order, body, catch_var = m.group(2), m.group(3), m.group(4), m.group(5)
        return (
            f"await Promise.allSettled({order}.map(async {loop_var}=>{{try{{{body}}}"
            f"catch({catch_var}){{console.error(`Error getting sources from "
            f"${{{loop_var}}}:`,{catch_var})}}}}));"
        )

    content = _RE_VIDKING_MOVIE_LOOP.sub(_loop_repl, content, count=1)
    content = _RE_VIDKING_TV_LOOP.sub(_loop_repl, content, count=1)
    return content
MEDIA_PROXY_ALLOWED_SCHEMES = {"http", "https"}
MEDIA_PROXY_ALLOWED_EXTENSIONS = (
    ".m3u8",
    ".m3u",
    ".mp4",
    ".m4s",
    ".ts",
    ".mkv",
    ".mpd",
    ".vtt",
    ".srt",
    ".key",
    ".aac",
    ".mp3",
)
VIDKING_SOURCE_CHECK_TTL_MS = 5 * 60 * 1000
VIDKING_SOURCE_CHECK_CACHE: Dict[str, Dict[str, Any]] = {}
VIDKING_PRIMARY_SOURCE_ENDPOINTS = (
    ("Oxygen", "mb-flix/sources-with-title"),
    ("Hydrogen", "cdn/sources-with-title"),
)
PROVIDER_PROXY_ORIGINS: Dict[str, str] = {
    "vidsrc-embed-ru": "https://vidsrc-embed.ru",
    "vidsrc-embed-su": "https://vidsrc-embed.su",
    "vidsrcme-ru": "https://vidsrcme.ru",
    "vidsrcme-su": "https://vidsrcme.su",
    "vidsrc-me-ru": "https://vidsrc-me.ru",
    "vidsrc-me-su": "https://vidsrc-me.su",
    "vsrc-su": "https://vsrc.su",
    "vidsrc-rip": "https://vidsrc.rip",
    "vidsrc-to": "https://vidsrc.to",
    "vidsrc-vip": "https://vidsrc.vip",
    "vidsrc-xyz": "https://vidsrc.xyz",
    "vidsrc-ws": "https://vidsrc.ws",
    "vidsrc-stream": "https://vidsrc.stream",
    "videasy-player": "https://player.videasy.net",
    # Confirmed-working backups (matched against ramoflix.net's source list).
    "vidsrc-wtf": "https://vidsrc.wtf",
    "111movies": "https://111movies.com",
    "soap2night": "https://soap2night.site",
    # vidsrc.to renders its actual player inside this nested frame — proxying it
    # too (so it's same-origin) lets us neutralize its window.open + strip its
    # injected ad scripts (otherwise it loads cross-origin and leaks ads).
    "vsembed-ru": "https://vsembed.ru",
}
PROVIDER_PROXY_AD_SCRIPT_PATTERNS = (
    re.compile(r"<script[^>]+cloudnestra[^>]*>.*?</script>", re.IGNORECASE | re.DOTALL),
    re.compile(r"<script[^>]+disable-devtool[^>]*>.*?</script>", re.IGNORECASE | re.DOTALL),
    re.compile(r"<script[^>]+users\.videasy\.net/api/script\.js[^>]*>.*?</script>", re.IGNORECASE | re.DOTALL),
    re.compile(r"<script[^>]+histats\.com[^>]*>.*?</script>", re.IGNORECASE | re.DOTALL),
    re.compile(r"<script[^>]+llvpn\.com[^>]*>.*?</script>", re.IGNORECASE | re.DOTALL),
)
# Ad / analytics / anti-devtool hosts to strip from proxied embeds at the DOM
# level (the injected helper removes any <script>/<iframe>/<a> pointing at these
# as they appear — catches the ones injected dynamically by inline JS, which the
# static regex above can't see). Keep this to KNOWN ad hosts so we never strip a
# real player/CDN node.
PROVIDER_PROXY_AD_HOST_BLOCKLIST = (
    "llvpn.com",
    "histats.com",
    "disable-devtool",
    "devtools-detector",
    "fubuki-umami.space",
    "users.videasy.net/api/script",
    "propellerads",
    "onclicka",
    "popads",
    "poweredby.jads",
    "a.magsrv.com",
)
PROVIDER_PROXY_LANDING_MARKERS = (
    "next generation video streaming api",
    "searching for a way to start your own movie site",
    "try our endless content video player",
    "test player",
    "documentation",
    "iframe sandbox detected",
    "this media is unavailable at the moment",
    "this domain is for sale",
    "contact the owner",
    "404 not found",
)


def _json_response(payload: Dict[str, Any], status: int = 200) -> Response:
    return Response(
        json.dumps(payload),
        status=status,
        mimetype="application/json",
    )


def _coerce_int(value: Any, default: Optional[int] = None) -> Optional[int]:
    try:
        number = int(value)
    except (TypeError, ValueError):
        return default
    return number


def _optional_string(value: Any) -> Optional[str]:
    if isinstance(value, str):
        cleaned = value.strip()
        return cleaned or None
    return None


def _safe_parse_json_array(raw_value: Optional[str]) -> List[Dict[str, Any]]:
    if not raw_value:
        return []
    try:
        parsed = json.loads(raw_value)
    except json.JSONDecodeError:
        return []
    return parsed if isinstance(parsed, list) else []


def _truthy_autoplay_param(value: Optional[str]) -> bool:
    if not isinstance(value, str):
        return False
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _normalize_history_entry(entry: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(entry, dict):
        return None
    entry_id = _optional_string(entry.get("id"))
    tmdb = _optional_string(entry.get("tmdb"))
    mode = entry.get("mode")
    if not entry_id or not tmdb or mode not in {"movie", "tv"}:
        return None

    progress = max(0, _coerce_int(entry.get("progress"), 0) or 0)
    runtime = _coerce_int(entry.get("runtime"))
    if runtime is not None:
        runtime = max(0, runtime)
        if runtime == 0:
            runtime = None
    if runtime and progress >= max(runtime - NEAR_COMPLETE_MIN_SECONDS, int(runtime * NEAR_COMPLETE_PERCENT)):
        progress = 0
    if progress < MIN_PROGRESS_TO_KEEP:
        return None

    season = _coerce_int(entry.get("season"))
    episode = _coerce_int(entry.get("episode"))
    if mode == "tv":
        season = max(1, season or 1)
        episode = max(1, episode or 1)
    else:
        season = None
        episode = None

    updated_at = _coerce_int(entry.get("updatedAt"), _coerce_int(entry.get("lastPlayedAt")))
    if not updated_at:
        updated_at = 0

    return {
        "id": entry_id,
        "mode": mode,
        "tmdb": tmdb,
        "title": entry.get("title") if isinstance(entry.get("title"), str) else "",
        "season": season,
        "episode": episode,
        "poster": _optional_string(entry.get("poster")),
        "backdrop": _optional_string(entry.get("backdrop")),
        "href": _optional_string(entry.get("href")),
        "updatedAt": updated_at,
        "progress": progress,
        "runtime": runtime,
    }


def _prepare_history_entries(entries: Iterable[Any]) -> List[Dict[str, Any]]:
    deduped: Dict[str, Dict[str, Any]] = {}
    for raw_entry in entries or []:
        entry = _normalize_history_entry(raw_entry)
        if not entry:
            continue
        existing = deduped.get(entry["id"])
        if not existing or entry["updatedAt"] >= existing.get("updatedAt", 0):
            deduped[entry["id"]] = entry
    ordered = sorted(
        deduped.values(),
        key=lambda item: item.get("updatedAt", 0),
        reverse=True,
    )
    return ordered[:HISTORY_LIMIT]


def _merge_history_entries(*collections: Iterable[Any]) -> List[Dict[str, Any]]:
    merged: List[Any] = []
    for collection in collections:
        merged.extend(list(collection or []))
    return _prepare_history_entries(merged)


def _normalize_recent_entry(entry: Any) -> Optional[Dict[str, Any]]:
    if not isinstance(entry, dict):
        return None
    slug = _optional_string(entry.get("slug"))
    tmdb = _optional_string(entry.get("tmdb"))
    mode = entry.get("mode")
    if not slug or not tmdb or mode not in {"movie", "tv"}:
        return None

    season = _coerce_int(entry.get("season"))
    episode = _coerce_int(entry.get("episode"))
    if mode == "tv":
        season = max(1, season or 1)
        episode = max(1, episode or 1)
    else:
        season = None
        episode = None

    last_played_at = _coerce_int(entry.get("lastPlayedAt"), _coerce_int(entry.get("updatedAt")))
    if not last_played_at:
        last_played_at = 0

    progress = max(0, _coerce_int(entry.get("progress"), 0) or 0)
    runtime = _coerce_int(entry.get("runtime"))
    if runtime is not None:
        runtime = max(0, runtime)
        if runtime == 0:
            runtime = None

    return {
        "slug": slug,
        "mode": mode,
        "tmdb": tmdb,
        "season": season,
        "episode": episode,
        "title": entry.get("title") if isinstance(entry.get("title"), str) else "",
        "poster": _optional_string(entry.get("poster")),
        "backdrop": _optional_string(entry.get("backdrop")),
        "href": _optional_string(entry.get("href")),
        "progress": progress,
        "completed": bool(entry.get("completed")),
        "runtime": runtime,
        "lastPlayedAt": last_played_at,
    }


def _prepare_recent_entries(entries: Iterable[Any]) -> List[Dict[str, Any]]:
    deduped: Dict[str, Dict[str, Any]] = {}
    for raw_entry in entries or []:
        entry = _normalize_recent_entry(raw_entry)
        if not entry:
            continue
        existing = deduped.get(entry["slug"])
        if not existing or entry["lastPlayedAt"] >= existing.get("lastPlayedAt", 0):
            deduped[entry["slug"]] = entry
    ordered = sorted(
        deduped.values(),
        key=lambda item: item.get("lastPlayedAt", 0),
        reverse=True,
    )
    return ordered[:RECENT_LIMIT]


def _merge_recent_entries(*collections: Iterable[Any]) -> List[Dict[str, Any]]:
    merged: List[Any] = []
    for collection in collections:
        merged.extend(list(collection or []))
    return _prepare_recent_entries(merged)


def _connect_db() -> sqlite3.Connection:
    connection = sqlite3.connect(SYNC_DB_PATH, timeout=30)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA journal_mode=WAL")
    connection.execute("PRAGMA synchronous=NORMAL")
    connection.execute("PRAGMA busy_timeout=5000")
    return connection


def _init_sync_db() -> None:
    sync_directory = os.path.dirname(SYNC_DB_PATH)
    if sync_directory:
        os.makedirs(sync_directory, exist_ok=True)
    with _connect_db() as connection:
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS progress_sync_profiles (
                sync_key TEXT PRIMARY KEY,
                history_json TEXT NOT NULL DEFAULT '[]',
                recent_json TEXT NOT NULL DEFAULT '[]',
                created_at INTEGER NOT NULL,
                updated_at INTEGER,
                last_seen_at INTEGER NOT NULL
            )
            """
        )
        connection.execute(
            """
            CREATE TABLE IF NOT EXISTS movie_availability (
                media_type TEXT NOT NULL,
                tmdb_id TEXT NOT NULL,
                available INTEGER NOT NULL,
                checked_at INTEGER NOT NULL,
                PRIMARY KEY (media_type, tmdb_id)
            )
            """
        )
        ensure_books_tables(connection)
        ensure_theater_tables(connection)


def _read_profile(connection: sqlite3.Connection, sync_key: str) -> Optional[sqlite3.Row]:
    return connection.execute(
        """
        SELECT sync_key, history_json, recent_json, created_at, updated_at, last_seen_at
        FROM progress_sync_profiles
        WHERE sync_key = ?
        """,
        (sync_key,),
    ).fetchone()


def _write_profile(
    connection: sqlite3.Connection,
    sync_key: str,
    history: List[Dict[str, Any]],
    recent: List[Dict[str, Any]],
    *,
    created_at: Optional[int] = None,
    updated_at: Optional[int] = None,
    last_seen_at: int,
) -> None:
    existing = _read_profile(connection, sync_key)
    created_value = created_at or (existing["created_at"] if existing else last_seen_at)
    connection.execute(
        """
        INSERT INTO progress_sync_profiles (
            sync_key,
            history_json,
            recent_json,
            created_at,
            updated_at,
            last_seen_at
        ) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(sync_key) DO UPDATE SET
            history_json = excluded.history_json,
            recent_json = excluded.recent_json,
            updated_at = excluded.updated_at,
            last_seen_at = excluded.last_seen_at
        """,
        (
            sync_key,
            json.dumps(history, separators=(",", ":")),
            json.dumps(recent, separators=(",", ":")),
            created_value,
            updated_at,
            last_seen_at,
        ),
    )


def _profile_payload(row: Optional[sqlite3.Row]) -> Dict[str, Any]:
    if not row:
        return {"history": [], "recent": [], "lastSyncedAt": None}
    history = _prepare_history_entries(_safe_parse_json_array(row["history_json"]))
    recent = _prepare_recent_entries(_safe_parse_json_array(row["recent_json"]))
    last_synced_at = row["updated_at"] if history or recent else None
    return {
        "history": history,
        "recent": recent,
        "lastSyncedAt": last_synced_at,
    }


def _valid_sync_key(sync_key: str) -> bool:
    return bool(SYNC_KEY_PATTERN.fullmatch(sync_key))


def _require_admin_sync(payload: Dict[str, Any]) -> str:
    sync_key = str(payload.get("syncKey", "")).strip()
    if not _valid_sync_key(sync_key):
        raise TheaterError("invalid_sync_key", 400, "A valid sync key is required.")
    if sync_key != ADMIN_SYNC_KEY:
        raise TheaterError(
            "forbidden",
            403,
            "Theater is only available to the admin passphrase.",
        )
    return sync_key


def _parse_sync_request() -> Optional[Dict[str, Any]]:
    payload = request.get_json(silent=True)
    return payload if isinstance(payload, dict) else None


def _now_ms() -> int:
    return int(time.time() * 1000)


def _parse_json_request() -> Optional[Dict[str, Any]]:
    payload = request.get_json(silent=True)
    if isinstance(payload, dict):
        return payload

    if request.form:
        return {key: value for key, value in request.form.items()}

    raw_payload = (request.get_data(as_text=True) or "").strip()
    if not raw_payload:
        return None

    try:
        payload = json.loads(raw_payload)
    except json.JSONDecodeError:
        form_payload = {
            key: values[-1]
            for key, values in parse_qs(raw_payload, keep_blank_values=False).items()
            if values
        }
        return form_payload or None
    return payload if isinstance(payload, dict) else None


# ──────────────────────────────────────────────────────────────────────────
# Source-availability filtering: hide titles that have no playable VidKing
# source, and rotate the trending list daily so "Featured today" changes.
# ──────────────────────────────────────────────────────────────────────────
AVAILABILITY_TTL_MS = 3 * 24 * 60 * 60 * 1000  # re-check each title every 3 days
AVAILABILITY_MIN_BYTES = 15000  # real source payloads are 35KB+; "empty" ones are ~3KB
AVAILABILITY_PROBE_ENDPOINT = "cdn/sources-with-title"
AVAILABILITY_PROBE_TIMEOUT_SEC = 7
AVAILABILITY_DEADLINE_SEC = 4.0  # max time to block a list request on uncached checks
# Theatrical releases need a few days before any stream provider has a real source.
AVAILABILITY_MIN_RELEASE_AGE_DAYS = 0
_availability_memory: Dict[str, Dict[str, Any]] = {}
_availability_lock = threading.Lock()
# Keep concurrency low so we do not get rate-limited (HTTP 429) / banned by videasy.
_availability_pool = concurrent.futures.ThreadPoolExecutor(max_workers=4)


def _release_date_ok(item: Dict[str, Any], media_type: str) -> bool:
    """A title can only have a real source once it has actually been released.
    Unreleased / future-dated entries (TMDB lists many in trending & now-playing)
    are dropped outright -- this is the reliable, zero-cost availability signal."""
    if not isinstance(item, dict):
        return False
    field = "first_air_date" if media_type == "tv" else "release_date"
    raw = (item.get(field) or "").strip()
    if not raw:
        return False
    try:
        released = datetime.date.fromisoformat(raw[:10])
    except ValueError:
        return False
    cutoff = datetime.date.today() - datetime.timedelta(days=AVAILABILITY_MIN_RELEASE_AGE_DAYS)
    return released <= cutoff


def _availability_key(media_type: str, tmdb_id: Any) -> str:
    return f"{media_type}:{tmdb_id}"


def _read_availability_cache(media_type: str, tmdb_id: Any) -> Optional[bool]:
    key = _availability_key(media_type, tmdb_id)
    now = _now_ms()
    with _availability_lock:
        entry = _availability_memory.get(key)
    if entry and now - entry["ts"] < AVAILABILITY_TTL_MS:
        return entry["available"]
    try:
        with _connect_db() as connection:
            row = connection.execute(
                "SELECT available, checked_at FROM movie_availability WHERE media_type = ? AND tmdb_id = ?",
                (media_type, str(tmdb_id)),
            ).fetchone()
    except sqlite3.Error:
        row = None
    if row and now - row["checked_at"] < AVAILABILITY_TTL_MS:
        available = bool(row["available"])
        with _availability_lock:
            _availability_memory[key] = {"available": available, "ts": row["checked_at"]}
        return available
    return None


def _write_availability_cache(media_type: str, tmdb_id: Any, available: bool) -> None:
    now = _now_ms()
    with _availability_lock:
        _availability_memory[_availability_key(media_type, tmdb_id)] = {"available": available, "ts": now}
    try:
        with _connect_db() as connection:
            connection.execute(
                "INSERT INTO movie_availability (media_type, tmdb_id, available, checked_at) "
                "VALUES (?, ?, ?, ?) "
                "ON CONFLICT(media_type, tmdb_id) DO UPDATE SET "
                "available = excluded.available, checked_at = excluded.checked_at",
                (media_type, str(tmdb_id), 1 if available else 0, now),
            )
    except sqlite3.Error:
        pass


def _probe_source_availability(media_type: str, tmdb_id: Any) -> Optional[bool]:
    """Return True/False if known, or None when the upstream check is inconclusive
    (e.g. transient error) so the caller can fail open and keep the title."""
    try:
        resp = requests.get(
            f"https://api.videasy.to/{AVAILABILITY_PROBE_ENDPOINT}",
            params={"tmdbId": str(tmdb_id), "mediaType": media_type},
            headers={
                "Origin": VIDKING_ORIGIN,
                "Referer": VIDKING_ORIGIN + "/",
                "User-Agent": "Mozilla/5.0",
            },
            timeout=AVAILABILITY_PROBE_TIMEOUT_SEC,
        )
    except requests.RequestException:
        return None
    if not resp.ok:
        # Non-200 can be a transient upstream error -> treat as unknown, don't cache.
        return None
    body = (resp.text or "").strip()
    if not body or body.startswith("{"):
        return False
    return len(body) >= AVAILABILITY_MIN_BYTES


def _movie_available(media_type: str, tmdb_id: Any) -> Optional[bool]:
    cached = _read_availability_cache(media_type, tmdb_id)
    if cached is not None:
        return cached
    result = _probe_source_availability(media_type, tmdb_id)
    if result is not None:
        _write_availability_cache(media_type, tmdb_id, result)
    return result


def _filter_results_by_availability(payload: Dict[str, Any], media_type: str) -> Dict[str, Any]:
    results = payload.get("results")
    if not isinstance(results, list) or not results:
        return payload

    # Release-date gate ONLY. Unreleased titles can never have a real source, so
    # they are dropped (an all-future feed like "Upcoming" comes back empty).
    #
    # NOTE: a per-title source probe used to run here, but it hammered
    # api.videasy.to and got the server IP blocked by Cloudflare. It has been
    # removed -- availability filtering is now purely the (zero external call)
    # release-date check.
    released = [item for item in results if _release_date_ok(item, media_type)]

    new_payload = dict(payload)
    new_payload["results"] = released
    return new_payload


def _rotate_results_for_day(payload: Dict[str, Any], media_type: str) -> Dict[str, Any]:
    results = payload.get("results")
    if not isinstance(results, list) or len(results) < 2:
        return payload
    offset = datetime.date.today().toordinal() % len(results)
    if offset == 0:
        return payload
    new_payload = dict(payload)
    new_payload["results"] = results[offset:] + results[:offset]
    return new_payload


def _maybe_filter_tmdb_response(
    response: Response, media_type: Optional[str], rotate_daily: bool
) -> Response:
    if media_type is None or response.status_code != 200:
        return response
    content_type = (response.headers.get("Content-Type") or "").lower()
    if "json" not in content_type:
        return response
    try:
        payload = json.loads(response.get_data(as_text=True))
    except (ValueError, TypeError):
        return response
    if not isinstance(payload, dict) or not isinstance(payload.get("results"), list):
        return response

    payload = _filter_results_by_availability(payload, media_type)
    if rotate_daily:
        payload = _rotate_results_for_day(payload, media_type)
    return _json_response(payload, status=200)


def _tmdb_list_context(path: str) -> "tuple[Optional[str], bool]":
    """Decide whether a TMDB path is a browsable list we should filter, and
    whether it should rotate daily (the trending feed that drives Featured today)."""
    p = path.strip("/").lower()
    list_markers = ("trending/", "discover/", "/now_playing", "/popular", "/upcoming", "/top_rated", "search/")
    if not any(marker in "/" + p for marker in list_markers):
        return None, False
    media_type = "tv" if ("/tv" in "/" + p or p.startswith("tv/")) else "movie"
    rotate_daily = p.startswith("trending/")
    return media_type, rotate_daily


def _tmdb_get(path: str, params: Optional[Dict[str, Any]] = None) -> Response:
    params = dict(params or {})

    token = (
        os.environ.get("TMDB_API_TOKEN")
        or os.environ.get("TMDB_BEARER_TOKEN")
        or os.environ.get("TMDB_READ_TOKEN")
    )
    api_key = os.environ.get("TMDB_API_KEY")

    headers = {"Accept": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    elif api_key:
        params.setdefault("api_key", api_key)
    else:
        return _json_response({"error": "TMDB credentials not configured"}, status=500)

    url = f"https://api.themoviedb.org/3{path}"

    try:
        upstream = requests.get(url, headers=headers, params=params, timeout=12)
    except requests.RequestException as exc:  # pragma: no cover - defensive
        logging.getLogger(__name__).exception("TMDB request failed: %s", path)
        return _json_response(
            {"error": "upstream_tmdb_error", "detail": str(exc)},
            status=502,
        )

    response = Response(upstream.content, status=upstream.status_code)
    response.headers["Content-Type"] = upstream.headers.get("Content-Type") or "application/json"

    media_type, rotate_daily = _tmdb_list_context(path)
    if media_type is not None:
        response = _maybe_filter_tmdb_response(response, media_type, rotate_daily)
    return response


def _vidking_headers() -> Dict[str, str]:
    user_agent = request.headers.get("User-Agent") or "Mozilla/5.0"
    accept_language = request.headers.get("Accept-Language") or "en-US,en;q=0.9"
    return {
        "User-Agent": user_agent,
        "Accept-Language": accept_language,
        "Accept": request.headers.get("Accept") or "*/*",
        "Referer": request.url_root.rstrip("/") + "/",
    }


def _sanitize_proxy_referrer(ref_url: Optional[str]) -> Optional[str]:
    if not ref_url:
        return None
    ref_url = ref_url.strip()
    if not ref_url:
        return None
    try:
        parsed = urlparse(ref_url)
    except ValueError:
        return None
    if parsed.scheme not in MEDIA_PROXY_ALLOWED_SCHEMES or not parsed.netloc:
        return None
    hostname = (parsed.hostname or "").strip().lower()
    if not hostname or hostname in {"localhost", "127.0.0.1", "::1"}:
        return None
    return ref_url


def _request_media_referrer() -> Optional[str]:
    explicit_ref = _sanitize_proxy_referrer(request.args.get("ref"))
    if explicit_ref:
        return explicit_ref

    header_ref = _sanitize_proxy_referrer(request.headers.get("Referer"))
    if not header_ref:
        return None

    try:
        parsed_ref = urlparse(header_ref)
    except ValueError:
        return None

    request_host = (request.host or "").split(":", 1)[0].lower()
    ref_host = (parsed_ref.hostname or "").strip().lower()
    if ref_host == request_host and parsed_ref.path.startswith("/embed/"):
        translated = VIDKING_ORIGIN + parsed_ref.path
        if parsed_ref.query:
            translated += "?" + parsed_ref.query
        return translated
    return header_ref


def _request_provider_referrer() -> Optional[str]:
    header_ref = _sanitize_proxy_referrer(request.headers.get("Referer"))
    if not header_ref:
        return None

    try:
        parsed_ref = urlparse(header_ref)
    except ValueError:
        return None

    request_host = (request.host or "").split(":", 1)[0].lower()
    ref_host = (parsed_ref.hostname or "").strip().lower()
    if ref_host != request_host:
        return header_ref

    provider_match = re.match(r"^/ext/provider/([^/]+)/(.+)$", parsed_ref.path)
    if provider_match:
        provider_key, upstream_path = provider_match.groups()
        origin = PROVIDER_PROXY_ORIGINS.get(provider_key)
        if origin:
            translated = urljoin(f"{origin.rstrip('/')}/", upstream_path)
            if parsed_ref.query:
                translated += "?" + parsed_ref.query
            return translated

    if parsed_ref.path.startswith("/embed/"):
        translated = VIDKING_ORIGIN + parsed_ref.path
        if parsed_ref.query:
            translated += "?" + parsed_ref.query
        return translated

    return header_ref


def _rewrite_vidking_html(html: str, upstream_page_url: str) -> str:
    rewritten = re.sub(
        r'((?:src|href)=["\'])/(?!/)',
        r"\1/ext/vidking/",
        html,
        flags=re.IGNORECASE,
    )
    rewritten = rewritten.replace(
        "https://users.videasy.net/api/script.js",
        "https://users.videasy.to/api/script.js",
    )
    helper_script = """
<script>
(function(){
// --- Rotation-proof source routing ---------------------------------------
// videasy now only allows the api.videasy.to source API from the vidking.net
// origin (it 403s the CORS preflight from ours), and the stream CDNs 403 without
// a vidking.net referer. Rather than patch VidKing's frequently-rotated bundle,
// intercept requests at the network layer and route them through our own proxy
// (which presents the vidking.net origin/referer server-side). This keeps working
// across VidKing bundle changes because it never touches their minified code.
(function(){
  function _rwReq(u){
    try{
      if(typeof u!=="string"||!u||u.indexOf("/ext/")===0) return u;
      // Source API (seed + sources-with-title) is ORIGIN-GATED: it 503s any origin
      // except vidking.net / cineby.at. So we MUST proxy it server-side presenting a
      // vidking.net origin. Host-agnostic because VidKing rotates the host
      // (videasy.to -> wingsdatabase -> speedracelight -> ...). Resolving it
      // server-side also mints the CDN stream token against OUR server (IP+origin),
      // so the stream (proxied below from the SAME server) matches the token —
      // browser-direct would NOT match and 403s.
      var api=u.match(/^https?:\\/\\/(api\\.[a-z0-9.-]+)\\/(.+)$/i);
      if(api && /(seed\\?mediaId=|sources-with-title)/i.test(u)){
        var p=api[2], sep=p.indexOf("?")>-1?"&":"?";
        return "/ext/videasy_api/"+p+sep+"_host="+encodeURIComponent(api[1]);
      }
      // Streams: fetched BROWSER-DIRECT. VidKing's stream CDNs (moon.iron*.net,
      // Cloudflare-fronted) send Access-Control-Allow-Origin:* but 403 tokenised
      // paths from datacenter IPs (our /ext/media proxy) — the user's residential
      // IP is what the CDN accepts, exactly as vidking.net/cineby.at do it. So we
      // leave media URLs untouched and let hls.js load them from the origin CDN.
    }catch(e){}
    return u;
  }
  var _f=window.fetch;
  if(_f){
    window.fetch=function(input,init){
      try{
        if(typeof input==="string"){ input=_rwReq(input); }
        else if(input&&input.url){ var nu=_rwReq(input.url); if(nu!==input.url){ input=new Request(nu,input); } }
      }catch(e){}
      return _f.apply(this,[input,init]);
    };
  }
  var _open=XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open=function(){
    try{ if(arguments.length>1){ arguments[1]=_rwReq(arguments[1]); } }catch(e){}
    return _open.apply(this,arguments);
  };
})();
var _a=0,_m=10;
function _tbbProxyUrl(u){
  // Browser-direct streaming (see _rwReq): leave stream URLs untouched.
  return u;
}
window.__tbbProxySourcePayload=function(p){
  try{
    if(p&&p.sources&&p.sources.length){
      p.sources.forEach(function(s){ if(s&&s.url){ s.url=_tbbProxyUrl(s.url); } });
    }
    if(p&&p.subtitles&&p.subtitles.length){
      p.subtitles.forEach(function(st){
        if(st){
          if(st.url){ st.url=_tbbProxyUrl(st.url); }
          if(st.file){ st.file=_tbbProxyUrl(st.file); }
        }
      });
    }
  }catch(e){}
  if(p.sources&&p.sources.length>0){_a=0;return p;}
  if(++_a>=_m){_a=0;return p;}
  throw new Error("tbb:empty");
};
// Theater remote control: let the parent page seek/play/pause this player without
// reloading the iframe, so audience members keep up smoothly when the host skips.
(function(){
  function _v(){var v=document.querySelector('video');if(v){try{v.setAttribute('playsinline','');v.setAttribute('webkit-playsinline','');v.playsInline=true;}catch(e){}}return v;}
  function _seek(t){var v=_v();if(v&&isFinite(t)){try{v.currentTime=Math.max(0,t);}catch(e){}}}
  function _play(){var v=_v();if(!v)return;try{var p=v.play();if(p&&p.catch){p.catch(function(){
    // Autoplay blocked (guest hasn't gestured yet): play muted so the audience
    // still stays in sync with the host — they can click to unmute. Without this
    // the guest's video would just freeze on a paused frame.
    try{v.muted=true;var p2=v.play();if(p2&&p2.catch){p2.catch(function(){});}}catch(e){}
  });}}catch(e){}}
  function _pause(){var v=_v();if(v){try{v.pause();}catch(e){}}}
  window.addEventListener('message',function(ev){
    var d=ev.data;
    if(typeof d==='string'){try{d=JSON.parse(d);}catch(e){return;}}
    if(!d||typeof d!=='object'||d.type!=='PLAYER_COMMAND')return;
    var cmd=String(d.command||'').toLowerCase();
    var raw=(d.value!=null)?d.value:((d.seconds!=null)?d.seconds:d.position);
    var t=Number(raw);
    if(cmd==='seek'){_seek(t);}
    else if(cmd==='play'){if(isFinite(t)){_seek(t);}_play();}
    else if(cmd==='pause'){if(isFinite(t)){_seek(t);}_pause();}
  },false);
})();
var _done=false,_t=null;
function _tryAuto(){
  if(_done) return;
  var body=document.body;
  if(!body||(body.innerText||'').indexOf('Playback Error')<0) return;
  var els=document.querySelectorAll('div,li,button');
  for(var i=0;i<els.length;i++){
    var el=els[i];
    if(el.children.length<1||el.children.length>5) continue;
    var txt=el.innerText||'';
    if(txt.length>80) continue;
    if(/Available/.test(txt)&&!/Unavailable/.test(txt)&&!/Current/.test(txt)){
      _done=true;
      el.click();
      return;
    }
  }
}
new MutationObserver(function(){clearTimeout(_t);_t=setTimeout(_tryAuto,1200);}).observe(document.documentElement,{subtree:true,childList:true});
})();
</script>
""".strip()
    if "window.__tbbProxySourcePayload" not in rewritten and "</head>" in rewritten:
        rewritten = rewritten.replace("</head>", helper_script + "\n</head>", 1)
    return rewritten


def _rewrite_vidking_asset(asset_path: str, content: str) -> str:
    if asset_path.startswith("assets/") and asset_path.endswith(".js"):
        rewritten = content.replace('"/assets/', '"/ext/vidking/assets/')
        rewritten = rewritten.replace("'/assets/", "'/ext/vidking/assets/")
        rewritten = rewritten.replace('"assets/', '"ext/vidking/assets/')
        if asset_path.startswith("assets/index-"):
            rewritten = (
                rewritten.replace(VIDKING_IFRAME_GUARD_PATTERN, "!1")
                .replace(VIDKING_AD_CONDITION_PATTERN, "!1")
            )
        if asset_path.startswith("assets/VideoPlayer-"):
            rewritten = rewritten.replace(
                VIDKING_SOURCE_PAYLOAD_PATTERN,
                'const n=(function(){var _s=e.sources.filter(i=>i&&i.url);var _p={url:"",sources:_s,subtitles:e.subtitles||[]};return window.__tbbProxySourcePayload?window.__tbbProxySourcePayload(_p):_p;})();',
            )
            rewritten = rewritten.replace(
                VIDKING_DIRECT_SOURCE_PATTERN,
                'const f=(function(){var _p={url:"",sources:m.sources,subtitles:m.subtitles||[]};return window.__tbbProxySourcePayload?window.__tbbProxySourcePayload(_p):_p;})();',
            )
            # Widen the source-server list to match Cineby: VidKing only ships 4
            # videasy endpoints, but api.videasy.to exposes several more that share
            # the same (tmdbId-keyed) encryption, so VidKing's own WASM decrypts
            # them fine. Adding them + testing all in parallel raises the playable-
            # title hit rate. Regex-based so it survives VidKing bundle rotations.
            rewritten = _inject_extra_videasy_servers(rewritten)

        return rewritten
    return content


def _is_public_media_target(target_url: str) -> bool:
    try:
        parsed = urlparse(target_url)
    except ValueError:
        return False

    if parsed.scheme not in MEDIA_PROXY_ALLOWED_SCHEMES or not parsed.netloc:
        return False

    hostname = (parsed.hostname or "").strip().lower()
    if not hostname or hostname in {"localhost", "127.0.0.1", "::1"}:
        return False

    try:
        ip = ipaddress.ip_address(hostname)
    except ValueError:
        ip = None
    if ip and (ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_multicast):
        return False

    # Any public host is allowed — private/loopback/reserved/multicast targets are
    # already rejected above (the SSRF guard that actually matters). The old
    # extension allowlist broke playback on CDNs that serve HLS segments via
    # extensionless query-token URLs (e.g. files.anotherweather.com/?q=...), which
    # is why some titles played and others returned "no sources / can't play".
    return True


def _proxy_media_url(target_url: str, ref_url: Optional[str] = None) -> str:
    proxied_url = f"/ext/media?url={quote(target_url, safe='')}"
    safe_ref = _sanitize_proxy_referrer(ref_url)
    if safe_ref:
        proxied_url += f"&ref={quote(safe_ref, safe='')}"
    return proxied_url


def _provider_display_name(provider_key: str) -> str:
    return provider_key.replace("-", " ").title()


def _provider_error_response(message: str, *, status: int = 200) -> Response:
    escaped_message = json.dumps(message)
    html = f"""<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Provider unavailable</title>
</head>
<body>
  <script>
    (function () {{
      var payload = {{
        type: "PLAYER_EVENT",
        event: "error",
        message: {escaped_message}
      }};
      function notifyParent() {{
        if (window.parent && window.parent !== window) {{
          window.parent.postMessage(JSON.stringify(payload), "*");
          window.parent.postMessage(payload, "*");
        }}
      }}
      try {{
        notifyParent();
        setTimeout(notifyParent, 150);
        setTimeout(notifyParent, 500);
        setTimeout(notifyParent, 1200);
      }} catch (error) {{
        console.warn("Unable to notify parent player", error);
      }}
    }})();
  </script>
  <p>{message}</p>
</body>
</html>"""
    response = Response(html, status=status, mimetype="text/html")
    response.headers["Cache-Control"] = "no-store"
    return response


def _provider_headers(origin: str, referrer: Optional[str] = None) -> Dict[str, str]:
    referer = referrer or origin.rstrip("/") + "/"
    return {
        "User-Agent": request.headers.get("User-Agent") or "Mozilla/5.0",
        "Accept": request.headers.get("Accept") or "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": request.headers.get("Accept-Language") or "en-US,en;q=0.9",
        "Referer": referer,
        "Origin": origin.rstrip("/"),
        "Cache-Control": "no-cache",
        "Pragma": "no-cache",
    }


def _provider_proxy_prefix(provider_key: str) -> str:
    return f"/ext/provider/{provider_key}/"


def _rewrite_provider_html(provider_key: str, html: str, upstream_page_url: str) -> str:
    rewritten = html
    for pattern in PROVIDER_PROXY_AD_SCRIPT_PATTERNS:
        rewritten = pattern.sub("", rewritten)
    for known_key, origin in PROVIDER_PROXY_ORIGINS.items():
        proxy_prefix = _provider_proxy_prefix(known_key)
        parsed_origin = urlparse(origin)
        host = parsed_origin.netloc
        rewritten = rewritten.replace(f'"{origin}/', f'"{proxy_prefix}')
        rewritten = rewritten.replace(f"'{origin}/", f"'{proxy_prefix}")
        rewritten = rewritten.replace(f'"//{host}/', f'"{proxy_prefix}')
        rewritten = rewritten.replace(f"'//{host}/", f"'{proxy_prefix}")
    proxy_prefix = _provider_proxy_prefix(provider_key)
    rewritten = re.sub(
        r'((?:src|href)=["\'])/(?!/|ext/)',
        rf"\1{proxy_prefix}",
        rewritten,
        flags=re.IGNORECASE,
    )
    helper_script = """
<script>
window.open = function () { return null; };
window.__tbbProviderProxyReferrer = REFERRER_PLACEHOLDER;
window.__tbbProviderDeadStateNotified = false;
window.__tbbNotifyProviderDeadState = function (message) {
  if (window.__tbbProviderDeadStateNotified) return;
  window.__tbbProviderDeadStateNotified = true;
  var payload = { type: "PLAYER_EVENT", event: "error", message: message || "Provider reported this media is unavailable." };
  try {
    if (window.parent && window.parent !== window) {
      window.parent.postMessage(JSON.stringify(payload), "*");
      window.parent.postMessage(payload, "*");
    }
  } catch (error) {
    console.warn("Unable to notify parent player", error);
  }
};
window.__tbbScanProviderDeadState = function () {
  var text = "";
  try {
    text = (document.body && document.body.innerText || "").toLowerCase();
  } catch (error) {
    return;
  }
  if (
    text.indexOf("this media is unavailable at the moment") !== -1 ||
    text.indexOf("no sources available") !== -1 ||
    text.indexOf("iframe sandbox detected") !== -1
  ) {
    window.__tbbNotifyProviderDeadState("Provider reported this media is unavailable. Trying another provider...");
  }
};
document.addEventListener("click", function (event) {
  var node = event.target;
  while (node && node !== document.body) {
    if (node.tagName === "A" && node.href && !node.href.startsWith(window.location.origin)) {
      event.preventDefault();
      event.stopPropagation();
      return false;
    }
    node = node.parentElement;
  }
}, true);
// DOM-level ad stripper: remove any script/iframe/anchor pointing at a known ad
// host the moment it's added (catches scripts injected dynamically by inline JS,
// which the server-side regex can't see). This helper is injected into every
// proxied frame — including the nested vsembed player frame — so it runs there
// too. Only the explicit blocklist is touched; the real player/CDN is untouched.
window.__tbbAdHosts = AD_HOSTS_PLACEHOLDER;
window.__tbbIsAdUrl = function (url) {
  if (!url) return false;
  url = String(url);
  for (var i = 0; i < window.__tbbAdHosts.length; i++) {
    if (url.indexOf(window.__tbbAdHosts[i]) !== -1) return true;
  }
  return false;
};
window.__tbbStripAds = function () {
  try {
    var nodes = document.querySelectorAll("script[src],iframe[src],a[href]");
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      var u = n.getAttribute("src") || n.getAttribute("href") || "";
      if (window.__tbbIsAdUrl(u)) {
        if (n.tagName === "A") { n.removeAttribute("href"); }
        else if (n.parentNode) { n.parentNode.removeChild(n); }
      }
    }
  } catch (error) {}
};
try {
  new MutationObserver(window.__tbbStripAds).observe(
    document.documentElement, { childList: true, subtree: true }
  );
} catch (error) {}
document.addEventListener("DOMContentLoaded", window.__tbbStripAds);
window.__tbbStripAds();
setInterval(window.__tbbStripAds, 1000);
document.addEventListener("DOMContentLoaded", window.__tbbScanProviderDeadState);
setInterval(window.__tbbScanProviderDeadState, 1000);
</script>
""".strip().replace("REFERRER_PLACEHOLDER", json.dumps(upstream_page_url)).replace("AD_HOSTS_PLACEHOLDER", json.dumps(list(PROVIDER_PROXY_AD_HOST_BLOCKLIST)))
    if "window.__tbbProviderProxyReferrer" not in rewritten and "</head>" in rewritten:
        rewritten = rewritten.replace("</head>", helper_script + "\n</head>", 1)
    return rewritten


def _rewrite_provider_asset(provider_key: str, asset_path: str, content: str, content_type: str) -> str:
    proxy_prefix = _provider_proxy_prefix(provider_key)
    rewritten = content.replace('"/', f'"{proxy_prefix}').replace("'/", f"'{proxy_prefix}")
    if "text/css" in content_type:
        rewritten = rewritten.replace("url(/", f"url({proxy_prefix}")
    if asset_path.endswith(".js") or "javascript" in content_type:
        rewritten = rewritten.replace("window.open(", "(()=>null)(")
        rewritten = rewritten.replace("top.location", "window.location")
        rewritten = rewritten.replace("parent.location", "window.location")
    return rewritten


def _looks_like_provider_landing_page(provider_key: str, final_url: str, html: str) -> bool:
    sample = html[:50000].lower()
    if any(marker in sample for marker in PROVIDER_PROXY_LANDING_MARKERS):
        return True
    try:
        parsed = urlparse(final_url)
    except ValueError:
        return False
    if provider_key == "vidsrc-to" and parsed.path in {"", "/"}:
        return True
    title_match = re.search(r"<title>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
    title = title_match.group(1).strip().lower() if title_match else ""
    if provider_key == "videasy-player" and title == "videasy":
        return True
    return False


def _vidking_source_cache_key(media_type: str, tmdb_id: str, season_id: Optional[str], episode_id: Optional[str]) -> str:
    return "|".join(
        [
            media_type,
            str(tmdb_id).strip(),
            str(season_id or "").strip(),
            str(episode_id or "").strip(),
        ]
    )


def _read_vidking_source_cache(media_type: str, tmdb_id: str, season_id: Optional[str], episode_id: Optional[str]) -> Optional[bool]:
    cache_key = _vidking_source_cache_key(media_type, tmdb_id, season_id, episode_id)
    cached = VIDKING_SOURCE_CHECK_CACHE.get(cache_key)
    if not cached:
        return None
    if (_now_ms() - int(cached.get("checkedAt", 0))) > VIDKING_SOURCE_CHECK_TTL_MS:
        VIDKING_SOURCE_CHECK_CACHE.pop(cache_key, None)
        return None
    return bool(cached.get("hasSources"))


def _write_vidking_source_cache(
    media_type: str,
    tmdb_id: str,
    season_id: Optional[str],
    episode_id: Optional[str],
    has_sources: bool,
) -> None:
    cache_key = _vidking_source_cache_key(media_type, tmdb_id, season_id, episode_id)
    VIDKING_SOURCE_CHECK_CACHE[cache_key] = {
        "checkedAt": _now_ms(),
        "hasSources": bool(has_sources),
    }


def _fetch_videasy_metadata(media_type: str, tmdb_id: str) -> Optional[Dict[str, str]]:
    metadata_url = f"https://db.videasy.net/3/{media_type}/{tmdb_id}?append_to_response=external_ids"
    try:
        response = requests.get(metadata_url, timeout=12, headers={"User-Agent": "Mozilla/5.0"})
        response.raise_for_status()
        payload = response.json()
    except (requests.RequestException, ValueError):
        logging.getLogger(__name__).warning("Unable to fetch Videasy metadata for %s %s", media_type, tmdb_id)
        return None

    if media_type == "movie":
        title = str(payload.get("title") or "").strip()
        year = str(payload.get("release_date") or "")[:4]
    else:
        title = str(payload.get("name") or "").strip()
        year = str(payload.get("first_air_date") or "")[:4]

    if not title:
        return None

    imdb_id = str(((payload.get("external_ids") or {}).get("imdb_id")) or "").strip()
    return {
        "title": title,
        "year": year,
        "imdbId": imdb_id,
    }


def _vidking_has_primary_sources(media_type: str, tmdb_id: str, season_id: Optional[str] = None, episode_id: Optional[str] = None) -> bool:
    return True  # source pre-check disabled
    # Original code below (disabled):
    #    cached = _read_vidking_source_cache(media_type, tmdb_id, season_id, episode_id)
    if cached is not None:
        return cached

    metadata = _fetch_videasy_metadata(media_type, tmdb_id)
    if not metadata:
        return True

    params = {
        "title": metadata["title"],
        "mediaType": media_type,
        "year": metadata["year"],
        "tmdbId": str(tmdb_id),
        "imdbId": metadata["imdbId"],
        "_t": str(_now_ms()),
    }
    if media_type == "tv":
        params["seasonId"] = str(season_id or "1")
        params["episodeId"] = str(episode_id or "1")

    for _, endpoint in VIDKING_PRIMARY_SOURCE_ENDPOINTS:
        try:
            response = requests.get(
                f"https://api.videasy.net/{endpoint}",
                params=params,
                timeout=12,
                headers={
                    "User-Agent": "Mozilla/5.0",
                    "Cache-Control": "no-cache, no-store, must-revalidate",
                    "Pragma": "no-cache",
                    "Expires": "0",
                },
            )
        except requests.RequestException:
            logging.getLogger(__name__).warning(
                "Videasy source preflight failed for %s %s via %s",
                media_type,
                tmdb_id,
                endpoint,
            )
            continue

        body = (response.text or "").strip()
        if response.ok and body and not body.startswith("{"):
            _write_vidking_source_cache(media_type, tmdb_id, season_id, episode_id, True)
            return True

    _write_vidking_source_cache(media_type, tmdb_id, season_id, episode_id, False)
    return False


def _maybe_fallback_vidking_embed(safe_path: str) -> Optional[Response]:
    return None  # fallback disabled — always try VidKing directly
    # Original code below (disabled):
    #    movie_match = re.fullmatch(r"embed/movie/([^/?#]+)", safe_path)
    if movie_match:
        tmdb_id = movie_match.group(1)
        if not _vidking_has_primary_sources("movie", tmdb_id):
            return _provider_error_response("VidKing returned no sources for this movie. Trying another provider...")
        return None

    tv_match = re.fullmatch(r"embed/tv/([^/?#]+)/([^/?#]+)/([^/?#]+)", safe_path)
    if not tv_match:
        return None

    tmdb_id, season_id, episode_id = tv_match.groups()
    if _vidking_has_primary_sources("tv", tmdb_id, season_id, episode_id):
        return None

    return _provider_error_response("VidKing returned no sources for this episode. Trying another provider...")


def _rewrite_media_manifest(manifest_text: str, upstream_url: str, ref_url: Optional[str] = None) -> str:
    lines: List[str] = []
    for raw_line in manifest_text.splitlines():
        line = raw_line.strip()
        if not line:
            lines.append(raw_line)
            continue
        if raw_line.startswith("#"):
            rewritten_line = re.sub(
                r'URI="([^"]+)"',
                lambda match: f'URI="{_proxy_media_url(urljoin(upstream_url, match.group(1)), ref_url)}"',
                raw_line,
            )
            lines.append(rewritten_line)
            continue
        absolute_url = urljoin(upstream_url, line)
        lines.append(_proxy_media_url(absolute_url, ref_url))
    return "\n".join(lines)


def _media_headers_for(target_url: str, ref_url: Optional[str] = None) -> Dict[str, str]:
    parsed = urlparse(target_url)
    origin = f"{parsed.scheme}://{parsed.netloc}"
    safe_ref = _sanitize_proxy_referrer(ref_url)
    ref_origin = origin
    referer = origin + "/"
    if safe_ref:
        parsed_ref = urlparse(safe_ref)
        ref_origin = f"{parsed_ref.scheme}://{parsed_ref.netloc}"
        referer = safe_ref
    headers = {
        "User-Agent": request.headers.get("User-Agent") or "Mozilla/5.0",
        "Accept": request.headers.get("Accept") or "*/*",
        "Accept-Language": request.headers.get("Accept-Language") or "en-US,en;q=0.9",
        "Referer": referer,
        "Origin": ref_origin,
        "Sec-Fetch-Site": "cross-site" if safe_ref and ref_origin != origin else "same-site",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
    }
    range_header = request.headers.get("Range")
    if range_header:
        headers["Range"] = range_header
    return headers


def _copy_upstream_headers(response: Response, upstream: requests.Response) -> None:
    for header_name in ("Content-Type", "Content-Length", "Content-Range", "Accept-Ranges", "Last-Modified", "ETag"):
        header_value = upstream.headers.get(header_name)
        if header_value:
            response.headers[header_name] = header_value
    response.headers["Cache-Control"] = "no-store"


def _proxy_media_request(target_url: str) -> Response:
    if not _is_public_media_target(target_url):
        return _json_response({"error": "invalid_media_url"}, status=400)
    ref_url = _request_media_referrer()

    try:
        # Use curl_cffi (Chrome impersonation), NOT plain requests: VidKing's stream
        # CDNs (Cloudflare-fronted moon.iron*.net) TLS-fingerprint the client, and
        # the stream token is minted under the curl_cffi fingerprint during source
        # resolution — fetching the segment with plain requests mismatches → 403.
        upstream = _browserlike_get(
            target_url,
            headers=_media_headers_for(target_url, ref_url),
            timeout=30,
            allow_redirects=True,
        )
    except Exception as exc:
        logging.getLogger(__name__).exception("Media proxy request failed: %s", target_url)
        return _json_response(
            {"error": "upstream_media_error", "detail": str(exc)},
            status=502,
        )

    content_type = (upstream.headers.get("Content-Type") or "").lower()
    is_manifest = target_url.lower().endswith(".m3u8") or "mpegurl" in content_type

    if is_manifest:
        manifest_text = upstream.text
        rewritten = _rewrite_media_manifest(manifest_text, upstream.url, ref_url)
        response = Response(rewritten, status=upstream.status_code, mimetype=upstream.headers.get("Content-Type") or "application/vnd.apple.mpegurl")
        response.headers["Cache-Control"] = "no-store"
        return response

    # Segments/keys/subtitles: curl_cffi streaming doesn't play well with Flask's
    # stream_with_context, so return the full body (HLS segments are ~1-5MB).
    response = Response(upstream.content, status=upstream.status_code)
    _copy_upstream_headers(response, upstream)
    return response


def _proxy_vidking_path(upstream_path: str) -> Response:
    safe_path = upstream_path.lstrip("/")
    fallback_response = _maybe_fallback_vidking_embed(safe_path)
    if fallback_response is not None:
        return fallback_response
    upstream_url = urljoin(f"{VIDKING_ORIGIN}/", safe_path)
    upstream_page_url = upstream_url
    if request.query_string:
        upstream_page_url += "?" + request.query_string.decode("utf-8", errors="ignore")
    try:
        upstream = requests.get(
            upstream_url,
            headers=_vidking_headers(),
            params=request.args.to_dict(flat=True),
            timeout=20,
        )
    except requests.RequestException as exc:
        logging.getLogger(__name__).exception("VidKing request failed: %s", upstream_path)
        return _json_response(
            {"error": "upstream_vidking_error", "detail": str(exc)},
            status=502,
        )

    content_type = upstream.headers.get("Content-Type") or "application/octet-stream"
    if upstream.status_code >= 400:
        return _provider_error_response(
            f"VidKing returned HTTP {upstream.status_code}. Trying another provider...",
            status=upstream.status_code,
        )

    response = Response(status=upstream.status_code)
    response.headers["Content-Type"] = content_type
    response.headers["Cache-Control"] = "no-store"

    if "text/html" in content_type:
        response.set_data(_rewrite_vidking_html(upstream.text, upstream_page_url))
        return response

    if "javascript" in content_type or safe_path.endswith(".js"):
        response.set_data(_rewrite_vidking_asset(safe_path, upstream.text))
        return response

    response.set_data(upstream.content)
    return response



@app.get("/ext/videasy_api/<path:api_path>")
def proxy_videasy_api(api_path: str) -> Response:
    """Proxy the (origin-gated) source API server-side with a vidking.net origin.
    Host is passed as `_host` because VidKing rotates it (videasy.to ->
    wingsdatabase -> speedracelight -> ...); defaults to the legacy host."""
    args = request.args.to_dict(flat=True)
    host = (args.pop("_host", "") or "api.videasy.to").strip().lower()
    # SSRF guard: only allow public api.*/db.* hostnames (no IPs, no internal names).
    if not re.fullmatch(r"(api|db)\.[a-z0-9-]+(\.[a-z0-9-]+)+", host):
        host = "api.videasy.to"
    try:
        upstream = _browserlike_get(
            f"https://{host}/{api_path}",
            params=args,
            headers={
                "Origin": "https://www.vidking.net",
                "Referer": "https://www.vidking.net/",
                "Accept": "application/json, text/plain, */*",
                "Cache-Control": "no-cache, no-store, must-revalidate",
                "Pragma": "no-cache",
            },
            # Allow for VidKing's occasionally-slow API, but not so long that a hung
            # server stalls the player (it waits for all servers before starting).
            timeout=(5, 15),
        )
        resp = Response(upstream.content, status=upstream.status_code)
        resp.headers["Access-Control-Allow-Origin"] = "*"
        resp.headers["Content-Type"] = upstream.headers.get("Content-Type", "application/json")
        return resp
    except Exception as exc:
        app.logger.warning("videasy_api proxy error: %s", exc)
        resp = Response(b'{"error":"proxy error"}', status=502)
        resp.headers["Access-Control-Allow-Origin"] = "*"
        resp.headers["Content-Type"] = "application/json"
        return resp

def _proxy_provider_path(provider_key: str, upstream_path: str) -> Response:
    origin = PROVIDER_PROXY_ORIGINS.get(provider_key)
    if not origin:
        return _json_response({"error": "unknown_provider"}, status=404)
    if provider_key == "vidsrc-rip":
        return _provider_error_response("VidSrc Western Europe is parked. Trying another provider...")

    safe_path = upstream_path.lstrip("/")
    upstream_url = urljoin(f"{origin}/", safe_path)
    upstream_page_url = upstream_url
    if request.query_string:
        upstream_page_url += "?" + request.query_string.decode("utf-8", errors="ignore")
    upstream_referrer = _request_provider_referrer() or upstream_page_url

    try:
        upstream = requests.get(
            upstream_url,
            headers=_provider_headers(origin, upstream_referrer),
            params=request.args.to_dict(flat=True),
            timeout=20,
            allow_redirects=True,
        )
    except requests.RequestException as exc:
        logging.getLogger(__name__).exception("Provider request failed: %s %s", provider_key, upstream_path)
        return _provider_error_response(f"{_provider_display_name(provider_key)} did not respond. Trying another provider...", status=502)

    content_type = upstream.headers.get("Content-Type") or "application/octet-stream"
    response = Response(status=upstream.status_code)
    response.headers["Content-Type"] = content_type
    response.headers["Cache-Control"] = "no-store"

    if "text/html" in content_type:
        if _looks_like_provider_landing_page(provider_key, upstream.url, upstream.text):
            return _provider_error_response(f"{_provider_display_name(provider_key)} returned a landing page instead of the player. Trying another provider...")
        response.set_data(_rewrite_provider_html(provider_key, upstream.text, upstream.url))
        return response

    if "javascript" in content_type or safe_path.endswith(".js") or "text/css" in content_type or safe_path.endswith(".css"):
        response.set_data(_rewrite_provider_asset(provider_key, safe_path, upstream.text, content_type.lower()))
        return response

    response.set_data(upstream.content)
    return response


@app.get("/ext/tmdb/trending")
def tmdb_trending() -> Response:
    media = request.args.get("media", "movie")
    page = request.args.get("page", "1")
    return _tmdb_get(f"/trending/{media}/week", {"page": page})


@app.get("/ext/tmdb/search")
def tmdb_search() -> Response:
    media = request.args.get("media", "movie")
    query = request.args.get("query", "")
    page = request.args.get("page", "1")
    return _tmdb_get(
        f"/search/{media}",
        {"query": query, "page": page, "include_adult": "false"},
    )


@app.get("/ext/vidking/<path:upstream_path>")
def vidking_proxy(upstream_path: str) -> Response:
    return _proxy_vidking_path(upstream_path)


@app.get("/ext/provider/<provider_key>/<path:upstream_path>")
def provider_proxy(provider_key: str, upstream_path: str) -> Response:
    return _proxy_provider_path(provider_key, upstream_path)


@app.get("/ext/media")
def media_proxy() -> Response:
    target_url = request.args.get("url", "").strip()
    return _proxy_media_request(target_url)


@app.get("/embed/<path:upstream_path>")
def vidking_embed_proxy(upstream_path: str) -> Response:
    return _proxy_vidking_path(f"embed/{upstream_path}")


@app.get("/api/tmdb/<path:rest>")
def api_tmdb(rest: str) -> Response:
    return _tmdb_get("/" + rest, request.args.to_dict(flat=True))


@app.post("/api/sync/connect")
def sync_connect() -> Response:
    payload = _parse_sync_request()
    sync_key = str(payload.get("syncKey", "")).strip() if payload else ""
    if not _valid_sync_key(sync_key):
        return _json_response({"error": "invalid_sync_key"}, status=400)

    now = _now_ms()
    with _connect_db() as connection:
        row = _read_profile(connection, sync_key)
        if not row:
            return _json_response(
                {
                    "error": "sync_not_found",
                    "detail": "No sync found for that passphrase.",
                },
                status=404,
            )

        connection.execute(
            "UPDATE progress_sync_profiles SET last_seen_at = ? WHERE sync_key = ?",
            (now, sync_key),
        )
        return _json_response(_profile_payload(row))


@app.post("/api/sync/create")
def sync_create() -> Response:
    payload = _parse_sync_request()
    sync_key = str(payload.get("syncKey", "")).strip() if payload else ""
    if not _valid_sync_key(sync_key):
        return _json_response({"error": "invalid_sync_key"}, status=400)

    now = _now_ms()
    with _connect_db() as connection:
        row = _read_profile(connection, sync_key)
        if row:
            return _json_response(
                {
                    "error": "sync_already_exists",
                    "detail": "This passphrase is already in use.",
                },
                status=409,
            )
        _write_profile(
            connection,
            sync_key,
            [],
            [],
            created_at=now,
            updated_at=None,
            last_seen_at=now,
        )
        return _json_response(
            {"history": [], "recent": [], "lastSyncedAt": None},
            status=201,
        )


@app.post("/api/sync/save")
def sync_save() -> Response:
    payload = _parse_sync_request()
    sync_key = str(payload.get("syncKey", "")).strip() if payload else ""
    if not _valid_sync_key(sync_key):
        return _json_response({"error": "invalid_sync_key"}, status=400)

    history_payload = payload.get("history", []) if payload else []
    recent_payload = payload.get("recent", []) if payload else []
    client_history = _prepare_history_entries(history_payload)
    client_recent = _prepare_recent_entries(recent_payload)
    now = _now_ms()

    with _connect_db() as connection:
        row = _read_profile(connection, sync_key)
        if not row:
            return _json_response(
                {
                    "error": "sync_not_found",
                    "detail": "No sync found for that passphrase.",
                },
                status=404,
            )
        server_payload = _profile_payload(row)
        merged_history = _merge_history_entries(server_payload["history"], client_history)
        merged_recent = _merge_recent_entries(server_payload["recent"], client_recent)
        _write_profile(
            connection,
            sync_key,
            merged_history,
            merged_recent,
            created_at=row["created_at"],
            updated_at=now,
            last_seen_at=now,
        )
        return _json_response(
            {
                "history": merged_history,
                "recent": merged_recent,
                "lastSyncedAt": now,
            }
        )


def _json_error_response(error: TheaterError) -> Response:
    payload = {"error": error.error}
    if error.detail:
        payload["detail"] = error.detail
    return _json_response(payload, status=error.status)


def _room_share_url(invite_key: str) -> str:
    base = request.host_url.rstrip("/")
    return f"{base}/theater_join.html?invite={invite_key}&v=20260413c"


@app.post("/api/theater/rooms")
def theater_create_room() -> Response:
    payload = _parse_json_request() or {}
    try:
        # Hosting is open: the client only sends a display name (no sync key), so
        # requiring the admin passphrase here locked everyone out of creating a
        # theatre. Anyone can spin up a room with a host name.
        with _connect_db() as connection:
            result = create_room(connection, display_name=payload.get("displayName"))
    except TheaterError as error:
        return _json_error_response(error)

    result["shareUrl"] = _room_share_url(result["inviteKey"])
    return _json_response(result, status=201)


@app.post("/api/theater/rooms/<room_ref>/join")
def theater_join_room(room_ref: str) -> Response:
    payload = _parse_json_request() or {}
    try:
        # Joining is open too — guests only have the invite key + a display name.
        with _connect_db() as connection:
            result = join_room(
                connection,
                room_ref,
                invite_token=payload.get("inviteToken") or room_ref,
                display_name=payload.get("displayName"),
            )
    except TheaterError as error:
        return _json_error_response(error)

    result["shareUrl"] = _room_share_url(result["inviteKey"])
    return _json_response(result)


@app.get("/api/theater/rooms/<room_ref>/state")
def theater_room_state(room_ref: str) -> Response:
    member_token = request.args.get("memberToken", "")
    try:
        with _connect_db() as connection:
            payload = get_room_state(connection, room_ref, member_token=member_token)
    except TheaterError as error:
        return _json_error_response(error)

    return _json_response(payload)


@app.get("/api/theater/rooms/<room_ref>/events")
def theater_room_events(room_ref: str) -> Response:
    member_token = request.args.get("memberToken", "")
    try:
        after_event_id = int(request.args.get("since", "0"))
    except ValueError:
        after_event_id = 0
    try:
        with _connect_db() as connection:
            list_events(connection, room_ref, member_token=member_token, after_event_id=0)
    except TheaterError as error:
        return _json_error_response(error)

    @stream_with_context
    def generate() -> Iterable[str]:
        nonlocal after_event_id
        keepalive_started = _now_ms()
        while True:
            try:
                with _connect_db() as connection:
                    events = list_events(
                        connection,
                        room_ref,
                        member_token=member_token,
                        after_event_id=after_event_id,
                    )
            except TheaterError as error:
                terminal_event = "room_closed" if error.error == "room_closed" else "room_expired"
                terminal_payload = {
                    "roomRef": room_ref,
                    "error": error.error,
                    "detail": error.detail,
                }
                yield f"event: {terminal_event}\ndata: {json.dumps(terminal_payload)}\n\n"
                break

            if events:
                for event in events:
                    after_event_id = max(after_event_id, int(event["eventId"]))
                    yield (
                        f"id: {event['eventId']}\n"
                        f"event: {event['eventType']}\n"
                        f"data: {json.dumps(event)}\n\n"
                    )
                keepalive_started = _now_ms()
            elif _now_ms() - keepalive_started >= 15000:
                keepalive_started = _now_ms()
                yield "event: ping\ndata: {}\n\n"

            time.sleep(1)

    response = Response(generate(), mimetype="text/event-stream")
    response.headers["Cache-Control"] = "no-cache"
    response.headers["X-Accel-Buffering"] = "no"
    return response


@app.post("/api/theater/rooms/<room_id>/suggestions")
def theater_add_suggestion(room_id: str) -> Response:
    payload = _parse_json_request() or {}
    try:
        with _connect_db() as connection:
            result = add_suggestion(
                connection,
                room_id,
                member_token=str(payload.get("memberToken", "")).strip() or None,
                media=payload.get("media"),
            )
    except TheaterError as error:
        return _json_error_response(error)

    return _json_response(result, status=201)


@app.post("/api/theater/rooms/<room_id>/votes")
def theater_set_vote(room_id: str) -> Response:
    payload = _parse_json_request() or {}
    try:
        with _connect_db() as connection:
            result = set_vote(
                connection,
                room_id,
                member_token=str(payload.get("memberToken", "")).strip() or None,
                suggestion_id=payload.get("suggestionId"),
                active=payload.get("active"),
            )
    except TheaterError as error:
        return _json_error_response(error)

    return _json_response(result)


@app.post("/api/theater/rooms/<room_id>/select")
def theater_select_media(room_id: str) -> Response:
    payload = _parse_json_request() or {}
    try:
        with _connect_db() as connection:
            result = select_media(
                connection,
                room_id,
                host_token=str(payload.get("hostToken", "")).strip() or None,
                suggestion_id=payload.get("suggestionId"),
                media=payload.get("media"),
            )
    except TheaterError as error:
        return _json_error_response(error)

    return _json_response(result)


@app.post("/api/theater/rooms/<room_id>/playback")
def theater_update_playback(room_id: str) -> Response:
    payload = _parse_json_request() or {}
    try:
        with _connect_db() as connection:
            result = update_playback(
                connection,
                room_id,
                host_token=str(payload.get("hostToken", "")).strip() or None,
                playback_payload=payload,
            )
    except TheaterError as error:
        return _json_error_response(error)

    return _json_response(result)


@app.post("/api/theater/rooms/<room_id>/reset")
def theater_reset_screening(room_id: str) -> Response:
    payload = _parse_json_request() or {}
    try:
        with _connect_db() as connection:
            result = reset_screening(
                connection,
                room_id,
                host_token=str(payload.get("hostToken", "")).strip() or None,
            )
    except TheaterError as error:
        return _json_error_response(error)

    return _json_response(result)


@app.post("/api/theater/rooms/<room_id>/presence")
def theater_presence(room_id: str) -> Response:
    payload = _parse_json_request() or {}
    try:
        with _connect_db() as connection:
            result = update_presence(
                connection,
                room_id,
                member_token=str(payload.get("memberToken", "")).strip() or None,
            )
    except TheaterError as error:
        return _json_error_response(error)

    return _json_response(result)


@app.post("/api/theater/rooms/<room_id>/ready")
def theater_ready(room_id: str) -> Response:
    payload = _parse_json_request() or {}
    try:
        with _connect_db() as connection:
            result = report_ready(
                connection,
                room_id,
                member_token=str(payload.get("memberToken", "")).strip() or None,
                command_id=payload.get("commandId"),
                status=payload.get("status"),
                current_time=payload.get("currentTime"),
            )
    except TheaterError as error:
        return _json_error_response(error)

    return _json_response(result)


@app.post("/api/theater/rooms/<room_id>/chat")
def theater_post_chat(room_id: str) -> Response:
    payload = _parse_json_request() or {}
    try:
        with _connect_db() as connection:
            result = post_chat_message(
                connection,
                room_id,
                member_token=str(payload.get("memberToken", "")).strip() or None,
                body=payload.get("body"),
            )
    except TheaterError as error:
        return _json_error_response(error)

    return _json_response(result, status=201)


@app.post("/api/theater/rooms/<room_id>/close")
def theater_close(room_id: str) -> Response:
    payload = _parse_json_request() or {}
    try:
        with _connect_db() as connection:
            result = close_room(
                connection,
                room_id,
                host_token=str(payload.get("hostToken", "")).strip() or None,
                reason=payload.get("reason"),
            )
    except TheaterError as error:
        return _json_error_response(error)

    return _json_response(result)


@app.get("/api/books/search")
def api_books_search() -> Response:
    query = request.args.get("q", "")
    availability = request.args.get("availability", "all")
    page = max(1, _coerce_int(request.args.get("page"), 1) or 1)
    with _connect_db() as connection:
        payload = search_books(
            connection,
            query=query,
            page=page,
            availability=availability,
            google_books_api_key=GOOGLE_BOOKS_API_KEY,
        )
    return _json_response(payload)


@app.get("/api/books/item/<path:book_id>")
def api_books_item(book_id: str) -> Response:
    with _connect_db() as connection:
        payload = get_book_item(connection, book_id, GOOGLE_BOOKS_API_KEY)
    if not payload:
        return _json_response({"error": "book_not_found"}, status=404)
    return _json_response(payload)


@app.get("/api/books/read/<path:book_id>")
def api_books_read(book_id: str) -> Response:
    with _connect_db() as connection:
        payload = get_book_read(connection, book_id, GOOGLE_BOOKS_API_KEY)
    if not payload:
        return _json_response({"error": "book_not_found"}, status=404)
    return _json_response(payload)


@app.get("/api/books/loan/<path:book_id>")
def api_books_loan_status(book_id: str) -> Response:
    with _connect_db() as connection:
        payload = get_book_loan_status(connection, book_id, GOOGLE_BOOKS_API_KEY)
    if not payload:
        return _json_response({"error": "book_not_found"}, status=404)
    return _json_response(payload)


@app.post("/api/books/loan/<path:book_id>")
def api_books_loan_update(book_id: str) -> Response:
    payload = _parse_json_request() or {}
    action = _optional_string(payload.get("action")) or ""
    with _connect_db() as connection:
        result = update_book_loan(connection, book_id, action, GOOGLE_BOOKS_API_KEY)
    if not result:
        return _json_response({"error": "book_not_found"}, status=404)
    status = 200 if result.get("success") else 400
    return _json_response(result, status=status)


@app.get("/api/books/pages/<path:book_id>")
def api_books_pages(book_id: str) -> Response:
    start = max(0, _coerce_int(request.args.get("start"), 0) or 0)
    end = max(start, _coerce_int(request.args.get("end"), start) or start)
    width = max(0, _coerce_int(request.args.get("width"), 0) or 0)
    with _connect_db() as connection:
        payload = get_book_pages(
            connection,
            book_id,
            start=start,
            end=end,
            width=width,
            google_books_api_key=GOOGLE_BOOKS_API_KEY,
        )
    if not payload:
        return _json_response({"error": "book_pages_not_found"}, status=404)
    return _json_response(payload)


@app.get("/api/books/content/<path:book_id>")
def api_books_content(book_id: str) -> Response:
    format_name = request.args.get("format", "")
    if not format_name:
        return _json_response({"error": "missing_format"}, status=400)
    try:
        with _connect_db() as connection:
            upstream = fetch_book_asset(connection, book_id, format_name, GOOGLE_BOOKS_API_KEY)
    except requests.RequestException as exc:
        logging.getLogger(__name__).warning("Book asset fetch failed for %s: %s", book_id, exc)
        return _json_response({"error": "book_asset_unavailable", "detail": str(exc)}, status=502)
    if not upstream:
        return _json_response({"error": "book_asset_not_found"}, status=404)

    response = Response(upstream.content, status=upstream.status_code)
    response.headers["Content-Type"] = upstream.headers.get("Content-Type") or "application/octet-stream"
    return response


@app.get("/api/books/page-image/<path:book_id>")
def api_books_page_image(book_id: str) -> Response:
    page_index = max(0, _coerce_int(request.args.get("page"), 0) or 0)
    width = max(0, _coerce_int(request.args.get("width"), 0) or 0)
    try:
        with _connect_db() as connection:
            upstream = fetch_book_page_image(
                connection,
                book_id,
                page_index=page_index,
                width=width,
                google_books_api_key=GOOGLE_BOOKS_API_KEY,
            )
    except requests.RequestException as exc:
        logging.getLogger(__name__).warning("Book page image fetch failed for %s: %s", book_id, exc)
        return _json_response({"error": "book_page_unavailable", "detail": str(exc)}, status=502)
    if not upstream:
        return _json_response({"error": "book_page_not_found"}, status=404)

    response = Response(upstream.content, status=upstream.status_code)
    response.headers["Content-Type"] = upstream.headers.get("Content-Type") or "image/jpeg"
    return response


_init_sync_db()
