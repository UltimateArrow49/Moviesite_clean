import hashlib
import json
import logging
import os
import re
import time
from concurrent.futures import ThreadPoolExecutor, wait
from urllib.parse import quote
import xml.etree.ElementTree as ET
from typing import Any, Dict, Iterable, List, Optional, Tuple

import requests

SEARCH_TTL_MS = 6 * 60 * 60 * 1000
ITEM_TTL_MS = 24 * 60 * 60 * 1000
SCAN_TTL_MS = 24 * 60 * 60 * 1000
LOAN_TTL_MS = 5 * 60 * 1000
ACTIVE_LOAN_TTL_MS = 60 * 60 * 1000
MANAGED_LOAN_WINDOW_MS = 60 * 60 * 1000
STANDARD_EBOOKS_FEED_TTL_MS = 24 * 60 * 60 * 1000
BOOK_PAGE_SIZE = 24
USER_AGENT = "theblackbox-books/1.0"
SEARCH_REQUEST_TIMEOUT = (2.5, 5.5)
FAST_SOURCE_BUDGET_SEC = 6.0
OPTIONAL_SOURCE_BUDGET_SEC = 0.65
SEARCH_CACHE_SCHEMA_VERSION = "v11"
SCAN_IMAGE_WIDTH_MIN = 520
SCAN_IMAGE_WIDTH_MAX = 1800
SCAN_DEFAULT_IMAGE_WIDTH = 1280
IMAGE_MAGIC_PREFIXES = (
    b"\xff\xd8\xff",
    b"\x89PNG\r\n\x1a\n",
    b"GIF87a",
    b"GIF89a",
)
STANDARD_EBOOKS_FEEDS = (
    "https://standardebooks.org/opds/all",
    "https://standardebooks.org/feeds/opds/all",
    "https://standardebooks.org/opds/index.xml",
)
HTML_SANITIZE_PATTERN = re.compile(r"\s+")
AVAILABILITY_RANK = {
    "read": 5,
    "preview": 4,
    "borrow": 3,
    "external": 2,
    "unavailable": 1,
}

_standard_ebooks_cache: Dict[str, Any] = {
    "fetched_at": 0,
    "entries": [],
}


def _perform_request(
    requester: Any,
    method: str,
    url: str,
    *,
    timeout: Tuple[float, float],
    attempts: int = 2,
    retry_delay: float = 0.6,
    **kwargs: Any,
) -> requests.Response:
    last_error: Optional[Exception] = None
    total_attempts = max(1, int(attempts or 1))
    for attempt in range(total_attempts):
        try:
            return requester.request(method, url, timeout=timeout, **kwargs)
        except (requests.Timeout, requests.ConnectionError) as error:
            last_error = error
            if attempt >= total_attempts - 1:
                raise
            time.sleep(retry_delay * (attempt + 1))
    if last_error:
        raise last_error
    raise RuntimeError(f"Unable to complete request for {url}")


def _now_ms() -> int:
    return int(time.time() * 1000)


