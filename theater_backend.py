import json
import secrets
import sqlite3
import time
from dataclasses import dataclass
from typing import Any, Dict, List, Optional

ROOM_INACTIVE_MS = 12 * 60 * 60 * 1000
MEMBER_ONLINE_MS = 90 * 1000
HOST_OFFLINE_CLOSE_MS = 5 * 60 * 1000
MAX_CHAT_MESSAGES = 120
COMMAND_READY_STATES = {"ready", "loaded", "prepared"}


class TheaterError(Exception):
    def __init__(self, error: str, status: int = 400, detail: Optional[str] = None):
        super().__init__(detail or error)
        self.error = error
        self.status = status
        self.detail = detail


@dataclass
class TheaterMember:
    room_id: str
    member_id: str
    member_token: str
    role: str
    display_name: str
    last_seen_at: int


def _now_ms() -> int:
    return int(time.time() * 1000)


def _json_dump(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=True)


def _json_load(raw_value: Any, fallback: Any) -> Any:
    if raw_value in (None, ""):
        return fallback
    try:
        return json.loads(raw_value)
    except (TypeError, ValueError, json.JSONDecodeError):
        return fallback


def _clean_name(value: Any, fallback: str = "Guest") -> str:
    if not isinstance(value, str):
        return fallback
    cleaned = " ".join(value.strip().split())
    if not cleaned:
        return fallback
    return cleaned[:40]


def _optional_text(value: Any, limit: int = 280) -> Optional[str]:
    if not isinstance(value, str):
        return None
    cleaned = " ".join(value.strip().split())
    if not cleaned:
        return None
    return cleaned[:limit]


def _ensure_column(connection: sqlite3.Connection, table: str, column: str, definition: str) -> None:
    columns = {
        row["name"]
        for row in connection.execute(f"PRAGMA table_info({table})").fetchall()
    }
    if column not in columns:
        connection.execute(f"ALTER TABLE {table} ADD COLUMN {column} {definition}")


