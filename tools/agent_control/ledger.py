"""Project-scoped SQLite ledger — fan-in의 기계용 report 경로.

Herdr가 라이브 pane의 권위이고, ledger는 report payload와 worker 수명 기록만 담는다.
daemon 없이 리더/worker MCP 프로세스가 같은 파일을 공유한다.
"""

from __future__ import annotations

import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator

DB_NAME = "ledger.db"

# pane이 아직 배정되지 않은 'starting' row를 중복으로 취급하는 시간창.
# 이 창이 지나면 크래시로 남은 고아 row로 보고 이름 재사용을 허용한다.
STARTING_TTL_SECONDS = 60.0


class DuplicateWorkerError(Exception):
    """같은 (owner, name)의 살아있는 worker가 이미 존재한다."""


class FinalReportExists(Exception):
    """한 worker attempt에 final report가 이미 존재한다."""

_SCHEMA = """
CREATE TABLE IF NOT EXISTS workers (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    owner TEXT NOT NULL,
    group_name TEXT,
    pane TEXT,
    tab TEXT,
    workspace TEXT,
    model TEXT NOT NULL,
    cwd TEXT NOT NULL,
    worktree TEXT,
    branch TEXT,
    oneshot INTEGER NOT NULL DEFAULT 0,
    mode TEXT NOT NULL DEFAULT 'tui',
    pid INTEGER,
    pid_start_ticks INTEGER,
    pgid INTEGER,
    agent TEXT,
    isolation TEXT,
    base_ref TEXT,
    prompt_source TEXT,
    prompt_text TEXT,
    handoff_id TEXT,
    handoff_path TEXT,
    handoff_sha256 TEXT,
    status TEXT NOT NULL DEFAULT 'starting',
    missing_since REAL,
    spawned_at REAL NOT NULL,
    closed_at REAL,
    close_reason TEXT
);
CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY,
    worker_id INTEGER NOT NULL REFERENCES workers(id),
    body TEXT NOT NULL,
    is_final INTEGER NOT NULL DEFAULT 1,
    created_at REAL NOT NULL,
    consumed_at REAL
);
CREATE TABLE IF NOT EXISTS workflows (
    owner TEXT NOT NULL,
    group_name TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'running',
    completion_notified INTEGER NOT NULL DEFAULT 0,
    updated_at REAL NOT NULL,
    PRIMARY KEY (owner, group_name)
);
CREATE INDEX IF NOT EXISTS idx_workers_owner ON workers(owner);
CREATE INDEX IF NOT EXISTS idx_reports_worker ON reports(worker_id);
"""


# CREATE TABLE IF NOT EXISTS는 기존 파일에 컬럼을 추가하지 못한다 — 중간 버전이 만든
# 파일도 자동 치유되도록, 초기 스키마 이후 추가된 컬럼을 diff로 보충한다.
_WORKER_COLUMN_UPGRADES = {
    "mode": "TEXT NOT NULL DEFAULT 'tui'",
    "missing_since": "REAL",
    "isolation": "TEXT",
    "base_ref": "TEXT",
    "pid": "INTEGER",
    "pid_start_ticks": "INTEGER",
    "pgid": "INTEGER",
    "agent": "TEXT",
    "prompt_source": "TEXT",
    "prompt_text": "TEXT",
    "handoff_id": "TEXT",
    "handoff_path": "TEXT",
    "handoff_sha256": "TEXT",
}


def _migrate(conn: sqlite3.Connection) -> None:
    existing = {row[1] for row in conn.execute("PRAGMA table_info(workers)")}
    for column, ddl in _WORKER_COLUMN_UPGRADES.items():
        if column not in existing:
            conn.execute(f"ALTER TABLE workers ADD COLUMN {column} {ddl}")


@contextmanager
def open_db(project: Path) -> Iterator[sqlite3.Connection]:
    path = project / ".agent-control" / DB_NAME
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=10.0)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.executescript(_SCHEMA)
        _migrate(conn)
        yield conn
        conn.commit()
    finally:
        conn.close()


