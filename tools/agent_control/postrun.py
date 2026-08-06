"""run worker 종료 훅.

opencode run 프로세스가 끝난 직후 worker pane의 shell이 실행한다.
- 정상 완료(final report 있음): row를 닫고 자기 pane·prompt 파일·clean worktree를
  정리한다 — 대량 dispatch 시 Herdr에는 일하는 중인 pane만 남는다. 완주 신호는
  report가 이미 보냈다.
- report 없이 종료: ledger에 dead를 확정하고 리더를 깨운다 — 죽음도 wake 이벤트다.
  pane은 진단용으로 남긴다.
"""

from __future__ import annotations

import os
import shutil
from pathlib import Path

from . import herdr, ledger, mcp_server


def _cleanup_self(row) -> None:
    project = Path(row["cwd"])
    prompt = project / ".agent-control" / "prompts" / f"{row['name']}-{row['id']}.md"
    try:
        prompt.unlink(missing_ok=True)
    except OSError:
        pass
    shutil.rmtree(mcp_server.run_scratch_dir(project, str(row["name"]), int(row["id"])),
                  ignore_errors=True)
    if row["worktree"]:
        worktree = Path(row["worktree"])
        if worktree.exists() and not mcp_server.worktree_dirty(worktree):
            mcp_server.git_worktree_remove(project, worktree)
    if row["pane"]:
        try:
            # 마지막 동작 — pane이 닫히면 이 프로세스도 함께 끝난다.
            herdr.close(str(row["pane"]))
        except herdr.HerdrError:
            pass


def main() -> None:
    worker_id = os.environ.get("AGENT_CONTROL_WORKER_ID", "")
    project = os.environ.get("AGENT_CONTROL_PROJECT", "")
    if not worker_id or not project:
        return
    name = os.environ.get("AGENT_CONTROL_NAME", "unknown")
    leader_pane = os.environ.get("AGENT_LEADER_PANE", "")
    wake_cmd = os.environ.get("AGENT_CONTROL_WAKE_CMD", "")

    completion = None
    finished = False
    with ledger.open_db(Path(project)) as conn:
        row = ledger.worker_row(conn, int(worker_id))
        if row is None or row["closed_at"] is not None:
            return
        finished = ledger.has_final_report(conn, int(worker_id))
        if finished and row["oneshot"]:
            ledger.close_worker(conn, int(worker_id), "oneshot_done")
        elif not finished:
            ledger.close_worker(conn, int(worker_id), "run_exit_no_report", status="dead")
    if finished:
        # 성공 — report는 ledger에 있으니 pane을 남길 이유가 없다. 스스로 정리해서
        # 대량 dispatch 시 Herdr 리스트에 "일하는 중인 것"만 보이게 한다.
        if row["oneshot"]:
            _cleanup_self(row)
        return
    with ledger.open_db(Path(project)) as conn:
        if row["group_name"]:
            total = ledger.claim_group_completion(conn, row["owner"], row["group_name"])
            if total is not None:
                completion = {"group": row["group_name"], "total": total}

    if completion:
        marker = (
            f"[AGENT_GROUP_DONE {completion['group']}] "
            f"{completion['total']}/{completion['total']} terminal "
            f"(agent:{name}은 report 없이 종료) — collect로 수거하라"
        )
        title = f"group {completion['group']} 완료 (일부 실패)"
    else:
        live_dir = mcp_server.run_live_dir(Path(row["cwd"]), name, int(row["id"]))
        marker = (f"[AGENT_DEAD {name}] final report 없이 종료했다 — "
                  f"collect로 확인하고 진단 파일은 {live_dir}")
        title = f"agent:{name} report 없이 종료"

    if leader_pane:
        try:
            herdr.send(leader_pane, marker, wait_idle=False)
        except herdr.HerdrError:
            pass
    else:
        try:
            herdr.notify(title, marker)
        except herdr.HerdrError:
            pass
        if wake_cmd:
            mcp_server.spawn_wake_cmd(wake_cmd)


if __name__ == "__main__":
    main()
