"""Retire completed interactive AgentControl workers after an idle lease."""

from __future__ import annotations

import argparse
import time
from pathlib import Path
from typing import Callable

from . import herdr, ledger, mcp_server

POLL_SECONDS = 2.0


def configured_ttl_seconds() -> float:
    return mcp_server.spawn_idle_ttl_seconds()


def cleanup_completed(project: Path, row) -> None:
    server = mcp_server.MCPServer(project)
    server._cleanup_prompt_file(row)
    server._cleanup_live_files(row)
    server._cleanup_worktree(row)


def close_completed(project: Path, row, reason: str) -> bool:
    with ledger.open_db(project) as conn:
        fresh = ledger.worker_row(conn, int(row["id"]))
        if fresh is None or fresh["closed_at"] is not None:
            return True
        if not ledger.has_final_report(conn, int(row["id"])):
            return False
        ledger.close_worker(conn, int(row["id"]), reason)
    cleanup_completed(project, row)
    return True


def reap_worker(
    project: Path,
    worker_id: int,
    *,
    idle_ttl: float | None = None,
    poll_seconds: float = POLL_SECONDS,
    now: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
) -> str:
    ttl = configured_ttl_seconds() if idle_ttl is None else max(0.0, idle_ttl)
    idle_since: float | None = None
    missing_since: float | None = None

    while True:
        with ledger.open_db(project) as conn:
            row = ledger.worker_row(conn, worker_id)
            if row is None or row["closed_at"] is not None:
                return "already_closed"
            if row["mode"] != "tui" or not ledger.has_final_report(conn, worker_id):
                return "not_eligible"

        try:
            workers = herdr.list_agent_workers(str(row["owner"]))
        except herdr.HerdrError:
            idle_since = None
            missing_since = None
            sleep(poll_seconds)
            continue

        observed = next((
            worker for worker in workers
            if str(worker.get("pane")) == str(row["pane"])
            and str(worker.get("name")) == str(row["name"])
        ), None)
        current = now()
        if observed is None:
            idle_since = None
            missing_since = current if missing_since is None else missing_since
            if current - missing_since >= mcp_server.DEAD_GRACE_SECONDS:
                close_completed(project, row, "pane_gone_after_report")
                return "pane_gone"
            sleep(poll_seconds)
            continue

        missing_since = None
        if observed.get("status") not in {"idle", "done"}:
            idle_since = None
            sleep(poll_seconds)
            continue

        idle_since = current if idle_since is None else idle_since
        if current - idle_since < ttl:
            sleep(poll_seconds)
            continue

        try:
            herdr.close(str(row["pane"]))
        except herdr.HerdrError:
            sleep(poll_seconds)
            continue
        if close_completed(project, row, "auto_expired"):
            return "auto_expired"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", required=True)
    parser.add_argument("--worker-id", required=True, type=int)
    args = parser.parse_args()
    reap_worker(Path(args.project).resolve(), args.worker_id)


if __name__ == "__main__":
    main()