def ensure_theater_tables(connection: sqlite3.Connection) -> None:
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS theater_rooms (
            room_id TEXT PRIMARY KEY,
            invite_token TEXT NOT NULL,
            host_token TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            current_media_json TEXT,
            playback_json TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            last_activity_at INTEGER NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS theater_members (
            room_id TEXT NOT NULL,
            member_id TEXT NOT NULL,
            member_token TEXT NOT NULL UNIQUE,
            role TEXT NOT NULL,
            display_name TEXT NOT NULL,
            last_seen_at INTEGER NOT NULL,
            PRIMARY KEY (room_id, member_id)
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS theater_suggestions (
            suggestion_id TEXT PRIMARY KEY,
            room_id TEXT NOT NULL,
            tmdb_id TEXT NOT NULL,
            mode TEXT NOT NULL,
            title TEXT NOT NULL,
            poster TEXT,
            backdrop TEXT,
            release_label TEXT,
            suggested_by TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            selected_at INTEGER
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS theater_votes (
            room_id TEXT NOT NULL,
            suggestion_id TEXT NOT NULL,
            member_id TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            PRIMARY KEY (suggestion_id, member_id)
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS theater_events (
            event_id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )
        """
    )
    connection.execute(
        """
        CREATE TABLE IF NOT EXISTS theater_chat_messages (
            message_id TEXT PRIMARY KEY,
            room_id TEXT NOT NULL,
            member_id TEXT NOT NULL,
            display_name TEXT NOT NULL,
            body TEXT NOT NULL,
            created_at INTEGER NOT NULL
        )
        """
    )
    _ensure_column(connection, "theater_rooms", "invite_key", "TEXT")
    _ensure_column(connection, "theater_rooms", "close_reason", "TEXT")
    _ensure_column(connection, "theater_members", "joined_at", "INTEGER")
    _ensure_column(connection, "theater_suggestions", "season", "INTEGER")
    _ensure_column(connection, "theater_suggestions", "episode", "INTEGER")
    _ensure_column(connection, "theater_suggestions", "episode_title", "TEXT")
    _ensure_column(connection, "theater_suggestions", "show_title", "TEXT")
    connection.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_theater_rooms_invite_key ON theater_rooms(invite_key)"
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_theater_events_room_id_event_id ON theater_events(room_id, event_id)"
    )
    connection.execute(
        "CREATE INDEX IF NOT EXISTS idx_theater_chat_room_created ON theater_chat_messages(room_id, created_at)"
    )
    connection.execute(
        "UPDATE theater_rooms SET invite_key = invite_token WHERE invite_key IS NULL OR invite_key = ''"
    )


def _read_room_by_reference(connection: sqlite3.Connection, room_ref: str) -> Optional[sqlite3.Row]:
    ref = str(room_ref or "").strip()
    if not ref:
        return None
    return connection.execute(
        """
        SELECT *
        FROM theater_rooms
        WHERE room_id = ?
           OR invite_key = ?
           OR invite_token = ?
        LIMIT 1
        """,
        (ref, ref, ref),
    ).fetchone()


def _read_member_by_token(connection: sqlite3.Connection, room_id: str, member_token: str) -> Optional[sqlite3.Row]:
    return connection.execute(
        """
        SELECT *
        FROM theater_members
        WHERE room_id = ? AND member_token = ?
        LIMIT 1
        """,
        (room_id, str(member_token or "").strip()),
    ).fetchone()


def _read_host_member(connection: sqlite3.Connection, room_id: str) -> Optional[sqlite3.Row]:
    return connection.execute(
        """
        SELECT *
        FROM theater_members
        WHERE room_id = ? AND role = 'host'
        LIMIT 1
        """,
        (room_id,),
    ).fetchone()


def _read_suggestion(connection: sqlite3.Connection, room_id: str, suggestion_id: Any) -> Optional[sqlite3.Row]:
    return connection.execute(
        """
        SELECT *
        FROM theater_suggestions
        WHERE room_id = ? AND suggestion_id = ?
        LIMIT 1
        """,
        (room_id, str(suggestion_id or "").strip()),
    ).fetchone()


def _normalize_media_payload(media: Any) -> Dict[str, Any]:
    if not isinstance(media, dict):
        raise TheaterError("invalid_media", 400, "A movie or episode payload is required.")
    mode = str(media.get("mode") or "").strip().lower()
    if mode not in {"movie", "tv"}:
        raise TheaterError("invalid_media", 400, "Media mode must be movie or tv.")
    tmdb = str(media.get("tmdb") or "").strip()
    if not tmdb:
        raise TheaterError("invalid_media", 400, "TMDB id is required.")

    title = _optional_text(media.get("title"), 140)
    poster = _optional_text(media.get("poster"), 500)
    backdrop = _optional_text(media.get("backdrop"), 500)
    release_label = _optional_text(media.get("releaseLabel"), 80)
    payload: Dict[str, Any] = {
        "mode": mode,
        "tmdb": tmdb,
        "title": title or ("Movie" if mode == "movie" else "Episode"),
        "poster": poster,
        "backdrop": backdrop,
        "releaseLabel": release_label,
    }
    playback_url = _optional_text(media.get("playbackUrl") or media.get("streamUrl"), 1000)
    source_kind = _optional_text(media.get("sourceKind"), 40)
    if playback_url:
        payload["playbackUrl"] = playback_url
    if source_kind:
        payload["sourceKind"] = source_kind
    if mode == "tv":
        try:
            season = max(1, int(media.get("season")))
            episode = max(1, int(media.get("episode")))
        except (TypeError, ValueError):
            raise TheaterError("invalid_media", 400, "TV selections need a season and episode.")
        payload["season"] = season
        payload["episode"] = episode
        payload["showTitle"] = _optional_text(media.get("showTitle"), 140) or payload["title"]
        payload["episodeTitle"] = _optional_text(media.get("episodeTitle"), 140) or payload["title"]
        if not title:
            payload["title"] = f"{payload['showTitle']} S{season}E{episode}"
    return payload


def _normalize_playback_payload(payload: Any, *, now: Optional[int] = None) -> Dict[str, Any]:
    source = payload if isinstance(payload, dict) else {}
    current_time = 0.0
    try:
        current_time = max(0.0, float(source.get("currentTime") or 0))
    except (TypeError, ValueError):
        current_time = 0.0
    sent_at = source.get("sentAt")
    try:
        sent_at_value = int(sent_at)
    except (TypeError, ValueError):
        sent_at_value = now or _now_ms()
    playback_mode = str(source.get("playbackMode") or "").strip().lower()
    if playback_mode != "controlled":
        playback_mode = "controlled"
    playback_version = source.get("playbackVersion")
    try:
        playback_version_value = max(1, int(playback_version))
    except (TypeError, ValueError):
        playback_version_value = 1
    pending_start = bool(source.get("pendingStart"))
    started_at = source.get("startedAt")
    try:
        started_at_value = max(0, int(started_at))
    except (TypeError, ValueError):
        started_at_value = 0
    sync_health = _optional_text(source.get("syncHealth"), 40) or "controlled"
    host_transport_state = _optional_text(source.get("hostTransportState"), 40) or (
        "paused" if bool(source.get("paused")) else "playing"
    )
    source_session_id = _optional_text(source.get("sourceSessionId"), 80)
    playback_url = _optional_text(source.get("playbackUrl"), 1000)
    command_id = _optional_text(source.get("commandId"), 80)
    command_type = _optional_text(source.get("commandType"), 40)
    command_status = _optional_text(source.get("commandStatus"), 40) or ("ready" if not command_id else "waiting")
    try:
        target_time_value = max(0.0, float(source.get("targetTime") or current_time))
    except (TypeError, ValueError):
        target_time_value = current_time
    raw_ready_members = source.get("readyMembers")
    ready_members: Dict[str, Dict[str, Any]] = {}
    if isinstance(raw_ready_members, dict):
        for member_id, member_state in raw_ready_members.items():
            normalized_member_id = _optional_text(member_id, 80)
            if not normalized_member_id:
                continue
            if isinstance(member_state, dict):
                status_value = _optional_text(member_state.get("status"), 40) or "ready"
                try:
                    ack_at_value = int(member_state.get("ackAt") or 0)
                except (TypeError, ValueError):
                    ack_at_value = 0
                try:
                    ready_time_value = max(0.0, float(member_state.get("currentTime") or 0))
                except (TypeError, ValueError):
                    ready_time_value = 0.0
            else:
                status_value = "ready"
                ack_at_value = 0
                ready_time_value = 0.0
            ready_members[normalized_member_id] = {
                "status": status_value,
                "ackAt": ack_at_value,
                "currentTime": round(ready_time_value, 3),
            }
    return {
        "currentTime": round(current_time, 3),
        "paused": bool(source.get("paused")),
        "serverId": _optional_text(source.get("serverId"), 80),
        "sentAt": sent_at_value,
        "event": _optional_text(source.get("event"), 40) or "update",
        "playbackMode": playback_mode,
        "playbackVersion": playback_version_value,
        "pendingStart": pending_start,
        "startedAt": started_at_value or None,
        "syncHealth": sync_health,
        "hostTransportState": host_transport_state,
        "sourceSessionId": source_session_id,
        "playbackUrl": playback_url,
        "commandId": command_id,
        "commandType": command_type,
        "targetTime": round(target_time_value, 3),
        "commandStatus": command_status,
        "readyMembers": ready_members,
    }


def _infer_playback_mode(media: Optional[Dict[str, Any]]) -> str:
    return "controlled"


def _build_selected_playback(media: Optional[Dict[str, Any]], now: int) -> Dict[str, Any]:
    playback_mode = "controlled"
    playback_url = None
    if isinstance(media, dict):
        playback_url = _optional_text(media.get("playbackUrl") or media.get("streamUrl"), 1000)
    return {
        "currentTime": 0,
        "paused": True,
        "serverId": None,
        "sentAt": now,
        "event": "select",
        "playbackMode": playback_mode,
        "playbackVersion": 1,
        "pendingStart": True,
        "startedAt": None,
        "syncHealth": "controlled",
        "hostTransportState": "selected",
        "sourceSessionId": f"theater_{secrets.token_hex(8)}",
        "playbackUrl": playback_url,
        "commandId": f"command_{secrets.token_hex(8)}",
        "commandType": "load",
        "targetTime": 0,
        "commandStatus": "waiting",
        "readyMembers": {},
    }


def _online_member_ids(connection: sqlite3.Connection, room_id: str, now: int) -> List[str]:
    rows = connection.execute(
        """
        SELECT member_id, last_seen_at
        FROM theater_members
        WHERE room_id = ?
        """,
        (room_id,),
    ).fetchall()
    return [
        row["member_id"]
        for row in rows
        if now - int(row["last_seen_at"] or 0) <= MEMBER_ONLINE_MS
    ]


def _build_command_summary(
    connection: sqlite3.Connection,
    room_id: str,
    playback: Dict[str, Any],
    now: int,
) -> Dict[str, Any]:
    normalized = _normalize_playback_payload(playback, now=now)
    command_id = normalized.get("commandId")
    ready_members = normalized.get("readyMembers") or {}
    online_member_ids = _online_member_ids(connection, room_id, now)
    waiting_member_ids = [
        member_id
        for member_id in online_member_ids
        if str((ready_members.get(member_id) or {}).get("status") or "").lower() not in COMMAND_READY_STATES
    ]
    command_status = "ready"
    if command_id:
        command_status = "waiting" if waiting_member_ids else "ready"
    return {
        "commandId": command_id,
        "commandType": normalized.get("commandType"),
        "targetTime": normalized.get("targetTime"),
        "commandStatus": command_status,
        "readyMembers": ready_members,
        "requiredMemberIds": online_member_ids,
        "waitingMemberIds": waiting_member_ids,
        "readyCount": len(online_member_ids) - len(waiting_member_ids),
        "requiredCount": len(online_member_ids),
    }


def _mark_command_ready(
    playback: Dict[str, Any],
    member_id: str,
    now: int,
    *,
    status: str = "ready",
    current_time: float = 0.0,
) -> Dict[str, Any]:
    normalized = _normalize_playback_payload(playback, now=now)
    command_id = normalized.get("commandId")
    if not command_id or not member_id:
        return normalized
    ready_members = dict(normalized.get("readyMembers") or {})
    ready_members[member_id] = {
        "status": _optional_text(status, 40) or "ready",
        "ackAt": now,
        "currentTime": round(max(0.0, float(current_time or 0.0)), 3),
    }
    normalized["readyMembers"] = ready_members
    return normalized


def _start_command(
    existing_playback: Dict[str, Any],
    command_type: str,
    now: int,
    target_time: float,
    host_member_id: Optional[str] = None,
) -> Dict[str, Any]:
    normalized = _normalize_playback_payload(existing_playback, now=now)
    normalized["commandId"] = f"command_{secrets.token_hex(8)}"
    normalized["commandType"] = command_type
    normalized["targetTime"] = round(max(0.0, float(target_time or 0.0)), 3)
    normalized["commandStatus"] = "waiting"
    normalized["readyMembers"] = {}
    if host_member_id:
        normalized = _mark_command_ready(
            normalized,
            host_member_id,
            now,
            status="ready",
            current_time=normalized["targetTime"],
        )
    return normalized


def _merge_playback_update(
    existing: Any,
    source: Any,
    media: Optional[Dict[str, Any]],
    now: int,
    *,
    host_member_id: Optional[str] = None,
) -> Dict[str, Any]:
    existing_playback = _normalize_playback_payload(existing, now=now)
    incoming = _normalize_playback_payload(source, now=now)
    playback_mode = "controlled"
    event_name = incoming.get("event") or "update"
    paused = bool(incoming.get("paused"))
    pending_start = bool(existing_playback.get("pendingStart"))
    started_at = existing_playback.get("startedAt")
    host_transport_state = incoming.get("hostTransportState")
    existing_time = float(existing_playback.get("currentTime") or 0.0)
    incoming_time = float(incoming.get("currentTime") or 0.0)
    time_jump_seconds = abs(incoming_time - existing_time)
    initial_pending_pause = (
        pending_start
        and event_name == "pause"
        and incoming_time <= 1.5
    )
    if initial_pending_pause:
        event_name = "ready"
        paused = True
    synthesized_seek = (
        event_name in {"play", "timeupdate", "update"}
        and not pending_start
        and not paused
        and time_jump_seconds >= 8.0
    )
    if synthesized_seek:
        event_name = "seeked"
        host_transport_state = "seeking"

    if event_name in {"select", "ready"}:
        paused = True
        pending_start = True
        host_transport_state = "ready" if event_name == "ready" else "selected"
    elif event_name in {"play", "timeupdate"} and not paused:
        pending_start = False
        if not started_at:
            started_at = now
        host_transport_state = "playing"
    elif event_name in {"seek", "seeking", "seeked"}:
        if pending_start:
            paused = True
            host_transport_state = "seeking"
        else:
            host_transport_state = "seeking"
    elif event_name == "pause":
        pending_start = False
        host_transport_state = "paused"
    elif event_name == "ended":
        pending_start = False
        paused = True
        host_transport_state = "ended"

    next_version = max(
        1,
        int(existing_playback.get("playbackVersion") or 1) + 1,
        int(incoming.get("playbackVersion") or 1),
    )
    playback_url = incoming.get("playbackUrl") or existing_playback.get("playbackUrl")
    source_session_id = incoming.get("sourceSessionId") or existing_playback.get("sourceSessionId")
    sync_health = incoming.get("syncHealth") or existing_playback.get("syncHealth") or "controlled"

    merged = {
        "currentTime": incoming.get("currentTime", existing_playback.get("currentTime", 0)),
        "paused": paused,
        "serverId": incoming.get("serverId") or existing_playback.get("serverId"),
        "sentAt": int(incoming.get("sentAt") or now),
        "event": event_name,
        "playbackMode": playback_mode,
        "playbackVersion": next_version,
        "pendingStart": pending_start,
        "startedAt": started_at,
        "syncHealth": sync_health,
        "hostTransportState": host_transport_state or ("paused" if paused else "playing"),
        "sourceSessionId": source_session_id,
        "playbackUrl": playback_url,
        "commandId": existing_playback.get("commandId"),
        "commandType": existing_playback.get("commandType"),
        "targetTime": existing_playback.get("targetTime", incoming.get("currentTime", 0)),
        "commandStatus": existing_playback.get("commandStatus") or "ready",
        "readyMembers": existing_playback.get("readyMembers") or {},
    }
    if event_name == "ready":
        merged = _mark_command_ready(
            merged,
            host_member_id or "",
            now,
            status="ready",
            current_time=merged.get("currentTime") or 0,
        )
    elif event_name == "play":
        merged = _start_command(
            merged,
            "play",
            now,
            merged.get("currentTime") or 0,
            host_member_id=host_member_id,
        )
    elif event_name == "pause":
        merged = _start_command(
            merged,
            "pause",
            now,
            merged.get("currentTime") or 0,
            host_member_id=host_member_id,
        )
    elif event_name in {"seek", "seeking", "seeked"}:
        merged = _start_command(
            merged,
            "seek",
            now,
            merged.get("currentTime") or 0,
            host_member_id=host_member_id,
        )
    elif event_name == "ended":
        merged = _start_command(
            merged,
            "ended",
            now,
            merged.get("currentTime") or 0,
            host_member_id=host_member_id,
        )
    return merged


def _append_event(
    connection: sqlite3.Connection,
    room_id: str,
    event_type: str,
    payload: Optional[Dict[str, Any]] = None,
    *,
    created_at: Optional[int] = None,
) -> int:
    timestamp = created_at or _now_ms()
    cursor = connection.execute(
        """
        INSERT INTO theater_events (room_id, event_type, payload_json, created_at)
        VALUES (?, ?, ?, ?)
        """,
        (room_id, event_type, _json_dump(payload or {}), timestamp),
    )
    return int(cursor.lastrowid)


def _touch_room(connection: sqlite3.Connection, room_id: str, *, now: Optional[int] = None) -> int:
    timestamp = now or _now_ms()
    connection.execute(
        """
        UPDATE theater_rooms
        SET updated_at = ?, last_activity_at = ?
        WHERE room_id = ?
        """,
        (timestamp, timestamp, room_id),
    )
    return timestamp


def _truncate_chat(connection: sqlite3.Connection, room_id: str) -> None:
    count_row = connection.execute(
        "SELECT COUNT(*) AS count FROM theater_chat_messages WHERE room_id = ?",
        (room_id,),
    ).fetchone()
    total = int(count_row["count"]) if count_row else 0
    if total <= MAX_CHAT_MESSAGES:
        return
    overflow = total - MAX_CHAT_MESSAGES
    connection.execute(
        """
        DELETE FROM theater_chat_messages
        WHERE message_id IN (
            SELECT message_id
            FROM theater_chat_messages
            WHERE room_id = ?
            ORDER BY created_at ASC
            LIMIT ?
        )
        """,
        (room_id, overflow),
    )


def _close_room(
    connection: sqlite3.Connection,
    room_id: str,
    reason: str,
    *,
    created_at: Optional[int] = None,
) -> None:
    room = _read_room_by_reference(connection, room_id)
    if not room or room["status"] in {"closed", "expired"}:
        return
    timestamp = created_at or _now_ms()
    connection.execute(
        """
        UPDATE theater_rooms
        SET status = 'closed',
            close_reason = ?,
            updated_at = ?,
            last_activity_at = ?
        WHERE room_id = ?
        """,
        (reason, timestamp, timestamp, room["room_id"]),
    )
    _append_event(
        connection,
        room["room_id"],
        "room_closed",
        {"roomClosed": True, "closeReason": reason},
        created_at=timestamp,
    )
    connection.execute("DELETE FROM theater_chat_messages WHERE room_id = ?", (room["room_id"],))


def _expire_room(connection: sqlite3.Connection, room_id: str, *, created_at: Optional[int] = None) -> None:
    room = _read_room_by_reference(connection, room_id)
    if not room or room["status"] == "expired":
        return
    timestamp = created_at or _now_ms()
    connection.execute(
        """
        UPDATE theater_rooms
        SET status = 'expired',
            close_reason = 'expired',
            updated_at = ?,
            last_activity_at = ?
        WHERE room_id = ?
        """,
        (timestamp, timestamp, room["room_id"]),
    )
    _append_event(
        connection,
        room["room_id"],
        "room_expired",
        {"roomClosed": True, "closeReason": "expired"},
        created_at=timestamp,
    )
    connection.execute("DELETE FROM theater_chat_messages WHERE room_id = ?", (room["room_id"],))


def _require_active_room(
    connection: sqlite3.Connection,
    room_ref: str,
    *,
    now: Optional[int] = None,
) -> sqlite3.Row:
    room = _read_room_by_reference(connection, room_ref)
    if not room:
        raise TheaterError("room_not_found", 404, "That theater could not be found.")

    timestamp = now or _now_ms()
    if room["status"] == "expired":
        raise TheaterError("room_expired", 410, "This theater expired from inactivity.")
    if room["status"] == "closed":
        detail = room["close_reason"] or "lost_connection"
        raise TheaterError("room_closed", 410, detail)

    last_activity_at = int(room["last_activity_at"] or 0)
    if last_activity_at and timestamp - last_activity_at >= ROOM_INACTIVE_MS:
        _expire_room(connection, room["room_id"], created_at=timestamp)
        raise TheaterError("room_expired", 410, "This theater expired from inactivity.")

    host = _read_host_member(connection, room["room_id"])
    if host and timestamp - int(host["last_seen_at"] or 0) >= HOST_OFFLINE_CLOSE_MS:
        _close_room(connection, room["room_id"], "lost_connection", created_at=timestamp)
        raise TheaterError("room_closed", 410, "lost_connection")

    return _read_room_by_reference(connection, room["room_id"]) or room


def _require_member(connection: sqlite3.Connection, room_ref: str, member_token: Optional[str]) -> sqlite3.Row:
    room = _require_active_room(connection, room_ref)
    token = str(member_token or "").strip()
    if not token:
        raise TheaterError("unauthorized", 401, "A theater member token is required.")
    member = _read_member_by_token(connection, room["room_id"], token)
    if not member:
        raise TheaterError("unauthorized", 403, "You are not part of this theater.")
    return member


def _require_host(connection: sqlite3.Connection, room_ref: str, host_token: Optional[str]) -> sqlite3.Row:
    # Read room state directly first so we can verify the token before the offline check
    raw_room = _read_room_by_reference(connection, room_ref)
    if not raw_room:
        raise TheaterError("room_not_found", 404, "That theater could not be found.")
    if raw_room["status"] == "expired":
        raise TheaterError("room_expired", 410, "This theater expired from inactivity.")
    if raw_room["status"] == "closed":
        detail = raw_room["close_reason"] or "lost_connection"
        raise TheaterError("room_closed", 410, detail)

    token = str(host_token or "").strip()
    if not token:
        raise TheaterError("unauthorized", 401, "A host token is required.")
    if token != str(raw_room["host_token"]):
        raise TheaterError("host_only", 403, "Only the host can control this theater.")

    host = _read_host_member(connection, raw_room["room_id"])
    if not host:
        raise TheaterError("host_only", 403, "This theater no longer has an active host.")

    # Providing a valid host token counts as presence — refresh before the offline check
    # so that an active seek/playback update never triggers an auto-close.
    now = _now_ms()
    connection.execute(
        "UPDATE theater_members SET last_seen_at = ? WHERE room_id = ? AND member_id = ?",
        (now, raw_room["room_id"], host["member_id"]),
    )

    # Run the full active-room check now that host is no longer stale
    _require_active_room(connection, raw_room["room_id"], now=now)
    return host


def _serialize_room_state(
    connection: sqlite3.Connection,
    room: sqlite3.Row,
    *,
    viewer_member_id: Optional[str] = None,
) -> Dict[str, Any]:
    room_id = room["room_id"]
    now = _now_ms()
    members = []
    host_online = False
    for row in connection.execute(
        """
        SELECT member_id, role, display_name, last_seen_at
        FROM theater_members
        WHERE room_id = ?
        ORDER BY CASE WHEN role = 'host' THEN 0 ELSE 1 END, last_seen_at DESC, display_name COLLATE NOCASE
        """,
        (room_id,),
    ).fetchall():
        online = now - int(row["last_seen_at"] or 0) <= MEMBER_ONLINE_MS
        if row["role"] == "host":
            host_online = online
        members.append(
            {
                "memberId": row["member_id"],
                "role": row["role"],
                "displayName": row["display_name"],
                "online": online,
                "lastSeenAt": int(row["last_seen_at"] or 0),
            }
        )

    vote_rows = connection.execute(
        """
        SELECT suggestion_id, member_id
        FROM theater_votes
        WHERE room_id = ?
        """,
        (room_id,),
    ).fetchall()
    votes_by_suggestion: Dict[str, set] = {}
    for row in vote_rows:
        votes_by_suggestion.setdefault(row["suggestion_id"], set()).add(row["member_id"])

    suggestions = []
    for row in connection.execute(
        """
        SELECT s.*, m.display_name AS suggested_by_name
        FROM theater_suggestions s
        LEFT JOIN theater_members m
            ON m.room_id = s.room_id AND m.member_id = s.suggested_by
        WHERE s.room_id = ?
        ORDER BY (s.selected_at IS NOT NULL) DESC, COALESCE(s.selected_at, 0) DESC, s.created_at DESC
        """,
        (room_id,),
    ).fetchall():
        voters = votes_by_suggestion.get(row["suggestion_id"], set())
        suggestions.append(
            {
                "suggestionId": row["suggestion_id"],
                "tmdb": row["tmdb_id"],
                "mode": row["mode"],
                "title": row["title"],
                "poster": row["poster"],
                "backdrop": row["backdrop"],
                "releaseLabel": row["release_label"],
                "showTitle": row["show_title"],
                "season": row["season"],
                "episode": row["episode"],
                "episodeTitle": row["episode_title"],
                "suggestedBy": row["suggested_by"],
                "suggestedByName": row["suggested_by_name"] or "Guest",
                "createdAt": int(row["created_at"] or 0),
                "selectedAt": int(row["selected_at"] or 0) if row["selected_at"] else None,
                "voteCount": len(voters),
                "viewerHasVoted": viewer_member_id in voters if viewer_member_id else False,
            }
        )

    chat_messages = []
    for row in connection.execute(
        """
        SELECT message_id, member_id, display_name, body, created_at
        FROM theater_chat_messages
        WHERE room_id = ?
        ORDER BY created_at ASC
        """,
        (room_id,),
    ).fetchall():
        chat_messages.append(
            {
                "messageId": row["message_id"],
                "memberId": row["member_id"],
                "displayName": row["display_name"],
                "body": row["body"],
                "createdAt": int(row["created_at"] or 0),
            }
        )

    last_event = connection.execute(
        "SELECT MAX(event_id) AS last_event_id FROM theater_events WHERE room_id = ?",
        (room_id,),
    ).fetchone()
    playback = _json_load(room["playback_json"], {}) or {}
    playback = {
        **playback,
        **_build_command_summary(connection, room_id, playback, now),
    }
    return {
        "roomId": room_id,
        "inviteKey": room["invite_key"] or room["invite_token"],
        "inviteToken": room["invite_token"],
        "status": room["status"],
        "roomClosed": room["status"] in {"closed", "expired"},
        "closeReason": room["close_reason"],
        "currentMedia": _json_load(room["current_media_json"], None),
        "playback": playback,
        "playbackMode": playback.get("playbackMode") or _infer_playback_mode(_json_load(room["current_media_json"], None)),
        "playbackVersion": int(playback.get("playbackVersion") or 0),
        "pendingStart": bool(playback.get("pendingStart")),
        "startedAt": playback.get("startedAt"),
        "syncHealth": playback.get("syncHealth"),
        "sourceSessionId": playback.get("sourceSessionId"),
        "lastEventId": int(last_event["last_event_id"] or 0) if last_event else 0,
        "hostOnline": host_online,
        "members": members,
        "suggestions": suggestions,
        "chatMessages": chat_messages,
        "updatedAt": int(room["updated_at"] or 0),
        "lastActivityAt": int(room["last_activity_at"] or 0),
    }


def create_room(connection: sqlite3.Connection, display_name: Any = None) -> Dict[str, Any]:
    ensure_theater_tables(connection)
    now = _now_ms()
    room_id = secrets.token_urlsafe(6)
    invite_key = secrets.token_urlsafe(10)
    host_token = secrets.token_urlsafe(24)
    member_id = f"host_{secrets.token_hex(6)}"
    member_token = secrets.token_urlsafe(24)
    name = _clean_name(display_name, "Host")
    connection.execute(
        """
        INSERT INTO theater_rooms (
            room_id, invite_token, invite_key, host_token, status,
            current_media_json, playback_json, created_at, updated_at, last_activity_at, close_reason
        )
        VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, NULL)
        """,
        (room_id, invite_key, invite_key, host_token, "null", "{}", now, now, now),
    )
    connection.execute(
        """
        INSERT INTO theater_members (room_id, member_id, member_token, role, display_name, last_seen_at, joined_at)
        VALUES (?, ?, ?, 'host', ?, ?, ?)
        """,
        (room_id, member_id, member_token, name, now, now),
    )
    _append_event(
        connection,
        room_id,
        "member_joined",
        {
            "memberId": member_id,
            "role": "host",
            "displayName": name,
        },
        created_at=now,
    )
    room = _require_active_room(connection, room_id, now=now)
    return {
        "roomId": room_id,
        "inviteKey": invite_key,
        "inviteToken": invite_key,
        "hostToken": host_token,
        "memberToken": member_token,
        "memberId": member_id,
        "role": "host",
        "displayName": name,
        "state": _serialize_room_state(connection, room, viewer_member_id=member_id),
    }


def join_room(
    connection: sqlite3.Connection,
    room_ref: str,
    *,
    invite_token: Any = None,
    display_name: Any = None,
) -> Dict[str, Any]:
    ensure_theater_tables(connection)
    room = _require_active_room(connection, invite_token or room_ref)
    provided_invite = str(invite_token or room_ref or "").strip()
    actual_invite = str(room["invite_key"] or room["invite_token"])
    if provided_invite != actual_invite and provided_invite != str(room["invite_token"]):
        raise TheaterError("invalid_invite", 403, "That invite link is no longer valid.")

    now = _now_ms()
    member_id = f"guest_{secrets.token_hex(6)}"
    member_token = secrets.token_urlsafe(24)
    name = _clean_name(display_name, "Guest")
    connection.execute(
        """
        INSERT INTO theater_members (room_id, member_id, member_token, role, display_name, last_seen_at, joined_at)
        VALUES (?, ?, ?, 'guest', ?, ?, ?)
        """,
        (room["room_id"], member_id, member_token, name, now, now),
    )
    _touch_room(connection, room["room_id"], now=now)
    _append_event(
        connection,
        room["room_id"],
        "member_joined",
        {
            "memberId": member_id,
            "role": "guest",
            "displayName": name,
        },
        created_at=now,
    )
    current_room = _require_active_room(connection, room["room_id"], now=now)
    return {
        "roomId": current_room["room_id"],
        "inviteKey": actual_invite,
        "inviteToken": actual_invite,
        "memberToken": member_token,
        "memberId": member_id,
        "role": "guest",
        "displayName": name,
        "state": _serialize_room_state(connection, current_room, viewer_member_id=member_id),
    }


def get_room_state(
    connection: sqlite3.Connection,
    room_ref: str,
    *,
    member_token: Optional[str] = None,
) -> Dict[str, Any]:
    ensure_theater_tables(connection)
    member = _require_member(connection, room_ref, member_token)
    room = _require_active_room(connection, room_ref)
    return _serialize_room_state(connection, room, viewer_member_id=member["member_id"])


def add_suggestion(
    connection: sqlite3.Connection,
    room_ref: str,
    *,
    member_token: Optional[str] = None,
    media: Any = None,
) -> Dict[str, Any]:
    ensure_theater_tables(connection)
    member = _require_member(connection, room_ref, member_token)
    room = _require_active_room(connection, room_ref)
    payload = _normalize_media_payload(media)
    now = _now_ms()
    suggestion_id = secrets.token_urlsafe(10)
    connection.execute(
        """
        INSERT INTO theater_suggestions (
            suggestion_id, room_id, tmdb_id, mode, title, poster, backdrop, release_label,
            suggested_by, created_at, selected_at, season, episode, episode_title, show_title
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?)
        """,
        (
            suggestion_id,
            room["room_id"],
            payload["tmdb"],
            payload["mode"],
            payload["title"],
            payload.get("poster"),
            payload.get("backdrop"),
            payload.get("releaseLabel"),
            member["member_id"],
            now,
            payload.get("season"),
            payload.get("episode"),
            payload.get("episodeTitle"),
            payload.get("showTitle"),
        ),
    )
    _touch_room(connection, room["room_id"], now=now)
    _append_event(
        connection,
        room["room_id"],
        "suggestion_added",
        {
            "suggestionId": suggestion_id,
            "media": payload,
            "suggestedBy": member["member_id"],
            "suggestedByName": member["display_name"],
        },
        created_at=now,
    )
    current_room = _require_active_room(connection, room["room_id"], now=now)
    return {
        "suggestionId": suggestion_id,
        "state": _serialize_room_state(connection, current_room, viewer_member_id=member["member_id"]),
    }


def set_vote(
    connection: sqlite3.Connection,
    room_ref: str,
    *,
    member_token: Optional[str] = None,
    suggestion_id: Any = None,
    active: Any = None,
) -> Dict[str, Any]:
    ensure_theater_tables(connection)
    member = _require_member(connection, room_ref, member_token)
    room = _require_active_room(connection, room_ref)
    suggestion = _read_suggestion(connection, room["room_id"], suggestion_id)
    if not suggestion:
        raise TheaterError("suggestion_not_found", 404, "That suggestion could not be found.")

    now = _now_ms()
    if bool(active):
        connection.execute(
            """
            INSERT OR IGNORE INTO theater_votes (room_id, suggestion_id, member_id, created_at)
            VALUES (?, ?, ?, ?)
            """,
            (room["room_id"], suggestion["suggestion_id"], member["member_id"], now),
        )
    else:
        connection.execute(
            """
            DELETE FROM theater_votes
            WHERE room_id = ? AND suggestion_id = ? AND member_id = ?
            """,
            (room["room_id"], suggestion["suggestion_id"], member["member_id"]),
        )
    _touch_room(connection, room["room_id"], now=now)
    _append_event(
        connection,
        room["room_id"],
        "votes_updated",
        {
            "suggestionId": suggestion["suggestion_id"],
            "memberId": member["member_id"],
            "active": bool(active),
        },
        created_at=now,
    )
    current_room = _require_active_room(connection, room["room_id"], now=now)
    return _serialize_room_state(connection, current_room, viewer_member_id=member["member_id"])


def select_media(
    connection: sqlite3.Connection,
    room_ref: str,
    *,
    host_token: Optional[str] = None,
    suggestion_id: Any = None,
    media: Any = None,
) -> Dict[str, Any]:
    ensure_theater_tables(connection)
    host = _require_host(connection, room_ref, host_token)
    room = _require_active_room(connection, room_ref)
    now = _now_ms()

    selected_media = None
    selected_suggestion_id = None
    if suggestion_id:
        suggestion = _read_suggestion(connection, room["room_id"], suggestion_id)
        if not suggestion:
            raise TheaterError("suggestion_not_found", 404, "That suggestion could not be found.")
        selected_media = _normalize_media_payload(
            {
                "mode": suggestion["mode"],
                "tmdb": suggestion["tmdb_id"],
                "title": suggestion["title"],
                "poster": suggestion["poster"],
                "backdrop": suggestion["backdrop"],
                "releaseLabel": suggestion["release_label"],
                "season": suggestion["season"],
                "episode": suggestion["episode"],
                "episodeTitle": suggestion["episode_title"],
                "showTitle": suggestion["show_title"],
            }
        )
        selected_suggestion_id = suggestion["suggestion_id"]
        connection.execute(
            "UPDATE theater_suggestions SET selected_at = ? WHERE room_id = ?",
            (None, room["room_id"]),
        )
        connection.execute(
            """
            UPDATE theater_suggestions
            SET selected_at = ?
            WHERE room_id = ? AND suggestion_id = ?
            """,
            (now, room["room_id"], selected_suggestion_id),
        )
    else:
        selected_media = _normalize_media_payload(media)
        connection.execute(
            "UPDATE theater_suggestions SET selected_at = ? WHERE room_id = ?",
            (None, room["room_id"]),
        )

    playback = _build_selected_playback(selected_media, now)
    playback = {
        **playback,
        **_build_command_summary(connection, room["room_id"], playback, now),
    }
    connection.execute(
        """
        UPDATE theater_rooms
        SET current_media_json = ?, playback_json = ?, updated_at = ?, last_activity_at = ?, close_reason = NULL
        WHERE room_id = ?
        """,
        (_json_dump(selected_media), _json_dump(playback), now, now, room["room_id"]),
    )
    _append_event(
        connection,
        room["room_id"],
        "media_selected",
        {
            "media": selected_media,
            "playback": playback,
            "suggestionId": selected_suggestion_id,
            "hostMemberId": host["member_id"],
        },
        created_at=now,
    )
    current_room = _require_active_room(connection, room["room_id"], now=now)
    return _serialize_room_state(connection, current_room, viewer_member_id=host["member_id"])


def update_playback(
    connection: sqlite3.Connection,
    room_ref: str,
    *,
    host_token: Optional[str] = None,
    playback_payload: Any = None,
) -> Dict[str, Any]:
    ensure_theater_tables(connection)
    host = _require_host(connection, room_ref, host_token)
    room = _require_active_room(connection, room_ref)
    now = _now_ms()
    source = playback_payload if isinstance(playback_payload, dict) else {}
    media = _normalize_media_payload(source["media"]) if source.get("media") else _json_load(room["current_media_json"], None)
    playback = _merge_playback_update(
        _json_load(room["playback_json"], {}),
        source,
        media,
        now,
        host_member_id=host["member_id"],
    )
    playback = {
        **playback,
        **_build_command_summary(connection, room["room_id"], playback, now),
    }
    connection.execute(
        """
        UPDATE theater_rooms
        SET current_media_json = ?, playback_json = ?, updated_at = ?, last_activity_at = ?
        WHERE room_id = ?
        """,
        (_json_dump(media), _json_dump(playback), now, now, room["room_id"]),
    )
    _append_event(
        connection,
        room["room_id"],
        "playback_updated",
        {
            "media": media,
            "playback": playback,
            "hostMemberId": host["member_id"],
        },
        created_at=now,
    )
    current_room = _require_active_room(connection, room["room_id"], now=now)
    return _serialize_room_state(connection, current_room, viewer_member_id=host["member_id"])


def report_ready(
    connection: sqlite3.Connection,
    room_ref: str,
    *,
    member_token: Optional[str] = None,
    command_id: Optional[str] = None,
    status: Any = None,
    current_time: Any = None,
) -> Dict[str, Any]:
    ensure_theater_tables(connection)
    member = _require_member(connection, room_ref, member_token)
    room = _require_active_room(connection, room_ref)
    now = _now_ms()
    playback = _normalize_playback_payload(_json_load(room["playback_json"], {}), now=now)
    expected_command_id = str(playback.get("commandId") or "")
    provided_command_id = str(command_id or "").strip()
    if not expected_command_id or not provided_command_id or provided_command_id != expected_command_id:
        raise TheaterError("stale_command", 409, "That theater command is no longer active.")
    try:
        current_time_value = max(0.0, float(current_time or 0))
    except (TypeError, ValueError):
        current_time_value = 0.0
    playback = _mark_command_ready(
        playback,
        member["member_id"],
        now,
        status=_optional_text(status, 40) or "ready",
        current_time=current_time_value,
    )
    playback = {
        **playback,
        **_build_command_summary(connection, room["room_id"], playback, now),
    }
    connection.execute(
        """
        UPDATE theater_rooms
        SET playback_json = ?, updated_at = ?, last_activity_at = ?
        WHERE room_id = ?
        """,
        (_json_dump(playback), now, now, room["room_id"]),
    )
    event_id = _append_event(
        connection,
        room["room_id"],
        "playback_updated",
        {
            "media": _json_load(room["current_media_json"], None),
            "playback": playback,
            "readyMemberId": member["member_id"],
        },
        created_at=now,
    )
    return {
        "ok": True,
        "roomId": room["room_id"],
        "eventId": event_id,
        "memberId": member["member_id"],
        "playback": playback,
    }


def reset_screening(
    connection: sqlite3.Connection,
    room_ref: str,
    *,
    host_token: Optional[str] = None,
) -> Dict[str, Any]:
    ensure_theater_tables(connection)
    host = _require_host(connection, room_ref, host_token)
    room = _require_active_room(connection, room_ref)
    now = _now_ms()
    connection.execute(
        "UPDATE theater_suggestions SET selected_at = ? WHERE room_id = ?",
        (None, room["room_id"]),
    )
    connection.execute(
        """
        UPDATE theater_rooms
        SET current_media_json = ?, playback_json = ?, updated_at = ?, last_activity_at = ?, close_reason = NULL
        WHERE room_id = ?
        """,
        ("null", "{}", now, now, room["room_id"]),
    )
    _append_event(
        connection,
        room["room_id"],
        "screening_reset",
        {
            "media": None,
            "playback": {},
            "hostMemberId": host["member_id"],
        },
        created_at=now,
    )
    current_room = _require_active_room(connection, room["room_id"], now=now)
    return {
        "ok": True,
        "roomId": room["room_id"],
        "inviteKey": room["invite_key"] or room["invite_token"],
        "hostMemberId": host["member_id"],
        "state": _serialize_room_state(connection, current_room, viewer_member_id=host["member_id"]),
    }


def update_presence(
    connection: sqlite3.Connection,
    room_ref: str,
    *,
    member_token: Optional[str] = None,
) -> Dict[str, Any]:
    ensure_theater_tables(connection)
    member = _require_member(connection, room_ref, member_token)
    room = _require_active_room(connection, room_ref)
    now = _now_ms()
    connection.execute(
        """
        UPDATE theater_members
        SET last_seen_at = ?
        WHERE room_id = ? AND member_id = ?
        """,
        (now, room["room_id"], member["member_id"]),
    )
    _touch_room(connection, room["room_id"], now=now)
    return {
        "ok": True,
        "roomId": room["room_id"],
        "memberId": member["member_id"],
        "role": member["role"],
        "displayName": member["display_name"],
        "lastSeenAt": now,
    }


def post_chat_message(
    connection: sqlite3.Connection,
    room_ref: str,
    *,
    member_token: Optional[str] = None,
    body: Any = None,
) -> Dict[str, Any]:
    ensure_theater_tables(connection)
    member = _require_member(connection, room_ref, member_token)
    room = _require_active_room(connection, room_ref)
    text = _optional_text(body, 240)
    if not text:
        raise TheaterError("invalid_message", 400, "Chat messages cannot be empty.")
    now = _now_ms()
    message_id = secrets.token_urlsafe(9)
    connection.execute(
        """
        INSERT INTO theater_chat_messages (message_id, room_id, member_id, display_name, body, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
        """,
        (message_id, room["room_id"], member["member_id"], member["display_name"], text, now),
    )
    _truncate_chat(connection, room["room_id"])
    _touch_room(connection, room["room_id"], now=now)
    event_id = _append_event(
        connection,
        room["room_id"],
        "chat_message",
        {
            "messageId": message_id,
            "memberId": member["member_id"],
            "displayName": member["display_name"],
            "body": text,
            "createdAt": now,
        },
        created_at=now,
    )
    return {
        "messageId": message_id,
        "eventId": event_id,
        "displayName": member["display_name"],
        "body": text,
        "createdAt": now,
    }


def close_room(
    connection: sqlite3.Connection,
    room_ref: str,
    *,
    host_token: Optional[str] = None,
    reason: Any = None,
) -> Dict[str, Any]:
    ensure_theater_tables(connection)
    host = _require_host(connection, room_ref, host_token)
    room = _require_active_room(connection, room_ref)
    close_reason = _optional_text(reason, 80) or "host_closed"
    now = _now_ms()
    _close_room(connection, room["room_id"], close_reason, created_at=now)
    return {
        "ok": True,
        "roomId": room["room_id"],
        "inviteKey": room["invite_key"] or room["invite_token"],
        "closeReason": close_reason,
        "hostMemberId": host["member_id"],
    }


def list_events(
    connection: sqlite3.Connection,
    room_ref: str,
    *,
    member_token: Optional[str] = None,
    after_event_id: Any = None,
) -> List[Dict[str, Any]]:
    ensure_theater_tables(connection)
    member = _require_member(connection, room_ref, member_token)
    room = _require_active_room(connection, room_ref)
    try:
        after_id = max(0, int(after_event_id or 0))
    except (TypeError, ValueError):
        after_id = 0
    events = []
    for row in connection.execute(
        """
        SELECT event_id, event_type, payload_json, created_at
        FROM theater_events
        WHERE room_id = ? AND event_id > ?
        ORDER BY event_id ASC
        LIMIT 200
        """,
        (room["room_id"], after_id),
    ).fetchall():
        events.append(
            {
                "eventId": int(row["event_id"]),
                "eventType": row["event_type"],
                "createdAt": int(row["created_at"] or 0),
                "payload": _json_load(row["payload_json"], {}),
                "viewerMemberId": member["member_id"],
            }
        )
    return events