def ensure_books_tables(connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS book_search_cache (
            cache_key TEXT PRIMARY KEY,
            payload_json TEXT NOT NULL,
            raw_json TEXT,
            fetched_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS book_item_cache (
            book_id TEXT PRIMARY KEY,
            payload_json TEXT NOT NULL,
            raw_json TEXT,
            fetched_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS book_scan_cache (
            archive_id TEXT PRIMARY KEY,
            payload_json TEXT NOT NULL,
            raw_json TEXT,
            fetched_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS book_loan_cache (
            book_id TEXT PRIMARY KEY,
            payload_json TEXT NOT NULL,
            raw_json TEXT,
            fetched_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
        )
        """
    )


def _request_json(
    url: str,
    *,
    params: Optional[Dict[str, Any]] = None,
    timeout: Tuple[float, float] = (8, 30),
    session: Optional[requests.Session] = None,
    attempts: int = 2,
) -> Any:
    requester = session or requests
    response = _perform_request(
        requester,
        "GET",
        url,
        params=params,
        timeout=timeout,
        attempts=attempts,
        headers={"Accept": "application/json, application/xml;q=0.9, */*;q=0.8", "User-Agent": USER_AGENT},
    )
    response.raise_for_status()
    return response.json()


def _request_text(
    url: str,
    *,
    params: Optional[Dict[str, Any]] = None,
    timeout: Tuple[float, float] = (8, 30),
    session: Optional[requests.Session] = None,
    attempts: int = 2,
) -> str:
    requester = session or requests
    response = _perform_request(
        requester,
        "GET",
        url,
        params=params,
        timeout=timeout,
        attempts=attempts,
        headers={"Accept": "application/atom+xml, application/xml, text/xml, text/html, */*;q=0.8", "User-Agent": USER_AGENT},
    )
    response.raise_for_status()
    return response.text


def _request_binary(
    url: str,
    *,
    timeout: Tuple[float, float] = (10, 60),
    session: Optional[requests.Session] = None,
    stream: bool = False,
    attempts: int = 2,
) -> requests.Response:
    requester = session or requests
    response = _perform_request(
        requester,
        "GET",
        url,
        timeout=timeout,
        attempts=attempts,
        headers={"User-Agent": USER_AGENT},
        stream=stream,
    )
    response.raise_for_status()
    return response


def _cache_read(connection, table: str, key_column: str, key_value: str) -> Optional[Dict[str, Any]]:
    row = connection.execute(
        f"SELECT payload_json, raw_json, expires_at FROM {table} WHERE {key_column} = ?",
        (key_value,),
    ).fetchone()
    if not row:
        return None
    if int(row["expires_at"] or 0) < _now_ms():
        return None
    return {
        "payload": json.loads(row["payload_json"]),
        "raw": json.loads(row["raw_json"]) if row["raw_json"] else None,
    }


def _cache_write(connection, table: str, key_column: str, key_value: str, payload: Dict[str, Any], raw: Any, ttl_ms: int) -> None:
    now = _now_ms()
    connection.execute(
        f"""
        INSERT INTO {table} ({key_column}, payload_json, raw_json, fetched_at, expires_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT({key_column}) DO UPDATE SET
            payload_json = excluded.payload_json,
            raw_json = excluded.raw_json,
            fetched_at = excluded.fetched_at,
            expires_at = excluded.expires_at
        """,
        (
            key_value,
            json.dumps(payload, separators=(",", ":")),
            json.dumps(raw, separators=(",", ":")) if raw is not None else None,
            now,
            now + ttl_ms,
        ),
    )


def _normalize_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        joined = " ".join(_normalize_text(item) for item in value)
        return HTML_SANITIZE_PATTERN.sub(" ", joined).strip()
    cleaned = HTML_SANITIZE_PATTERN.sub(" ", str(value)).strip()
    return cleaned


def _safe_https(url: Optional[str]) -> Optional[str]:
    if not isinstance(url, str) or not url.strip():
        return None
    return url.replace("http://", "https://")


def _archive_session_from_env() -> Optional[requests.Session]:
    cookie_header = os.environ.get("ARCHIVE_ORG_COOKIE_HEADER") or os.environ.get("ARCHIVE_ORG_COOKIE")
    cookie_json = os.environ.get("ARCHIVE_ORG_COOKIE_JSON")
    if not cookie_header and not cookie_json:
        return None

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})

    if cookie_header:
        for chunk in cookie_header.split(";"):
            name, separator, value = chunk.strip().partition("=")
            if not separator or not name or not value:
                continue
            session.cookies.set(name.strip(), value.strip(), domain=".archive.org")

    if cookie_json:
        try:
            payload = json.loads(cookie_json)
        except json.JSONDecodeError:
            payload = []
        for cookie in payload if isinstance(payload, list) else []:
            if not isinstance(cookie, dict):
                continue
            name = _normalize_text(cookie.get("name"))
            value = _normalize_text(cookie.get("value"))
            if not name or not value:
                continue
            session.cookies.set(
                name,
                value,
                domain=_normalize_text(cookie.get("domain")) or ".archive.org",
                path=_normalize_text(cookie.get("path")) or "/",
            )

    return session if session.cookies else None


def _probe_binary_access(
    url: Optional[str],
    *,
    session: Optional[requests.Session],
    timeout: Tuple[int, int] = (3, 8),
) -> bool:
    safe_url = _safe_https(url)
    if not safe_url or session is None:
        return False
    response = None
    try:
        response = _request_binary(safe_url, timeout=timeout, session=session, stream=True)
        final_url = (response.url or "").lower()
        if "/login" in final_url and "archive.org" in final_url:
            return False
        return True
    except requests.RequestException:
        return False
    finally:
        if response is not None:
            response.close()


def _looks_like_browser_image(sample: bytes) -> bool:
    if not sample:
        return False
    if any(sample.startswith(prefix) for prefix in IMAGE_MAGIC_PREFIXES):
        return True
    return len(sample) >= 12 and sample.startswith(b"RIFF") and sample[8:12] == b"WEBP"


def _probe_scan_image_source(
    url: Optional[str],
    *,
    session: Optional[requests.Session],
    timeout: Tuple[int, int] = (4, 12),
) -> bool:
    safe_url = _safe_https(url)
    if not safe_url:
        return False
    response = None
    try:
        response = _request_binary(safe_url, timeout=timeout, session=session, stream=True)
        final_url = (response.url or "").lower()
        if "/login" in final_url and "archive.org" in final_url:
            return False
        content_type = (response.headers.get("Content-Type") or "").casefold()
        if content_type and not content_type.startswith("image/"):
            return False
        sample = next(response.iter_content(64), b"")
        return _looks_like_browser_image(sample)
    except requests.RequestException:
        return False
    finally:
        if response is not None:
            response.close()


def _archive_whoami(session: requests.Session) -> Optional[Dict[str, Any]]:
    try:
        response = _perform_request(
            session,
            "GET",
            "https://archive.org/services/user.php?op=whoami",
            timeout=(6, 15),
            attempts=2,
            headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
        )
    except requests.RequestException:
        return None
    if response.status_code != 200:
        return None
    try:
        payload = response.json()
    except ValueError:
        return None
    if not payload.get("success"):
        return None
    return payload


def _archive_login_session() -> Tuple[Optional[requests.Session], Optional[str]]:
    session = _archive_session_from_env()
    if session is not None and _archive_whoami(session):
        return session, None

    username = _normalize_text(os.environ.get("ARCHIVE_ORG_USERNAME"))
    password = os.environ.get("ARCHIVE_ORG_PASSWORD") or ""
    if not username or not password:
        return None, "Archive lender credentials are not configured on the server."

    session = requests.Session()
    session.headers.update({"User-Agent": USER_AGENT})
    try:
        token_payload = _request_json(
            "https://archive.org/services/account/login/",
            timeout=(8, 25),
            session=session,
            attempts=3,
        )
        csrf_token = ((token_payload or {}).get("value") or {}).get("token")
        if not csrf_token:
            return None, "Archive login token could not be requested."
        response = _perform_request(
            session,
            "POST",
            "https://archive.org/services/account/login/",
            timeout=(8, 25),
            attempts=2,
            json={
                "username": username,
                "password": password,
                "remember": "true",
                "t": csrf_token,
            },
            headers={"User-Agent": USER_AGENT, "Content-Type": "application/json", "Accept": "application/json"},
        )
        payload = response.json()
    except (requests.RequestException, ValueError) as error:
        logging.getLogger(__name__).warning("Archive login failed: %s", error)
        return None, "Archive login failed. Please refresh the lender session on the server."

    if not payload.get("success"):
        return None, _normalize_text(payload.get("error")) or "Archive rejected the lender credentials."
    if not _archive_whoami(session):
        return None, "Archive login did not produce a readable lender session."
    return session, None


def _extract_loan_status(payload: Any, archive_id: Optional[str], *, borrowed_by_server: bool = False) -> Dict[str, Any]:
    data = payload if isinstance(payload, dict) else {}
    loan = data.get("loan") if isinstance(data.get("loan"), dict) else {}
    value = data.get("value") if isinstance(data.get("value"), dict) else {}
    status_source = loan or value or data

    seconds_left = None
    for key in ("secondsLeftOnLoan", "seconds_left_on_loan", "seconds_left"):
        value = status_source.get(key)
        if value is not None:
            try:
                seconds_left = max(0, int(value))
                break
            except (TypeError, ValueError):
                pass

    days_left = None
    for key in ("daysLeftOnLoan", "days_left_on_loan", "days_left"):
        value = status_source.get(key)
        if value is not None:
            try:
                days_left = max(0, int(value))
                break
            except (TypeError, ValueError):
                pass

    now = _now_ms()
    due_at = None
    if seconds_left is not None:
        due_at = now + (seconds_left * 1000)
    elif days_left is not None:
        due_at = now + (days_left * 24 * 60 * 60 * 1000)

    active = bool(data.get("success"))
    action = _normalize_text(data.get("action")).casefold()
    if action == "return_loan":
        active = False
    if action in {"borrow_book", "create_token", "browse_book", "renew_loan"}:
        active = True
    if seconds_left or days_left:
        active = True

    message = _normalize_text(data.get("message")) or _normalize_text(data.get("error"))
    status = {
        "active": active,
        "provider": "archive.org",
        "archiveId": archive_id,
        "borrowedByServer": borrowed_by_server,
    }
    if seconds_left is not None:
        status["secondsLeft"] = seconds_left
    if days_left is not None:
        status["daysLeft"] = days_left
    if due_at is not None:
        status["dueAt"] = due_at
    if message:
        status["message"] = message
    return status


def _loan_cache_payload(status: Dict[str, Any], *, scan_manifest: Optional[Dict[str, Any]] = None, download_urls: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    payload: Dict[str, Any] = {"loanStatus": status}
    if scan_manifest:
        payload["scanManifest"] = _sanitize_scan_manifest(scan_manifest)
    if download_urls:
        payload["downloadUrls"] = download_urls
    return payload


def _with_loan_renderability(
    status: Dict[str, Any],
    *,
    renderable: bool = False,
    render_mode: Optional[str] = None,
    preparing: bool = False,
    reason: Optional[str] = None,
) -> Dict[str, Any]:
    payload = dict(status)
    payload["renderable"] = bool(renderable)
    payload["preparing"] = bool(preparing)
    if render_mode:
        payload["renderMode"] = render_mode
    elif "renderMode" in payload and not renderable:
        payload.pop("renderMode", None)
    if reason:
        payload["reason"] = reason
    elif "reason" in payload and not preparing and renderable:
        payload.pop("reason", None)
    return payload


def _apply_managed_loan_window(status: Dict[str, Any]) -> Dict[str, Any]:
    if not status.get("active"):
        return status
    if status.get("dueAt"):
        return status
    status = dict(status)
    due_at = _now_ms() + MANAGED_LOAN_WINDOW_MS
    status["dueAt"] = due_at
    status["secondsLeft"] = int(MANAGED_LOAN_WINDOW_MS / 1000)
    status["estimated"] = True
    if status.get("message"):
        status["message"] = f"{status['message']} Browser loans are managed as a one-hour reading window."
    else:
        status["message"] = "Browser loans are managed as a one-hour reading window."
    return status


def _perform_loan_action(session: requests.Session, archive_id: str, action: str) -> Dict[str, Any]:
    response = _perform_request(
        session,
        "POST",
        "https://archive.org/services/loans/loan",
        timeout=(8, 25),
        attempts=2,
        data={"action": action, "identifier": archive_id},
        headers={"User-Agent": USER_AGENT, "Accept": "application/json"},
    )
    try:
        payload = response.json()
    except ValueError:
        payload = {"success": False, "error": response.text[:300]}
    payload.setdefault("statusCode", response.status_code)
    payload["action"] = action
    return payload


def _coerce_positive_int(value: Any, default: int = 0) -> int:
    try:
        return max(0, int(value))
    except (TypeError, ValueError):
        return default


def _unique_list(values: Iterable[Any]) -> List[str]:
    seen = set()
    output: List[str] = []
    for value in values:
        cleaned = _normalize_text(value)
        if not cleaned:
            continue
        key = cleaned.casefold()
        if key in seen:
            continue
        seen.add(key)
        output.append(cleaned)
    return output


def _cover_from_openlibrary(cover_id: Any) -> Optional[str]:
    if cover_id is None:
        return None
    return f"https://covers.openlibrary.org/b/id/{cover_id}-L.jpg"


def _archive_details_url(identifier: Optional[str]) -> Optional[str]:
    safe_identifier = _normalize_text(identifier)
    if not safe_identifier:
        return None
    return f"https://archive.org/details/{quote(safe_identifier)}"


def _archive_read_url(identifier: Optional[str]) -> Optional[str]:
    details_url = _archive_details_url(identifier)
    if not details_url:
        return None
    return f"{details_url}/mode/2up"


def _archive_embed_url(identifier: Optional[str]) -> Optional[str]:
    details_url = _archive_details_url(identifier)
    if not details_url:
        return None
    return f"{details_url}?view=theater&ui=embed&wrapper=false"


def _identifier_union(base: Dict[str, List[str]], extra: Dict[str, List[str]]) -> Dict[str, List[str]]:
    merged = {key: list(values) for key, values in base.items()}
    for key, values in extra.items():
        existing = merged.setdefault(key, [])
        for value in values:
            if value and value not in existing:
                existing.append(value)
    return merged


def _canonical_title_author(title: str, authors: List[str]) -> str:
    author = authors[0] if authors else ""
    return f"{re.sub(r'[^a-z0-9]+', '', title.casefold())}|{re.sub(r'[^a-z0-9]+', '', author.casefold())}"


def _dedupe_keys(record: Dict[str, Any]) -> List[str]:
    keys: List[str] = []
    identifiers = record.get("identifiers") or {}
    for isbn in identifiers.get("isbn13", []) + identifiers.get("isbn10", []):
        keys.append(f"isbn:{isbn}")
    for value in identifiers.get("openlibrary", []):
        keys.append(f"ol:{value}")
    for value in identifiers.get("gutenberg", []):
        keys.append(f"gutenberg:{value}")
    keys.append(f"titleauthor:{_canonical_title_author(record.get('title', ''), record.get('authors', []))}")
    return [key for key in keys if key]


def _availability_score(value: str) -> int:
    return AVAILABILITY_RANK.get(value, 0)


def _candidate_score(record: Dict[str, Any]) -> Tuple[int, int, int, int]:
    identifiers = record.get("identifiers") or {}
    identifier_count = sum(len(values) for values in identifiers.values())
    return (
        _availability_score(record.get("availability", "unavailable")),
        len(record.get("description") or ""),
        1 if record.get("coverUrl") else 0,
        identifier_count,
    )


def _choose_primary(records: List[Dict[str, Any]]) -> Dict[str, Any]:
    ordered = sorted(records, key=_candidate_score, reverse=True)
    return ordered[0]


def _merge_records(records: List[Dict[str, Any]]) -> Dict[str, Any]:
    primary = _choose_primary(records)
    merged = {key: value for key, value in primary.items() if key != "_raw_sources"}
    merged["authors"] = _unique_list(author for record in records for author in record.get("authors", []))
    merged["subjects"] = _unique_list(subject for record in records for subject in record.get("subjects", []))
    merged["coverFallbacks"] = _unique_list(
        url
        for record in records
        for url in ([record.get("coverUrl")] + list(record.get("coverFallbacks") or []))
    )
    if not merged.get("coverUrl") and merged["coverFallbacks"]:
        merged["coverUrl"] = merged["coverFallbacks"][0]

    descriptions = sorted(
        (_normalize_text(record.get("description")) for record in records),
        key=len,
        reverse=True,
    )
    if descriptions and descriptions[0]:
        merged["description"] = descriptions[0]

    identifiers: Dict[str, List[str]] = {}
    for record in records:
        identifiers = _identifier_union(identifiers, record.get("identifiers") or {})
    merged["identifiers"] = identifiers

    actions: List[Dict[str, Any]] = []
    seen_actions = set()
    for record in records:
        for action in record.get("actions") or []:
            key = (action.get("kind"), action.get("url"), action.get("label"))
            if key in seen_actions:
                continue
            seen_actions.add(key)
            actions.append(action)
    merged["actions"] = actions

    downloads: Dict[str, str] = {}
    for record in records:
        for fmt, url in (record.get("downloadUrls") or {}).items():
            downloads.setdefault(fmt, url)
    merged["downloadUrls"] = downloads

    if not merged.get("pageCount"):
        for record in records:
            if record.get("pageCount"):
                merged["pageCount"] = record["pageCount"]
                break

    if not merged.get("publishedYear"):
        for record in records:
            if record.get("publishedYear"):
                merged["publishedYear"] = record["publishedYear"]
                break

    if not merged.get("readerUrl"):
        for record in records:
            if record.get("readerUrl"):
                merged["readerUrl"] = record["readerUrl"]
                merged["readerType"] = record.get("readerType")
                break

    merged["_raw_sources"] = [record.get("_raw_source") for record in records if record.get("_raw_source")]
    return merged


def _public_record(record: Dict[str, Any]) -> Dict[str, Any]:
    payload = {key: value for key, value in record.items() if not key.startswith("_")}
    payload.setdefault("authors", [])
    payload.setdefault("subjects", [])
    payload.setdefault("coverFallbacks", [])
    payload.setdefault("actions", [])
    payload.setdefault("downloadUrls", {})
    payload.setdefault("identifiers", {})
    payload.setdefault("availability", "unavailable")
    payload.setdefault("sourceLabel", payload.get("source", "").title())
    return payload


def _query_tokens(value: str) -> List[str]:
    return re.findall(r"[a-z0-9]+", _normalize_text(value).casefold())


def _query_score(record: Dict[str, Any], query: str) -> int:
    normalized_query = " ".join(_query_tokens(query))
    if not normalized_query:
        return 0

    query_tokens = normalized_query.split()
    title_tokens = _query_tokens(record.get("title") or "")
    title = " ".join(title_tokens)
    author_tokens = [_query_tokens(author) for author in record.get("authors") or []]
    subject_tokens = [_query_tokens(subject) for subject in record.get("subjects") or []]
    description_tokens = _query_tokens(record.get("description") or "")

    if title == normalized_query:
        return 8
    if title.startswith(f"{normalized_query} "):
        return 7
    if len(query_tokens) == 1 and query_tokens[0] in title_tokens:
        return 6
    if any(" ".join(author) == normalized_query for author in author_tokens):
        return 5
    if len(query_tokens) == 1 and any(query_tokens[0] in author for author in author_tokens):
        return 4
    if len(query_tokens) == 1 and any(query_tokens[0] in subject for subject in subject_tokens):
        return 3
    if len(query_tokens) == 1 and query_tokens[0] in description_tokens:
        return 2
    return 0


def _rank_records(records: List[Dict[str, Any]], query: str = "") -> List[Dict[str, Any]]:
    def rank_key(record: Dict[str, Any]) -> Tuple[int, int, int]:
        return (
            _query_score(record, query),
            _availability_score(record.get("availability", "unavailable")),
            len(record.get("description") or ""),
            1 if record.get("coverUrl") else 0,
        )

    return sorted(records, key=rank_key, reverse=True)


def _filter_availability(records: List[Dict[str, Any]], availability: Optional[str]) -> List[Dict[str, Any]]:
    if not availability or availability == "all":
        return records
    return [record for record in records if record.get("availability") == availability]


def _gutendex_downloads(formats: Dict[str, str]) -> Tuple[Dict[str, str], Optional[str], Optional[str]]:
    downloads: Dict[str, str] = {}
    html_url = formats.get("text/html") or formats.get("text/html; charset=utf-8")
    epub_url = formats.get("application/epub+zip")
    pdf_url = formats.get("application/pdf")
    text_url = formats.get("text/plain; charset=utf-8") or formats.get("text/plain")
    if epub_url:
        downloads["epub"] = epub_url
    if html_url:
        downloads["html"] = html_url
    if text_url:
        downloads["text"] = text_url
    if pdf_url:
        downloads["pdf"] = pdf_url

    if epub_url:
        return downloads, "epub", epub_url
    if html_url:
        return downloads, "html", html_url
    if text_url:
        return downloads, "text", text_url
    if pdf_url:
        return downloads, "pdf", pdf_url
    return downloads, None, None


def _normalize_gutendex(result: Dict[str, Any]) -> Dict[str, Any]:
    formats = result.get("formats") or {}
    downloads, reader_type, reader_url = _gutendex_downloads(formats)
    gutenberg_id = str(result.get("id"))
    cover = _safe_https(formats.get("image/jpeg"))
    availability = "read" if reader_type else "unavailable"
    return {
        "id": f"gutendex:{gutenberg_id}",
        "title": _normalize_text(result.get("title")),
        "authors": _unique_list(author.get("name") for author in result.get("authors") or []),
        "description": _normalize_text((result.get("summaries") or [""])[0]),
        "coverUrl": cover,
        "coverFallbacks": [cover] if cover else [],
        "subjects": _unique_list((result.get("subjects") or []) + (result.get("bookshelves") or [])),
        "language": _normalize_text((result.get("languages") or [""])[0]),
        "publishedYear": None,
        "pageCount": None,
        "source": "gutendex",
        "sourceLabel": "Project Gutenberg",
        "availability": availability,
        "actions": [{"label": "Read", "kind": "read", "url": reader_url}] if reader_url else [],
        "readerType": reader_type,
        "readerUrl": _safe_https(reader_url),
        "downloadUrls": {key: _safe_https(url) for key, url in downloads.items() if url},
        "identifiers": {"gutenberg": [gutenberg_id]},
        "_raw_source": {"source": "gutendex", "payload": result},
    }


def _archive_downloads(
    identifier: str,
    *,
    session: Optional[requests.Session] = None,
) -> Tuple[Dict[str, str], Optional[str], Optional[str]]:
    if not identifier:
        return {}, None, None

    payload = _request_json(f"https://archive.org/metadata/{identifier}", timeout=(3, 6), session=session)
    files = payload.get("files") or []
    downloads: Dict[str, str] = {}

    for entry in files:
        name = _normalize_text(entry.get("name"))
        if not name:
            continue
        lowered_name = name.casefold()
        fmt = _normalize_text(entry.get("format")).casefold()
        if ".lcp" in lowered_name or "lcp" in fmt:
            continue
        url = f"https://archive.org/download/{identifier}/{quote(name)}"

        if "epub" not in downloads and (lowered_name.endswith(".epub") or "epub" in fmt):
            downloads["epub"] = url
        elif "pdf" not in downloads and (lowered_name.endswith(".pdf") or "pdf" in fmt):
            downloads["pdf"] = url
        elif "html" not in downloads and lowered_name.endswith((".html", ".htm")):
            downloads["html"] = url
        elif "text" not in downloads and (
            lowered_name.endswith((".txt", "_djvu.txt")) or "djvutxt" in fmt or fmt == "text"
        ):
            downloads["text"] = url

    for candidate in ("epub", "html", "text", "pdf"):
        if downloads.get(candidate):
            return downloads, candidate, downloads[candidate]
    return downloads, None, None


def _iiif_label_text(label: Any) -> str:
    if isinstance(label, dict):
        for key in ("none", "en"):
            values = label.get(key)
            if isinstance(values, list) and values:
                return _normalize_text(values[0])
    return _normalize_text(label)


def _iiif_image_url(service_url: Optional[str], width: Optional[int] = None) -> Optional[str]:
    base = _safe_https(service_url)
    if not base:
        return None
    if not width:
        return f"{base}/full/{SCAN_DEFAULT_IMAGE_WIDTH},/0/default.jpg"
    clamped_width = max(SCAN_IMAGE_WIDTH_MIN, min(SCAN_IMAGE_WIDTH_MAX, int(width)))
    return f"{base}/full/{clamped_width},/0/default.jpg"


def _normalize_scan_canvas(canvas: Dict[str, Any], index: int) -> Optional[Dict[str, Any]]:
    if not isinstance(canvas, dict):
        return None
    canvas_items = canvas.get("items") or []
    if not canvas_items or not isinstance(canvas_items[0], dict):
        return None
    annotations = canvas_items[0].get("items") or []
    if not annotations or not isinstance(annotations[0], dict):
        return None
    body = annotations[0].get("body") or {}
    if not isinstance(body, dict):
        return None
    services = body.get("service") or []
    service_url = None
    if isinstance(services, list):
        for service in services:
            if isinstance(service, dict) and service.get("id"):
                service_url = _safe_https(service.get("id"))
                break
    direct_url = _safe_https(body.get("id"))
    width = _coerce_positive_int(canvas.get("width"))
    height = _coerce_positive_int(canvas.get("height"))
    if not (service_url or direct_url) or not width or not height:
        return None
    return {
        "index": index,
        "label": _iiif_label_text(canvas.get("label")) or str(index + 1),
        "width": width,
        "height": height,
        "serviceUrl": service_url,
        "directUrl": direct_url,
    }


def _fetch_archive_scan_manifest(
    identifier: str,
    *,
    session: Optional[requests.Session] = None,
) -> Optional[Dict[str, Any]]:
    if not identifier:
        return None
    manifest = _request_json(
        f"https://iiif.archive.org/iiif/{quote(identifier)}/manifest.json",
        timeout=(3, 8),
        session=session,
    )
    pages = []
    for index, canvas in enumerate(manifest.get("items") or []):
        page = _normalize_scan_canvas(canvas, index)
        if page:
            pages.append(page)
    if not pages:
        return None
    return {
        "identifier": identifier,
        "pageCount": len(pages),
        "source": "iiif",
        "behavior": list(manifest.get("behavior") or []),
        "viewingDirection": _normalize_text(manifest.get("viewingDirection")) or "left-to-right",
        "pages": pages,
    }


def _bookreader_viewing_direction(value: Any) -> str:
    direction = _normalize_text(value).casefold()
    if direction in {"rl", "right-to-left"}:
        return "right-to-left"
    return "left-to-right"


def _sanitize_scan_manifest(manifest: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not isinstance(manifest, dict):
        return None
    raw_pages = manifest.get("pages") or []
    if not isinstance(raw_pages, list):
        return None

    source = _normalize_text(manifest.get("source")) or "iiif"
    pages = []
    for position, page in enumerate(raw_pages):
        if not isinstance(page, dict):
            continue
        width = _coerce_positive_int(page.get("width"))
        height = _coerce_positive_int(page.get("height"))
        service_url = _safe_https(page.get("serviceUrl"))
        direct_url = _safe_https(page.get("directUrl"))
        if not width or not height or not (service_url or direct_url):
            continue
        source_index = _coerce_positive_int(page.get("sourceIndex"), _coerce_positive_int(page.get("index"), position))
        source_label = _normalize_text(page.get("sourceLabel")) or _normalize_text(page.get("label")) or str(source_index + 1)
        label = str(position + 1) if source == "bookreader" else (_normalize_text(page.get("label")) or str(position + 1))
        pages.append(
            {
                "index": position,
                "label": label,
                "sourceIndex": source_index,
                "sourceLabel": source_label,
                "width": width,
                "height": height,
                "serviceUrl": service_url,
                "directUrl": direct_url,
            }
        )

    if not pages:
        return None

    return {
        "identifier": _normalize_text(manifest.get("identifier")),
        "pageCount": len(pages),
        "source": source,
        "behavior": list(manifest.get("behavior") or []),
        "viewingDirection": _normalize_text(manifest.get("viewingDirection")) or "left-to-right",
        "pages": pages,
    }


def _fetch_archive_bookreader_manifest(
    identifier: str,
    *,
    session: Optional[requests.Session] = None,
) -> Optional[Dict[str, Any]]:
    if not identifier:
        return None
    metadata = _request_json(f"https://archive.org/metadata/{identifier}", timeout=(3, 8), session=session)
    server = _normalize_text(metadata.get("d2") or metadata.get("server") or metadata.get("d1"))
    item_path = _normalize_text(metadata.get("dir"))
    if not server or not item_path:
        return None

    bookreader_url = (
        f"https://{server}/BookReader/BookReaderJSIA.php"
        f"?id={quote(identifier)}"
        f"&itemPath={item_path}"
        f"&server={server}"
        f"&format=jsonp"
        f"&subPrefix={quote(identifier)}"
        f"&requestUri=/details/{quote(identifier)}"
    )
    requester = session or requests
    response = requester.get(
        bookreader_url,
        timeout=(3, 8),
        headers={"Accept": "application/json, text/javascript, */*;q=0.8", "User-Agent": USER_AGENT},
    )
    response.raise_for_status()
    try:
        payload = json.loads(response.text)
    except json.JSONDecodeError:
        return None

    br_options = ((payload.get("data") or {}).get("brOptions") or {})
    groups = br_options.get("data") or []
    pages = []
    next_index = 0
    for group in groups:
        if not isinstance(group, list):
            continue
        for page in group:
            if not isinstance(page, dict) or not page.get("viewable"):
                continue
            uri = _safe_https(page.get("uri"))
            width = _coerce_positive_int(page.get("width"))
            height = _coerce_positive_int(page.get("height"))
            if not uri or not width or not height:
                continue
            source_index = _coerce_positive_int(page.get("origIndex"), next_index)
            source_label = _normalize_text(page.get("leafNum")) or str(source_index + 1)
            pages.append(
                {
                    "index": next_index,
                    "label": str(next_index + 1),
                    "sourceIndex": source_index,
                    "sourceLabel": source_label,
                    "width": width,
                    "height": height,
                    "serviceUrl": None,
                    "directUrl": uri,
                }
            )
            next_index += 1

    if not pages:
        return None
    return _sanitize_scan_manifest(
        {
            "identifier": identifier,
            "pageCount": len(pages),
            "source": "bookreader",
            "behavior": [],
            "viewingDirection": _bookreader_viewing_direction(br_options.get("pageProgression")),
            "pages": pages,
        }
    )


def _normalize_openlibrary(doc: Dict[str, Any]) -> Dict[str, Any]:
    work_key = str(doc.get("key") or "").split("/")[-1]
    ia_identifiers = doc.get("ia") or []
    access = _normalize_text(doc.get("ebook_access")).casefold()
    availability = "unavailable"
    reader_type = None
    reader_url = None
    actions: List[Dict[str, Any]] = []
    if access == "public" and ia_identifiers:
        availability = "read"
        actions.append({"label": "Read", "kind": "read", "url": ""})
    elif access == "borrowable" and ia_identifiers:
        availability = "borrow"
        reader_url = f"https://archive.org/details/{ia_identifiers[0]}"
        actions.append({"label": "Borrow", "kind": "borrow", "url": reader_url})
    elif doc.get("has_fulltext") or ia_identifiers:
        availability = "preview"
        reader_url = f"https://archive.org/details/{ia_identifiers[0]}" if ia_identifiers else f"https://openlibrary.org{doc.get('key')}"
        actions.append({"label": "Preview", "kind": "preview", "url": reader_url})

    cover = _cover_from_openlibrary(doc.get("cover_i"))
    identifiers: Dict[str, List[str]] = {"openlibrary": [work_key]} if work_key else {}
    if ia_identifiers:
        identifiers["internet_archive"] = [str(value) for value in ia_identifiers[:3] if value]
    isbns = [str(value) for value in doc.get("isbn") or [] if value]
    if isbns:
        identifiers["isbn13"] = [value for value in isbns if len(value) == 13][:5]
        identifiers["isbn10"] = [value for value in isbns if len(value) == 10][:5]

    return {
        "id": f"openlibrary:{work_key}" if work_key else "",
        "title": _normalize_text(doc.get("title")),
        "authors": _unique_list(doc.get("author_name") or []),
        "description": "",
        "coverUrl": cover,
        "coverFallbacks": [cover] if cover else [],
        "subjects": _unique_list(doc.get("subject") or []),
        "language": _normalize_text((doc.get("language") or [""])[0]),
        "publishedYear": doc.get("first_publish_year"),
        "pageCount": None,
        "source": "openlibrary",
        "sourceLabel": "Open Library",
        "availability": availability,
        "actions": actions,
        "readerType": reader_type,
        "readerUrl": reader_url,
        "downloadUrls": {},
        "identifiers": identifiers,
        "_raw_source": {"source": "openlibrary", "payload": doc},
    }


def _normalize_google(item: Dict[str, Any]) -> Dict[str, Any]:
    volume_info = item.get("volumeInfo") or {}
    access_info = item.get("accessInfo") or {}
    image_links = volume_info.get("imageLinks") or {}
    identifiers: Dict[str, List[str]] = {}
    for identifier in volume_info.get("industryIdentifiers") or []:
        id_type = identifier.get("type")
        value = _normalize_text(identifier.get("identifier"))
        if not value:
            continue
        if id_type == "ISBN_13":
            identifiers.setdefault("isbn13", []).append(value)
        elif id_type == "ISBN_10":
            identifiers.setdefault("isbn10", []).append(value)

    viewability = _normalize_text(access_info.get("viewability")).upper()
    preview_link = _safe_https(access_info.get("webReaderLink")) or _safe_https(volume_info.get("previewLink"))
    availability = "unavailable"
    label = None
    if viewability in {"ALL_PAGES", "FULL_PUBLIC_DOMAIN"} and preview_link:
        availability = "read"
        label = "Read"
    elif preview_link:
        availability = "preview"
        label = "Preview"

    actions = [{"label": label, "kind": availability, "url": preview_link}] if label and preview_link else []
    published_date = _normalize_text(volume_info.get("publishedDate"))
    published_year = None
    if published_date:
        match = re.match(r"^(\d{4})", published_date)
        if match:
            published_year = int(match.group(1))

    cover = _safe_https(
        image_links.get("extraLarge")
        or image_links.get("large")
        or image_links.get("medium")
        or image_links.get("thumbnail")
        or image_links.get("smallThumbnail")
    )

    return {
        "id": f"google:{item.get('id')}",
        "title": _normalize_text(volume_info.get("title")),
        "authors": _unique_list(volume_info.get("authors") or []),
        "description": _normalize_text(volume_info.get("description")),
        "coverUrl": cover,
        "coverFallbacks": [cover] if cover else [],
        "subjects": _unique_list(volume_info.get("categories") or []),
        "language": _normalize_text(volume_info.get("language")),
        "publishedYear": published_year,
        "pageCount": volume_info.get("pageCount"),
        "source": "google",
        "sourceLabel": "Google Books",
        "availability": availability,
        "actions": actions,
        "readerType": "external" if preview_link else None,
        "readerUrl": preview_link,
        "downloadUrls": {},
        "identifiers": identifiers,
        "_raw_source": {"source": "google", "payload": item},
    }


def _normalize_standard_ebook(entry: Dict[str, Any]) -> Dict[str, Any]:
    identifier = entry.get("id")
    cover = _safe_https(entry.get("cover"))
    epub_url = _safe_https(entry.get("epub"))
    return {
        "id": f"se:{identifier}",
        "title": _normalize_text(entry.get("title")),
        "authors": _unique_list(entry.get("authors") or []),
        "description": _normalize_text(entry.get("description")),
        "coverUrl": cover,
        "coverFallbacks": [cover] if cover else [],
        "subjects": _unique_list(entry.get("subjects") or []),
        "language": _normalize_text(entry.get("language")),
        "publishedYear": entry.get("publishedYear"),
        "pageCount": None,
        "source": "se",
        "sourceLabel": "Standard Ebooks",
        "availability": "read" if epub_url else "unavailable",
        "actions": [{"label": "Read", "kind": "read", "url": epub_url}] if epub_url else [],
        "readerType": "epub" if epub_url else None,
        "readerUrl": epub_url,
        "downloadUrls": {"epub": epub_url} if epub_url else {},
        "identifiers": {"standard_ebooks": [identifier]},
        "_raw_source": {"source": "standard_ebooks", "payload": entry},
    }


def _search_gutendex(query: str, page: int, pool_size: int = BOOK_PAGE_SIZE) -> Tuple[List[Dict[str, Any]], Any]:
    items: List[Dict[str, Any]] = []
    raw_pages: List[Dict[str, Any]] = []
    seen_ids = set()
    target_pages = max(1, min(4, (max(pool_size, BOOK_PAGE_SIZE) + 31) // 32))
    for offset in range(target_pages):
        params: Dict[str, Any] = {"page": page + offset}
        if query:
            params["search"] = query
        payload = _request_json("https://gutendex.com/books", params=params, timeout=SEARCH_REQUEST_TIMEOUT)
        raw_pages.append({"page": page + offset, "count": len(payload.get("results") or [])})
        for result in payload.get("results") or []:
            result_id = result.get("id")
            if not result_id or result_id in seen_ids:
                continue
            seen_ids.add(result_id)
            items.append(_normalize_gutendex(result))
            if len(items) >= pool_size:
                return items, {"pages": raw_pages, "count": len(items)}
        if not payload.get("next"):
            break
    return items, {"pages": raw_pages, "count": len(items)}


def _search_openlibrary(query: str, page: int, pool_size: int = BOOK_PAGE_SIZE) -> Tuple[List[Dict[str, Any]], Any]:
    items: List[Dict[str, Any]] = []
    raw_pages: List[Dict[str, Any]] = []
    seen_ids = set()
    remaining = max(BOOK_PAGE_SIZE, pool_size)
    current_page = 1
    limit = max(BOOK_PAGE_SIZE, min(96, remaining))
    max_pages = 1

    while len(items) < remaining and current_page <= max_pages:
        params = {
            "q": query or "classic literature",
            "page": current_page,
            "limit": limit,
            "fields": "key,title,author_name,cover_i,first_publish_year,subject,language,ebook_access,has_fulltext,ia,public_scan_b,isbn",
        }
        payload = _request_json("https://openlibrary.org/search.json", params=params, timeout=SEARCH_REQUEST_TIMEOUT)
        docs = payload.get("docs") or []
        raw_pages.append({"page": current_page, "count": len(docs), "numFound": payload.get("numFound")})
        for doc in docs:
            normalized = _normalize_openlibrary(doc)
            normalized_id = normalized.get("id")
            if not normalized_id or normalized_id in seen_ids:
                continue
            seen_ids.add(normalized_id)
            items.append(normalized)
            if len(items) >= remaining:
                break
        if len(docs) < limit:
            break
        current_page += 1

    return items, {"pages": raw_pages, "count": len(items)}


def _search_google(query: str, page: int, google_books_api_key: Optional[str], pool_size: int = BOOK_PAGE_SIZE) -> Tuple[List[Dict[str, Any]], Any]:
    if not google_books_api_key:
        return [], {"disabled": True, "reason": "missing_google_books_api_key"}
    params = {
        "q": query or "classic literature",
        "startIndex": 0,
        "maxResults": min(40, max(12, pool_size // 2)),
        "printType": "books",
        "key": google_books_api_key,
    }
    payload = _request_json("https://www.googleapis.com/books/v1/volumes", params=params, timeout=SEARCH_REQUEST_TIMEOUT)
    items = [_normalize_google(item) for item in payload.get("items") or []]
    return [item for item in items if item.get("id")], payload


def _parse_standard_ebooks_feed(xml_text: str) -> List[Dict[str, Any]]:
    namespace = {"atom": "http://www.w3.org/2005/Atom"}
    root = ET.fromstring(xml_text)
    entries: List[Dict[str, Any]] = []
    for entry in root.findall("atom:entry", namespace):
        entry_id = _normalize_text(entry.findtext("atom:id", "", namespace))
        title = _normalize_text(entry.findtext("atom:title", "", namespace))
        summary = _normalize_text(entry.findtext("atom:summary", "", namespace))
        authors = [
            _normalize_text(author.findtext("atom:name", "", namespace))
            for author in entry.findall("atom:author", namespace)
        ]
        links = entry.findall("atom:link", namespace)
        epub_url = None
        cover_url = None
        page_url = None
        for link in links:
            rel = link.attrib.get("rel", "")
            link_type = link.attrib.get("type", "")
            href = _safe_https(link.attrib.get("href"))
            if link_type == "application/epub+zip":
                epub_url = href
            elif rel == "http://opds-spec.org/image" or rel == "http://opds-spec.org/image/thumbnail":
                cover_url = href
            elif rel == "alternate" and link_type == "text/html":
                page_url = href
        entries.append(
            {
                "id": entry_id.rsplit("/", 1)[-1] or entry_id,
                "title": title,
                "authors": authors,
                "description": summary,
                "cover": cover_url,
                "epub": epub_url,
                "pageUrl": page_url,
                "subjects": [],
                "language": "",
                "publishedYear": None,
            }
        )
    return entries


def _load_standard_ebooks_entries() -> List[Dict[str, Any]]:
    cached = _standard_ebooks_cache
    if cached["entries"] and cached["fetched_at"] + STANDARD_EBOOKS_FEED_TTL_MS > _now_ms():
        return cached["entries"]
    for url in STANDARD_EBOOKS_FEEDS:
        try:
            xml_text = _request_text(url, timeout=(3, 6))
            if "<feed" not in xml_text:
                continue
            entries = _parse_standard_ebooks_feed(xml_text)
            cached["entries"] = entries
            cached["fetched_at"] = _now_ms()
            return entries
        except Exception:
            continue
    cached["entries"] = []
    cached["fetched_at"] = _now_ms()
    return []


def _search_standard_ebooks(query: str, page: int, pool_size: int = BOOK_PAGE_SIZE) -> Tuple[List[Dict[str, Any]], Any]:
    entries = _load_standard_ebooks_entries()
    if not entries:
        return [], {"disabled": True, "reason": "standard_ebooks_feed_unavailable"}
    needle = query.casefold().strip()
    filtered = entries
    if needle:
        filtered = [
            entry
            for entry in entries
            if needle in _normalize_text(entry.get("title")).casefold()
            or any(needle in author.casefold() for author in entry.get("authors") or [])
        ]
    start = 0
    end = max(8, pool_size)
    items = [_normalize_standard_ebook(entry) for entry in filtered[start:end]]
    return items, {"total": len(filtered)}


def _fetch_gutendex_item(source_key: str) -> Dict[str, Any]:
    payload = _request_json(f"https://gutendex.com/books/{source_key}")
    return _normalize_gutendex(payload)


def _fetch_google_item(source_key: str, google_books_api_key: Optional[str]) -> Optional[Dict[str, Any]]:
    if not google_books_api_key:
        return None
    payload = _request_json(
        f"https://www.googleapis.com/books/v1/volumes/{source_key}",
        params={"key": google_books_api_key},
    )
    return _normalize_google(payload)


def _fetch_openlibrary_item(source_key: str) -> Optional[Dict[str, Any]]:
    payload = _request_json(f"https://openlibrary.org/works/{source_key}.json")
    description = payload.get("description")
    if isinstance(description, dict):
        description = description.get("value")
    cover_ids = payload.get("covers") or []
    cover_url = _cover_from_openlibrary(cover_ids[0]) if cover_ids else None
    search_payload = _request_json(
        "https://openlibrary.org/search.json",
        params={"q": f"key:/works/{source_key}", "limit": 1},
        timeout=SEARCH_REQUEST_TIMEOUT,
    )
    docs = search_payload.get("docs") or []
    if docs:
        record = _normalize_openlibrary(docs[0])
        if _normalize_text(description):
            record["description"] = _normalize_text(description)
        if cover_url and not record.get("coverUrl"):
            record["coverUrl"] = cover_url
            record["coverFallbacks"] = _unique_list([cover_url] + list(record.get("coverFallbacks") or []))
        record["_raw_source"] = {"source": "openlibrary", "payload": docs[0]}
        return record

    return {
        "id": f"openlibrary:{source_key}",
        "title": _normalize_text(payload.get("title")),
        "authors": [],
        "description": _normalize_text(description),
        "coverUrl": cover_url,
        "coverFallbacks": [cover_url] if cover_url else [],
        "subjects": _unique_list(payload.get("subjects") or []),
        "language": "",
        "publishedYear": None,
        "pageCount": None,
        "source": "openlibrary",
        "sourceLabel": "Open Library",
        "availability": "external",
        "actions": [{"label": "View Source", "kind": "external", "url": f"https://openlibrary.org/works/{source_key}"}],
        "readerType": "external",
        "readerUrl": f"https://openlibrary.org/works/{source_key}",
        "downloadUrls": {},
        "identifiers": {"openlibrary": [source_key]},
        "_raw_source": {"source": "openlibrary", "payload": payload},
    }


def _fetch_standard_ebooks_item(source_key: str) -> Optional[Dict[str, Any]]:
    entries = _load_standard_ebooks_entries()
    for entry in entries:
        entry_id = entry.get("id") or ""
        if entry_id == source_key or entry_id.endswith(source_key):
            return _normalize_standard_ebook(entry)
    return None


def _build_groups(records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    groups: List[List[Dict[str, Any]]] = []
    key_map: Dict[str, int] = {}
    for record in records:
        matched_index = None
        for key in _dedupe_keys(record):
            if key in key_map:
                matched_index = key_map[key]
                break
        if matched_index is None:
            matched_index = len(groups)
            groups.append([record])
        else:
            groups[matched_index].append(record)
        for key in _dedupe_keys(record):
            key_map[key] = matched_index
    return [_merge_records(group) for group in groups]


def _enrich_record_downloads(record: Dict[str, Any]) -> Dict[str, Any]:
    downloads = dict(record.get("downloadUrls") or {})
    if downloads:
        return record
    if record.get("availability") == "borrow":
        return record

    identifiers = record.get("identifiers") or {}
    archive_ids = identifiers.get("internet_archive") or []
    if not archive_ids:
        return record

    for archive_id in archive_ids:
        try:
            archive_downloads, reader_type, reader_url = _archive_downloads(archive_id)
        except Exception as error:
            logging.getLogger(__name__).warning("Archive enrichment failed for %s: %s", archive_id, error)
            continue
        if not archive_downloads:
            continue

        enriched = dict(record)
        enriched["downloadUrls"] = archive_downloads
        enriched["readerType"] = reader_type
        enriched["readerUrl"] = reader_url
        enriched["availability"] = "read"
        enriched["actions"] = [{"label": "Read", "kind": "read", "url": reader_url}] if reader_url else []
        return enriched
    return record


def _get_scan_manifest(
    connection,
    identifiers: Dict[str, List[str]],
    *,
    session: Optional[requests.Session] = None,
    preferred_archive_id: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    archive_ids = list(identifiers.get("internet_archive") or [])
    if preferred_archive_id:
        archive_ids = [preferred_archive_id] + [archive_id for archive_id in archive_ids if archive_id != preferred_archive_id]
    for archive_id in archive_ids:
        cached = _cache_read(connection, "book_scan_cache", "archive_id", archive_id)
        if cached:
            manifest = _sanitize_scan_manifest(cached["payload"])
            if manifest and manifest != cached["payload"]:
                _cache_write(connection, "book_scan_cache", "archive_id", archive_id, manifest, None, SCAN_TTL_MS)
            return manifest
        try:
            manifest = _fetch_archive_scan_manifest(archive_id, session=session)
        except Exception as error:
            logging.getLogger(__name__).warning("Scan manifest fetch failed for %s: %s", archive_id, error)
            manifest = None
        if not manifest:
            try:
                manifest = _fetch_archive_bookreader_manifest(archive_id, session=session)
            except Exception as error:
                logging.getLogger(__name__).warning("BookReader manifest fetch failed for %s: %s", archive_id, error)
                manifest = None
        manifest = _sanitize_scan_manifest(manifest)
        if not manifest:
            continue
        _cache_write(connection, "book_scan_cache", "archive_id", archive_id, manifest, None, SCAN_TTL_MS)
        return manifest
    return None


def _cached_loan_access(connection, book_id: str) -> Optional[Dict[str, Any]]:
    cached = _cache_read(connection, "book_loan_cache", "book_id", book_id)
    if not cached:
        return None
    payload = cached.get("payload") or {}
    manifest = _sanitize_scan_manifest(payload.get("scanManifest"))
    if manifest:
        payload["scanManifest"] = manifest
    elif "scanManifest" in payload:
        payload.pop("scanManifest", None)
    return cached


def _archive_check_active_loan(session: requests.Session, archive_id: str) -> Optional[Dict[str, Any]]:
    try:
        payload = _perform_loan_action(session, archive_id, "create_token")
    except requests.RequestException as error:
        logging.getLogger(__name__).warning("Loan token probe failed for %s: %s", archive_id, error)
        return None
    if not payload.get("success"):
        return None
    status = _extract_loan_status(payload, archive_id, borrowed_by_server=True)
    status["active"] = True
    status.setdefault("message", "Loan active.")
    return status


def _manifest_has_viewable_pages(manifest: Optional[Dict[str, Any]], *, session: Optional[requests.Session]) -> bool:
    if not isinstance(manifest, dict):
        return False
    source = _normalize_text(manifest.get("source")).casefold()
    if source != "bookreader":
        return bool(manifest.get("pages"))
    for page in manifest.get("pages") or []:
        if not isinstance(page, dict):
            continue
        if _probe_scan_image_source(page.get("directUrl"), session=session):
            return True
    return False


def _resolve_loan_renderability(
    connection,
    record: Dict[str, Any],
    *,
    session: Optional[requests.Session],
    preferred_archive_id: Optional[str] = None,
) -> Tuple[Optional[Dict[str, Any]], Dict[str, str], Optional[str], bool, Optional[str]]:
    manifest = _get_scan_manifest(
        connection,
        record.get("identifiers") or {},
        session=session,
        preferred_archive_id=preferred_archive_id,
    )
    if manifest and _manifest_has_viewable_pages(manifest, session=session):
        return manifest, {}, "scan", False, None

    downloads = dict(record.get("downloadUrls") or {})
    if not downloads:
        archive_ids = list((record.get("identifiers") or {}).get("internet_archive") or [])
        if preferred_archive_id:
            archive_ids = [preferred_archive_id] + [archive_id for archive_id in archive_ids if archive_id != preferred_archive_id]
        for archive_id in archive_ids:
            try:
                downloads, _, _ = _archive_downloads(archive_id, session=session)
            except Exception as error:
                logging.getLogger(__name__).warning("Archive download discovery failed for %s: %s", archive_id, error)
                downloads = {}
            if downloads:
                break

    for candidate in ("pdf", "epub", "html", "text"):
        candidate_url = downloads.get(candidate)
        if not candidate_url:
            continue
        if session is not None and not _probe_binary_access(candidate_url, session=session):
            continue
        return None, downloads, candidate, False, None

    return None, {}, None, False, "This loan is active, but this edition does not expose an in-app page source we can render yet."


def _merge_loan_record(
    record: Dict[str, Any],
    loan_status: Dict[str, Any],
    *,
    scan_manifest: Optional[Dict[str, Any]] = None,
    download_urls: Optional[Dict[str, str]] = None,
) -> Dict[str, Any]:
    renderable = bool(loan_status.get("renderable"))
    render_mode = loan_status.get("renderMode")
    preparing = bool(loan_status.get("preparing"))
    reason = loan_status.get("reason") or loan_status.get("message")
    archive_id = _normalize_text(loan_status.get("archiveId"))

    if (
        not renderable
        and not preparing
        and loan_status.get("active")
        and _normalize_text(loan_status.get("provider")) == "archive.org"
        and archive_id
    ):
        renderable = True
        render_mode = "archive-embed"

    merged = dict(record)
    merged["loanStatus"] = loan_status
    merged["renderable"] = renderable
    merged["renderMode"] = render_mode
    merged["preparing"] = preparing
    merged["reason"] = reason
    if scan_manifest:
        merged["scanManifest"] = scan_manifest
    if download_urls:
        merged["downloadUrls"] = download_urls
    if renderable:
        merged["availability"] = "read"
        merged["actions"] = [{"label": "Read", "kind": "read", "url": ""}]
    return merged


def _resolve_loan_access(connection, record: Dict[str, Any]) -> Dict[str, Any]:
    if not isinstance(record, dict) or record.get("availability") != "borrow" or not record.get("id"):
        return record

    cached = _cached_loan_access(connection, record["id"])
    if cached:
        return _merge_loan_record(
            record,
            cached["payload"].get("loanStatus") or {"active": False},
            scan_manifest=cached["payload"].get("scanManifest"),
            download_urls=cached["payload"].get("downloadUrls"),
        )

    inactive_status = _with_loan_renderability(
        {
            "active": False,
            "provider": "archive.org",
            "borrowedByServer": False,
            "message": "Borrow this book to read it inside theblackbox.",
        },
        renderable=False,
        render_mode=None,
        preparing=False,
        reason="No active lender-backed loan is available for this title right now.",
    )
    return _merge_loan_record(record, inactive_status)


def get_book_loan_status(connection, book_id: str, google_books_api_key: Optional[str] = None) -> Optional[Dict[str, Any]]:
    item = get_book_item(connection, book_id, google_books_api_key)
    if not item:
        return None
    return {
        "bookId": book_id,
        "availability": item.get("availability"),
        "loanStatus": item.get("loanStatus") or {"active": False},
        "renderable": bool(item.get("renderable")),
        "renderMode": item.get("renderMode"),
        "preparing": bool(item.get("preparing")),
        "reason": item.get("reason"),
        "readerUrl": f"/reader.html?id={quote(book_id, safe='')}",
    }


def update_book_loan(
    connection,
    book_id: str,
    action: str,
    google_books_api_key: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    item = get_book_item(connection, book_id, google_books_api_key)
    if not item:
        return None
    if item.get("source") != "openlibrary":
        return {
            "bookId": book_id,
            "success": False,
            "error": "This source does not support provider-backed borrowing.",
            "loanStatus": item.get("loanStatus") or {"active": False},
        }

    archive_ids = (item.get("identifiers") or {}).get("internet_archive") or []
    if not archive_ids:
        return {
            "bookId": book_id,
            "success": False,
            "error": "No borrowable archive edition is linked to this title.",
            "loanStatus": item.get("loanStatus") or {"active": False},
        }

    normalized_action = _normalize_text(action).casefold()
    if normalized_action not in {"borrow", "return"}:
        return {
            "bookId": book_id,
            "success": False,
            "error": "Unsupported loan action.",
            "loanStatus": item.get("loanStatus") or {"active": False},
        }

    session, session_error = _archive_login_session()
    if session is None:
        return {
            "bookId": book_id,
            "success": False,
            "error": session_error or "Archive lender session is unavailable.",
            "loanStatus": item.get("loanStatus") or {"active": False},
        }

    endpoint_action = "borrow_book" if normalized_action == "borrow" else "return_loan"
    result_payload = None
    selected_archive_id = archive_ids[0]
    for archive_id in archive_ids:
        selected_archive_id = archive_id
        try:
            result_payload = _perform_loan_action(session, archive_id, endpoint_action)
        except requests.RequestException as error:
            logging.getLogger(__name__).warning("Loan action %s failed for %s: %s", endpoint_action, archive_id, error)
            result_payload = {"success": False, "error": str(error), "action": endpoint_action}
        if result_payload.get("success"):
            break

    if normalized_action == "return":
        inactive_status = _with_loan_renderability(
            _extract_loan_status(result_payload or {}, selected_archive_id, borrowed_by_server=False),
            renderable=False,
            render_mode=None,
            preparing=False,
            reason="Loan returned.",
        )
        inactive_status["active"] = False
        inactive_status.setdefault("message", "Loan returned.")
        _cache_write(
            connection,
            "book_loan_cache",
            "book_id",
            book_id,
            _loan_cache_payload(inactive_status),
            result_payload,
            LOAN_TTL_MS,
        )
        refreshed = get_book_read(connection, book_id, google_books_api_key) or item
        return {
            "bookId": book_id,
            "success": bool((result_payload or {}).get("success")),
            "loanStatus": inactive_status,
            "reader": refreshed,
            "message": inactive_status.get("message") or "Loan returned.",
        }

    active_status = None
    if result_payload and result_payload.get("success"):
        active_status = _extract_loan_status(result_payload, selected_archive_id, borrowed_by_server=True)
    else:
        for archive_id in archive_ids:
            active_status = _archive_check_active_loan(session, archive_id)
            if active_status:
                selected_archive_id = archive_id
                break

    scan_manifest = None
    download_urls: Dict[str, str] = {}
    if active_status and active_status.get("active"):
        scan_manifest, download_urls, render_mode, preparing, reason = _resolve_loan_renderability(
            connection,
            item,
            session=session,
            preferred_archive_id=selected_archive_id,
        )
        active_status = _apply_managed_loan_window(active_status)
        active_status = _with_loan_renderability(
            active_status,
            renderable=bool(scan_manifest or download_urls),
            render_mode=render_mode,
            preparing=preparing,
            reason=reason,
        )
        active_status.setdefault("message", "Loan active.")
        _cache_write(
            connection,
            "book_loan_cache",
            "book_id",
            book_id,
            _loan_cache_payload(active_status, scan_manifest=scan_manifest, download_urls=download_urls),
            result_payload,
            ACTIVE_LOAN_TTL_MS,
        )
    else:
        inactive_status = _with_loan_renderability(
            _extract_loan_status(result_payload or {}, selected_archive_id, borrowed_by_server=False),
            renderable=False,
            render_mode=None,
            preparing=False,
            reason=_normalize_text((result_payload or {}).get("error")) or "No active lender-backed loan is available for this title right now.",
        )
        inactive_status["active"] = False
        if not inactive_status.get("message"):
            inactive_status["message"] = inactive_status.get("reason") or "Borrowing is unavailable right now."
        _cache_write(
            connection,
            "book_loan_cache",
            "book_id",
            book_id,
            _loan_cache_payload(inactive_status),
            result_payload,
            LOAN_TTL_MS,
        )

    refreshed = get_book_read(connection, book_id, google_books_api_key) or item
    final_status = refreshed.get("loanStatus") or active_status or inactive_status
    return {
        "bookId": book_id,
        "success": bool(final_status.get("active")),
        "loanStatus": final_status,
        "reader": refreshed,
        "message": final_status.get("message") or "Loan updated.",
    }


def _rehydrate_cached_record(payload: Dict[str, Any], raw: Any) -> Dict[str, Any]:
    if not isinstance(payload, dict):
        return payload
    if payload.get("downloadUrls") or payload.get("identifiers", {}).get("internet_archive"):
        return payload

    raw_sources = raw if isinstance(raw, list) else [raw] if raw else []
    reconstructed: List[Dict[str, Any]] = []
    for entry in raw_sources:
        if not isinstance(entry, dict):
            continue
        source = entry.get("source")
        source_payload = entry.get("payload")
        if not isinstance(source_payload, dict):
            continue
        if source == "gutendex":
            reconstructed.append(_normalize_gutendex(source_payload))
        elif source == "openlibrary":
            reconstructed.append(_normalize_openlibrary(source_payload))
        elif source == "google":
            reconstructed.append(_normalize_google(source_payload))
        elif source == "standard_ebooks":
            reconstructed.append(_normalize_standard_ebook(source_payload))

    if not reconstructed:
        return payload

    rebuilt = _build_groups(reconstructed)
    return rebuilt[0] if rebuilt else payload


def _is_standard_ebooks_warm() -> bool:
    cached = _standard_ebooks_cache
    return bool(cached["entries"]) and cached["fetched_at"] + STANDARD_EBOOKS_FEED_TTL_MS > _now_ms()


def _collect_source_result(source_name: str, future, source_payloads: Dict[str, Any], all_records: List[Dict[str, Any]]) -> None:
    try:
        items, raw = future.result()
        source_payloads[source_name] = raw
        all_records.extend(item for item in items if item.get("id"))
    except Exception as error:
        logging.getLogger(__name__).warning("Book source %s failed: %s", source_name, error)
        source_payloads[source_name] = {"error": str(error)}


def _summarize_source_payload(raw_payload: Any) -> Any:
    if not isinstance(raw_payload, dict):
        return raw_payload
    for passthrough_key in ("error", "disabled", "skipped", "reason"):
        if passthrough_key in raw_payload:
            return {
                key: raw_payload[key]
                for key in ("error", "disabled", "skipped", "reason")
                if key in raw_payload
            }

    summary: Dict[str, Any] = {}
    if "count" in raw_payload and isinstance(raw_payload.get("count"), int):
        summary["count"] = raw_payload["count"]
    if "total" in raw_payload and isinstance(raw_payload.get("total"), int):
        summary["total"] = raw_payload["total"]
    if "total_pages" in raw_payload and isinstance(raw_payload.get("total_pages"), int):
        summary["totalPages"] = raw_payload["total_pages"]
    if "numFound" in raw_payload and isinstance(raw_payload.get("numFound"), int):
        summary["count"] = raw_payload["numFound"]
    if "results" in raw_payload and isinstance(raw_payload.get("results"), list):
        summary["count"] = len(raw_payload["results"])
    if "docs" in raw_payload and isinstance(raw_payload.get("docs"), list):
        summary["count"] = len(raw_payload["docs"])
    if not summary:
        summary["ok"] = True
    return summary


def _search_cached_items(connection, query: str, availability: Optional[str], limit: int) -> List[Dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT payload_json
        FROM book_item_cache
        ORDER BY fetched_at DESC
        LIMIT 400
        """
    ).fetchall()
    records: List[Dict[str, Any]] = []
    seen_ids = set()
    for row in rows:
        try:
            payload = json.loads(row["payload_json"])
        except Exception:
            continue
        record_id = payload.get("id")
        if not record_id or record_id in seen_ids:
            continue
        seen_ids.add(record_id)
        records.append(payload)
    ranked = _rank_records(records, query)
    filtered = _filter_availability(ranked, availability)
    return filtered[:limit]


def search_books(connection, query: str, page: int = 1, availability: Optional[str] = None, google_books_api_key: Optional[str] = None) -> Dict[str, Any]:
    normalized_query = _normalize_text(query)
    normalized_page = max(1, int(page or 1))
    availability_filter = _normalize_text(availability).casefold() or "all"
    cache_key = hashlib.sha1(
        f"{SEARCH_CACHE_SCHEMA_VERSION}|{normalized_query}|{availability_filter}|{bool(google_books_api_key)}".encode("utf-8")
    ).hexdigest()
    cached = _cache_read(connection, "book_search_cache", "cache_key", cache_key)
    if cached:
        cached_payload = cached["payload"]
        all_items = list(cached_payload.get("allItems") or [])
        start_index = max(0, (normalized_page - 1) * BOOK_PAGE_SIZE)
        end_index = start_index + BOOK_PAGE_SIZE
        return {
            "items": all_items[start_index:end_index],
            "page": normalized_page,
            "query": normalized_query,
            "availability": availability_filter,
            "hasMore": end_index < len(all_items),
            "sources": cached_payload.get("sources") or {},
        }

    source_payloads: Dict[str, Any] = {}
    all_records: List[Dict[str, Any]] = []
    pool_size = BOOK_PAGE_SIZE * 4
    fast_sources = (
        ("gutendex", lambda: _search_gutendex(normalized_query, 1, pool_size)),
        ("openlibrary", lambda: _search_openlibrary(normalized_query, 1, pool_size)),
    )
    optional_sources = []
    if google_books_api_key:
        optional_sources.append(("google", lambda: _search_google(normalized_query, normalized_page, google_books_api_key, pool_size)))
    else:
        source_payloads["google"] = {"disabled": True, "reason": "missing_google_books_api_key"}

    if _is_standard_ebooks_warm():
        optional_sources.append(("standard_ebooks", lambda: _search_standard_ebooks(normalized_query, normalized_page, pool_size)))
    else:
        source_payloads["standard_ebooks"] = {"skipped": True, "reason": "source_not_warm"}

    executor = ThreadPoolExecutor(max_workers=max(2, len(fast_sources) + len(optional_sources)))
    try:
        fast_futures = {executor.submit(loader): source_name for source_name, loader in fast_sources}
        done_fast, not_done_fast = wait(fast_futures.keys(), timeout=FAST_SOURCE_BUDGET_SEC)
        for future in done_fast:
            _collect_source_result(fast_futures[future], future, source_payloads, all_records)
        for future in not_done_fast:
            source_name = fast_futures[future]
            future.cancel()
            source_payloads[source_name] = {"skipped": True, "reason": "fast_search_budget_exceeded"}

        optional_futures = {executor.submit(loader): source_name for source_name, loader in optional_sources}
        if optional_futures:
            done, not_done = wait(optional_futures.keys(), timeout=OPTIONAL_SOURCE_BUDGET_SEC)
            for future in done:
                _collect_source_result(optional_futures[future], future, source_payloads, all_records)
            for future in not_done:
                source_name = optional_futures[future]
                future.cancel()
                source_payloads[source_name] = {"skipped": True, "reason": "search_budget_exceeded"}
    finally:
        executor.shutdown(wait=False, cancel_futures=True)

    grouped = _build_groups(all_records)
    ranked = _rank_records(grouped, normalized_query)
    filtered = _filter_availability(ranked, availability_filter)
    if not filtered:
        cached_items = _search_cached_items(connection, normalized_query, availability_filter, pool_size)
        if cached_items:
            filtered = cached_items
            source_payloads["cache"] = {"count": len(cached_items), "reason": "item_cache_fallback"}
    start_index = max(0, (normalized_page - 1) * BOOK_PAGE_SIZE)
    end_index = start_index + BOOK_PAGE_SIZE
    all_items = [_public_record(record) for record in filtered]
    page_items = all_items[start_index:end_index]

    for record in filtered:
        _cache_write(
            connection,
            "book_item_cache",
            "book_id",
            record["id"],
            _public_record(record),
            record.get("_raw_sources"),
            ITEM_TTL_MS,
        )

    payload = {
        "allItems": all_items,
        "query": normalized_query,
        "availability": availability_filter,
        "sources": {name: _summarize_source_payload(raw) for name, raw in source_payloads.items()},
    }
    _cache_write(connection, "book_search_cache", "cache_key", cache_key, payload, source_payloads, SEARCH_TTL_MS)
    return {
        "items": page_items,
        "page": normalized_page,
        "query": normalized_query,
        "availability": availability_filter,
        "hasMore": end_index < len(all_items),
        "sources": payload["sources"],
    }


def get_book_item(connection, book_id: str, google_books_api_key: Optional[str] = None) -> Optional[Dict[str, Any]]:
    cached = _cache_read(connection, "book_item_cache", "book_id", book_id)
    if cached:
        hydrated = _rehydrate_cached_record(cached["payload"], cached.get("raw"))
        enriched = _enrich_record_downloads(hydrated)
        if enriched != cached["payload"]:
            _cache_write(connection, "book_item_cache", "book_id", book_id, enriched, cached.get("raw"), ITEM_TTL_MS)
        return _resolve_loan_access(connection, enriched)

    if ":" not in book_id:
        return None
    source, source_key = book_id.split(":", 1)
    record = None
    if source == "gutendex":
        record = _fetch_gutendex_item(source_key)
    elif source == "google":
        record = _fetch_google_item(source_key, google_books_api_key)
    elif source == "openlibrary":
        record = _fetch_openlibrary_item(source_key)
    elif source == "se":
        record = _fetch_standard_ebooks_item(source_key)

    if not record:
        return None
    record = _enrich_record_downloads(record)
    payload = _public_record(record)
    _cache_write(connection, "book_item_cache", "book_id", book_id, payload, record.get("_raw_source"), ITEM_TTL_MS)
    return _resolve_loan_access(connection, payload)


def get_book_read(connection, book_id: str, google_books_api_key: Optional[str] = None) -> Optional[Dict[str, Any]]:
    item = get_book_item(connection, book_id, google_books_api_key)
    if not item:
        return None

    loan_payload = _cached_loan_access(connection, book_id)
    scan_manifest = None
    loan_status = (loan_payload or {}).get("payload", {}).get("loanStatus", {}) if loan_payload else {}
    if loan_status.get("active"):
        scan_manifest = (loan_payload.get("payload") or {}).get("scanManifest")
    elif item.get("availability") != "borrow":
        scan_manifest = _get_scan_manifest(connection, item.get("identifiers") or {})
    selected_format = None
    proxy_url = None
    reader_mode = "external"
    renderable = bool(item.get("renderable"))
    render_mode = item.get("renderMode")
    preparing = bool(item.get("preparing"))
    reason = item.get("reason")
    embed_url = None
    archive_reader_url = None
    if scan_manifest:
        selected_format = "scan"
        reader_mode = "scan"
        renderable = True
        render_mode = "scan"
    elif item.get("downloadUrls"):
        download_order = (
            ("pdf", "epub", "html", "text")
            if item.get("loanStatus", {}).get("active") and item.get("loanStatus", {}).get("borrowedByServer")
            else ("epub", "html", "text", "pdf")
        )
        for candidate in download_order:
            if item["downloadUrls"].get(candidate):
                selected_format = candidate
                proxy_url = f"/api/books/content/{book_id}?format={candidate}"
                reader_mode = candidate
                renderable = True
                render_mode = candidate
                break
    elif loan_status.get("active") and _normalize_text(loan_status.get("provider")) == "archive.org":
        active_archive_id = _normalize_text(loan_status.get("archiveId"))
        embed_url = _archive_embed_url(active_archive_id)
        archive_reader_url = _archive_read_url(active_archive_id)
        if embed_url and archive_reader_url:
            selected_format = "archive-embed"
            reader_mode = "archive-embed"
            renderable = True
            render_mode = "archive-embed"

    payload = dict(item)
    payload["readerMode"] = reader_mode
    payload["selectedFormat"] = selected_format
    payload["proxyUrl"] = proxy_url
    payload["renderable"] = renderable
    payload["renderMode"] = render_mode
    payload["preparing"] = preparing
    payload["reason"] = reason
    payload["embedUrl"] = embed_url
    if archive_reader_url:
        payload["readerUrl"] = archive_reader_url
        payload["readerSourceLabel"] = "Internet Archive"
        payload["actions"] = [{"label": "Open on Archive", "kind": "external", "url": archive_reader_url}]
    payload["scanManifest"] = (
        {
            "archiveId": scan_manifest["identifier"],
            "pageCount": scan_manifest["pageCount"],
            "source": scan_manifest.get("source") or "iiif",
            "behavior": scan_manifest.get("behavior") or [],
            "viewingDirection": scan_manifest.get("viewingDirection") or "left-to-right",
        }
        if scan_manifest
        else None
    )
    return payload


def get_book_pages(
    connection,
    book_id: str,
    start: int,
    end: int,
    width: Optional[int] = None,
    google_books_api_key: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    item = get_book_item(connection, book_id, google_books_api_key)
    if not item:
        return None
    loan_payload = _cached_loan_access(connection, book_id)
    scan_manifest = None
    loan_status = (loan_payload or {}).get("payload", {}).get("loanStatus", {}) if loan_payload else {}
    if loan_status.get("active"):
        scan_manifest = (loan_payload.get("payload") or {}).get("scanManifest")
    elif item.get("availability") != "borrow":
        scan_manifest = _get_scan_manifest(connection, item.get("identifiers") or {})
    if not scan_manifest:
        return None

    total_pages = _coerce_positive_int(scan_manifest.get("pageCount"))
    if total_pages <= 0:
        return None

    start_index = max(0, min(start, total_pages - 1))
    end_index = max(start_index, min(end, total_pages - 1))
    render_width = max(SCAN_IMAGE_WIDTH_MIN, min(SCAN_IMAGE_WIDTH_MAX, int(width or SCAN_DEFAULT_IMAGE_WIDTH)))
    pages = []
    for page in scan_manifest.get("pages") or []:
        page_index = _coerce_positive_int(page.get("index"))
        if page_index < start_index or page_index > end_index:
            continue
        page_payload = {
            "index": page_index,
            "label": page.get("label") or str(page_index + 1),
            "width": _coerce_positive_int(page.get("width")),
            "height": _coerce_positive_int(page.get("height")),
            "imageUrl": f"/api/books/page-image/{quote(book_id, safe='')}?page={page_index}&width={render_width}",
        }
        pages.append(page_payload)

    return {
        "bookId": book_id,
        "archiveId": scan_manifest.get("identifier"),
        "source": scan_manifest.get("source") or "iiif",
        "start": start_index,
        "end": end_index,
        "totalPages": total_pages,
        "width": render_width,
        "pages": pages,
    }


def fetch_book_asset(connection, book_id: str, format_name: str, google_books_api_key: Optional[str] = None) -> Optional[requests.Response]:
    item = get_book_item(connection, book_id, google_books_api_key)
    if not item:
        return None
    url = _safe_https((item.get("downloadUrls") or {}).get(format_name))
    if not url:
        return None
    loan_payload = _cached_loan_access(connection, book_id)
    session = None
    if loan_payload and loan_payload["payload"].get("loanStatus", {}).get("active"):
        session, _ = _archive_login_session()
    return _request_binary(url, session=session)


def fetch_book_page_image(
    connection,
    book_id: str,
    page_index: int,
    width: Optional[int] = None,
    google_books_api_key: Optional[str] = None,
) -> Optional[requests.Response]:
    item = get_book_item(connection, book_id, google_books_api_key)
    if not item:
        return None

    loan_payload = _cached_loan_access(connection, book_id)
    session = None
    scan_manifest = None
    loan_status = (loan_payload or {}).get("payload", {}).get("loanStatus", {}) if loan_payload else {}
    if loan_status.get("active"):
        session, _ = _archive_login_session()
        scan_manifest = (loan_payload.get("payload") or {}).get("scanManifest")
    elif item.get("availability") != "borrow":
        scan_manifest = _get_scan_manifest(connection, item.get("identifiers") or {})
    if not scan_manifest:
        return None

    for page in scan_manifest.get("pages") or []:
        if _coerce_positive_int(page.get("index")) != max(0, int(page_index or 0)):
            continue
        target = _iiif_image_url(page.get("serviceUrl"), width) or _safe_https(page.get("directUrl"))
        if not target:
            return None
        return _request_binary(target, timeout=(4, 20), session=session)
    return None