def add_worker(
    conn: sqlite3.Connection,
    name: str,
    owner: str,
    model: str,
    cwd: str,
    group: str | None = None,
    oneshot: bool = False,
    mode: str = "tui",
    live_pane_ids: frozenset[str] | set[str] = frozenset(),
    status: str = "starting",
    isolation: str | None = None,
    base_ref: str | None = None,
    agent: str | None = None,
    handoff_id: str | None = None,
    handoff_path: str | None = None,
    handoff_sha256: str | None = None,
) -> int:
    # 중복 검사와 삽입을 같은 쓰기 트랜잭션으로 묶는다 — 병렬 spawn(스레드화된
    # tools/call)의 check-then-act race를 SQLite write lock으로 직렬화한다.
    conn.execute("BEGIN IMMEDIATE")
    now = time.time()
    for row in conn.execute(
        "SELECT pane, pid, status, spawned_at FROM workers WHERE name=? AND owner=? AND closed_at IS NULL",
        (name, owner),
    ):
        alive = row["pane"] is not None and row["pane"] in live_pane_ids
        starting = row["pane"] is None and row["pid"] is None and now - row["spawned_at"] < STARTING_TTL_SECONDS
        # pending은 launch 대기 큐, pid가 있는 row는 실행된 dispatch worker다 —
        # 죽었다면 postrun/reconcile이 곧 닫으므로 그때까지는 중복으로 취급한다.
        if alive or starting or row["status"] == "pending" or row["pid"] is not None:
            raise DuplicateWorkerError(name)
    # 나머지 live row는 stale이다(pane이 죽었거나 고아 starting row). 이름 재사용 시
    # collect가 옛 row에 붙잡히지 않도록 superseded로 닫는다.
    conn.execute(
        "UPDATE workers SET status='closed', closed_at=?, close_reason='superseded'"
        " WHERE name=? AND owner=? AND closed_at IS NULL",
        (now, name, owner),
    )
    cursor = conn.execute(
        "INSERT INTO workers (name, owner, group_name, model, cwd, oneshot, mode,"
        " status, isolation, base_ref, agent, handoff_id, handoff_path, handoff_sha256, spawned_at)"
        " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
        (name, owner, group, model, cwd, 1 if oneshot else 0, mode,
         status, isolation, base_ref, agent, handoff_id, handoff_path, handoff_sha256, time.time()),
    )
    return int(cursor.lastrowid)


def set_worktree(conn: sqlite3.Connection, worker_id: int, worktree: str, branch: str) -> None:
    conn.execute(
        "UPDATE workers SET worktree=?, branch=? WHERE id=?", (worktree, branch, worker_id)
    )


def set_prompt_text(conn: sqlite3.Connection, worker_id: int, prompt_text: str) -> None:
    conn.execute(
        "UPDATE workers SET prompt_text=? WHERE id=?", (prompt_text, worker_id)
    )


def set_prompt_source(conn: sqlite3.Connection, worker_id: int, prompt_source: str) -> None:
    conn.execute(
        "UPDATE workers SET prompt_source=? WHERE id=?", (prompt_source, worker_id)
    )


def mark_started(conn: sqlite3.Connection, worker_id: int, pane: str, tab: Any, workspace: Any) -> None:
    conn.execute(
        "UPDATE workers SET status='running', pane=?, tab=?, workspace=? WHERE id=?",
        (pane, tab, workspace, worker_id),
    )


def mark_started_pid(conn: sqlite3.Connection, worker_id: int, pid: int,
                     pid_start_ticks: int | None = None, pgid: int | None = None) -> bool:
    """Publish process identity only if the attempt and workflow are still launchable."""
    cursor = conn.execute(
        "UPDATE workers SET status='running', pid=?, pid_start_ticks=?, pgid=?"
        " WHERE id=? AND closed_at IS NULL AND status='starting'"
        " AND (group_name IS NULL OR NOT EXISTS ("
        "   SELECT 1 FROM workflows f WHERE f.owner=workers.owner"
        "   AND f.group_name=workers.group_name AND f.state='stopped'))",
        (pid, pid_start_ticks, pgid, worker_id),
    )
    return cursor.rowcount == 1


def set_workflow_running(conn: sqlite3.Connection, owner: str, group: str) -> None:
    conn.execute(
        "INSERT INTO workflows (owner, group_name, state, completion_notified, updated_at)"
        " VALUES (?, ?, 'running', 0, ?)"
        " ON CONFLICT(owner, group_name) DO UPDATE SET"
        " state='running', completion_notified=0, updated_at=excluded.updated_at",
        (owner, group, time.time()),
    )


def set_workflow_stopped(conn: sqlite3.Connection, owner: str, group: str) -> bool:
    previous = conn.execute(
        "SELECT state FROM workflows WHERE owner=? AND group_name=?", (owner, group)
    ).fetchone()
    conn.execute(
        "INSERT INTO workflows (owner, group_name, state, completion_notified, updated_at)"
        " VALUES (?, ?, 'stopped', 1, ?)"
        " ON CONFLICT(owner, group_name) DO UPDATE SET"
        " state='stopped', completion_notified=1, updated_at=excluded.updated_at",
        (owner, group, time.time()),
    )
    return previous is None or previous["state"] != "stopped"


def workflow_stopped(conn: sqlite3.Connection, owner: str, group: str | None) -> bool:
    if not group:
        return False
    row = conn.execute(
        "SELECT state FROM workflows WHERE owner=? AND group_name=?", (owner, group)
    ).fetchone()
    return row is not None and row["state"] == "stopped"


def claim_group_completion(conn: sqlite3.Connection, owner: str, group: str) -> int | None:
    """Claim the group's one completion notification after every latest attempt is terminal."""
    conn.execute(
        "INSERT INTO workflows (owner, group_name, state, completion_notified, updated_at)"
        " VALUES (?, ?, 'running', 0, ?) ON CONFLICT(owner, group_name) DO NOTHING",
        (owner, group, time.time()),
    )
    members = [row for row in select_workers(conn, owner, group=group) if row["mode"] != "monitor"]
    if not members or any(
        not has_final_report(conn, row["id"]) and row["status"] not in {"dead", "closed"}
        for row in members
    ):
        return None
    cursor = conn.execute(
        "UPDATE workflows SET completion_notified=1, updated_at=?"
        " WHERE owner=? AND group_name=? AND state='running' AND completion_notified=0",
        (time.time(), owner, group),
    )
    return len(members) if cursor.rowcount == 1 else None


def close_worker(conn: sqlite3.Connection, worker_id: int, reason: str, status: str = "closed") -> None:
    conn.execute(
        "UPDATE workers SET status=?, closed_at=?, close_reason=? WHERE id=? AND closed_at IS NULL",
        (status, time.time(), reason, worker_id),
    )


def set_status(conn: sqlite3.Connection, worker_id: int, status: str) -> None:
    conn.execute(
        "UPDATE workers SET status=? WHERE id=? AND closed_at IS NULL", (status, worker_id)
    )


def set_missing_since(conn: sqlite3.Connection, worker_id: int, since: float | None) -> None:
    conn.execute(
        "UPDATE workers SET missing_since=? WHERE id=? AND closed_at IS NULL", (since, worker_id)
    )


def add_report(conn: sqlite3.Connection, worker_id: int, body: str, is_final: bool) -> int:
    if is_final:
        if not conn.in_transaction:
            conn.execute("BEGIN IMMEDIATE")
        if conn.execute(
            "SELECT 1 FROM reports WHERE worker_id=? AND is_final=1 LIMIT 1", (worker_id,)
        ).fetchone() is not None:
            raise FinalReportExists(worker_id)
    cursor = conn.execute(
        "INSERT INTO reports (worker_id, body, is_final, created_at) VALUES (?, ?, ?, ?)",
        (worker_id, body, 1 if is_final else 0, time.time()),
    )
    return int(cursor.lastrowid)


def select_workers(
    conn: sqlite3.Connection,
    owner: str | None,
    names: list[str] | None = None,
    group: str | None = None,
) -> list[sqlite3.Row]:
    """worker를 (owner, 이름)당 최신 row 하나로 반환한다(superseded 제외).

    owner=None은 진단용 project 전체 조회다.
    """
    if names is not None and not names:
        return []
    query = "SELECT * FROM workers WHERE (close_reason IS NULL OR close_reason != 'superseded')"
    params: list[Any] = []
    if owner is not None:
        query += " AND owner=?"
        params.append(owner)
    if group is not None:
        query += " AND group_name=?"
        params.append(group)
    if names is not None:
        placeholders = ",".join("?" for _ in names)
        query += f" AND name IN ({placeholders})"
        params.extend(names)
    latest: dict[tuple[str, str], sqlite3.Row] = {}
    for row in conn.execute(query + " ORDER BY id", params):
        latest[(row["owner"], row["name"])] = row
    return list(latest.values())


def worker_row(conn: sqlite3.Connection, worker_id: int) -> sqlite3.Row | None:
    return conn.execute("SELECT * FROM workers WHERE id=?", (worker_id,)).fetchone()


def unconsumed_reports(conn: sqlite3.Connection, worker_id: int) -> list[sqlite3.Row]:
    return list(conn.execute(
        "SELECT * FROM reports WHERE worker_id=? AND consumed_at IS NULL ORDER BY id",
        (worker_id,),
    ))


def has_final_report(conn: sqlite3.Connection, worker_id: int) -> bool:
    row = conn.execute(
        "SELECT 1 FROM reports WHERE worker_id=? AND is_final=1 LIMIT 1", (worker_id,)
    ).fetchone()
    return row is not None


def consume_reports(conn: sqlite3.Connection, report_ids: list[int]) -> set[int]:
    """아직 미소비인 report만 원자적으로 점유하고, 점유에 성공한 id를 반환한다.

    동시 collect가 같은 report를 두 응답에 중복 전달하는 것을 막는다.
    """
    if not report_ids:
        return set()
    placeholders = ",".join("?" for _ in report_ids)
    rows = conn.execute(
        f"UPDATE reports SET consumed_at=? WHERE id IN ({placeholders})"
        " AND consumed_at IS NULL RETURNING id",
        [time.time(), *report_ids],
    ).fetchall()
    return {int(row["id"]) for row in rows}
