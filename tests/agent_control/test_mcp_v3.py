"""Agent Control v3 — ledger / collect fan-in tests."""

from __future__ import annotations

import json
import os
import pty
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import pytest

from tools.agent_control import handoff, herdr, ledger, reaper
from tools.agent_control import mcp_server
from tools.agent_control.mcp_server import MCPServer

LEADER_PANE = "w1:p1"


RuntimeMCPServer = MCPServer


def write_handoff(project: Path, action: str, *, name: str = "test-handoff",
                  body_overrides: dict[str, str] | None = None) -> Path:
    sections = {
        "Goal": "Prove the delegated task result.",
        "Done when": "The requested evidence is returned.",
        "Workspace": f"Project root: `{project}`.",
        "Scope": "Only the delegated task is in scope.",
        "Source map": "- `AGENTS.md` — project instructions — primary.",
        "Claims and decisions": "- Revalidate every prior implementation claim.",
        "Acceptance atoms": "- [ ] A1: requested result is evidenced.",
        "Verification": "Inspect the real target surface.",
        "Deliverable": "Return one final Report with citations.",
    }
    if action in {"execute", "dispatch"}:
        sections["Mutation boundary"] = "Modify only files named by the task."
    sections.update(body_overrides or {})
    content = "\n".join([
        "---",
        "schema: agentcontrol-handoff/v1",
        f"id: {name}",
        f"action: {action}",
        "projectRoot: .",
        "sourceRevision: test-revision",
        "status: ready",
        "---",
        "",
        *[f"## {heading}\n\n{text}\n" for heading, text in sections.items()],
    ])
    path = project / ".agent-control" / "handoffs" / f"{name}.md"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return path


class LegacyTestMCPServer(MCPServer):
    def call_tool(self, name, args):
        if name == "spawn":
            if self.role == "worker":
                return super().call_tool("Execute", args)
            try:
                return self.spawn("execute", args["name"], args["prompt"], args.get("isolation"),
                                  args.get("base"), args.get("target"), None,
                                  args.get("group"), bool(args.get("oneshot", False)))
            except herdr.HerdrError as exc:
                return {"status": "ERROR", "error": str(exc)}
        mapped = {
            "dispatch": "Dispatch", "send": "Send", "list": "List", "collect": "Collect",
            "peek": "Peek", "cancel": "Cancel", "report": "Report",
        }.get(name, name)
        if mapped in {"Execute", "Explore", "Plan", "Research", "Dispatch"} and "handoff" not in args:
            action = "dispatch" if mapped == "Dispatch" else mapped.lower()
            args = {**args, "handoff": str(write_handoff(self.project, action, name=f"legacy-{action}"))}
        if mapped == "Report" and "message" in args:
            args = {**args, "summary": args["message"]}
            args.pop("message")
        return super().call_tool(mapped, args)


MCPServer = LegacyTestMCPServer


@pytest.fixture()
def project(tmp_path: Path) -> Path:
    return tmp_path


def clear_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in (
        "AGENT_CONTROL_ROLE",
        "AGENT_CONTROL_NAME",
        "AGENT_CONTROL_WORKER_ID",
        "AGENT_CONTROL_PROJECT",
        "AGENT_CONTROL_OWNER",
        "AGENT_CONTROL_WAKE_CMD",
        "AGENT_CONTROL_RUN_CMD",
        "AGENT_CONTROL_POSTRUN",
        "AGENT_LEADER_PANE",
        "AGENT_CONTROL_REPORT_PATH",
        "AGENT_CONTROL_HANDOFF_ID",
        "AGENT_CONTROL_HANDOFF_PATH",
        "AGENT_CONTROL_HANDOFF_SHA256",
        "AGENT_CONTROL_SPAWN_IDLE_TTL_SECONDS",
        "HERDR_PANE_ID",
        "HERDR_WORKSPACE_ID",
        "HERDR_DEFAULT_WORKSPACE",
        "OPENCODE_CONFIG_CONTENT",
        "OPENCODE_CONFIG_DIR",
        "OPENCODE_DISABLE_AUTOUPDATE",
        "OPENCODE_DISABLE_MODELS_FETCH",
        "XDG_DATA_HOME",
        "XDG_CONFIG_HOME",
        "XDG_CACHE_HOME",
        "XDG_STATE_HOME",
    ):
        monkeypatch.delenv(key, raising=False)


def make_leader(project: Path, monkeypatch: pytest.MonkeyPatch) -> MCPServer:
    clear_env(monkeypatch)
    monkeypatch.setenv("HERDR_PANE_ID", LEADER_PANE)
    monkeypatch.setenv("HERDR_WORKSPACE_ID", "w1")
    return MCPServer(project)


def fake_herdr(monkeypatch: pytest.MonkeyPatch) -> dict:
    """spawn이 herdr를 건드리지 않고 성공하도록 최소 fake를 깐다."""
    state = {"workers": [], "spawn_envs": {}, "spawn_cwds": {}, "spawn_workspaces": {},
              "spawn_commands": {},
              "sent": [], "closed": [], "reapers": []}

    def start(name, workspace, command, env, cwd):
        state["spawn_envs"][name] = env
        state["spawn_cwds"][name] = cwd
        state["spawn_workspaces"][name] = workspace
        state["spawn_commands"][name] = command
        owner = env.get("AGENT_CONTROL_OWNER")
        worker = {
            "name": name, "agent": f"agent:{name}",
            "pane": f"w1:p-{name}", "pane_id": f"w1:p-{name}",
            "terminal": f"term-{name}", "terminal_id": f"term-{name}",
            "tab_id": f"w1:t-{name}", "workspace_id": workspace, "workspace": workspace,
            "alive": True, "status": "idle", "owner_pane": owner,
            "project": env.get("AGENT_CONTROL_PROJECT"),
        }
        state["workers"].append(worker)
        return worker

    def start_run(name, workspace, env, cwd):
        return start(name, workspace, None, env, cwd)

    monkeypatch.setattr(herdr, "find_agent_worker", lambda name: None)
    monkeypatch.setattr(
        herdr, "list_agent_workers",
        lambda owner=None: [dict(w) for w in state["workers"]
                            if owner is None or w.get("owner_pane") == owner],
    )
    monkeypatch.setattr(herdr, "list_pane_ids", lambda: {w["pane"] for w in state["workers"]})
    monkeypatch.setattr(herdr, "start_agent", start)
    monkeypatch.setattr(herdr, "start_run", start_run)
    monkeypatch.setattr(herdr, "send", lambda pane, text, wait_idle=True: state["sent"].append((pane, text)))
    monkeypatch.setattr(
        herdr, "resolve_target",
        lambda target, owner=None: next(
            (w for w in state["workers"] if target in {w["name"], w["agent"], w["pane"]}),
            None,
        ) or (_ for _ in ()).throw(herdr.HerdrError("gone")),
    )
    monkeypatch.setattr(herdr, "close", lambda pane: state["closed"].append(pane))
    monkeypatch.setattr(herdr, "read_output", lambda pane, lines, facade="agent": "")
    state["notified"] = []
    monkeypatch.setattr(herdr, "notify", lambda title, body="", sound="done": state["notified"].append(title))

    # dispatch worker는 pane 없는 subprocess다 — 실행/생존/종료를 fake로 대체한다.
    state["launches"] = {}
    state["alive_pids"] = set()
    state["killed"] = []
    pid_counter = iter(range(90001, 99999))

    def fake_launch(command, env, cwd, events_path, stderr_path):
        name = env["AGENT_CONTROL_NAME"]
        pid = next(pid_counter)
        state["spawn_envs"][name] = env
        state["spawn_cwds"][name] = cwd
        state["launches"][name] = {
            "command": command, "events": str(events_path), "stderr": str(stderr_path), "pid": pid,
        }
        state["alive_pids"].add(pid)
        return pid

    monkeypatch.setattr(mcp_server, "launch_run_process", fake_launch)
    monkeypatch.setattr(mcp_server, "pid_alive", lambda pid: pid in state["alive_pids"])
    monkeypatch.setattr(mcp_server, "kill_process", lambda pid: state["killed"].append(pid))
    def fake_terminate(pid, start_ticks=None, pgid=None, timeout=1.0):
        state["killed"].append(pid)
        state["alive_pids"].discard(pid)
        return True
    monkeypatch.setattr(mcp_server, "terminate_process", fake_terminate)
    monkeypatch.setattr(
        mcp_server, "launch_spawn_reaper",
        lambda project, worker_id: state["reapers"].append((str(project), worker_id)) or True,
    )
    return state


def fake_worktree(monkeypatch, dirty: bool = False) -> dict:
    """git worktree 헬퍼를 fake로 대체한다. add는 실제 디렉토리를 만든다."""
    calls = {"added": [], "removed": []}

    def add(project, path, branch, base):
        calls["added"].append((str(path), branch, base))
        Path(path).mkdir(parents=True, exist_ok=True)
        return None

    def remove(project, path):
        calls["removed"].append(str(path))
        return True

    monkeypatch.setattr(mcp_server, "git_worktree_add", add)
    monkeypatch.setattr(mcp_server, "worktree_dirty", lambda path: dirty)
    monkeypatch.setattr(mcp_server, "git_worktree_remove", remove)
    return calls


def make_worker(project: Path, monkeypatch: pytest.MonkeyPatch, env: dict) -> MCPServer:
    clear_env(monkeypatch)
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    return MCPServer(project)


def test_server_ignores_control_runtime_in_git_projects(project, monkeypatch):
    (project / ".git").mkdir()

    make_leader(project, monkeypatch)

    assert (project / ".agent-control" / ".gitignore").read_text() == "*\n!.gitignore\n"


def spawn_and_worker(project, monkeypatch, state, name, group=None):
    leader = make_leader(project, monkeypatch)
    args = {"name": name, "prompt": "task"}
    if group:
        args["group"] = group
    spawned = leader.call_tool("spawn", args)
    assert spawned["status"] == "OK"
    worker = make_worker(project, monkeypatch, state["spawn_envs"][name])
    # make_worker가 env를 갈아엎으므로 leader용 env를 복원해 반환한다.
    leader = make_leader(project, monkeypatch)
    return leader, worker, spawned


def dispatch_one(leader, item="fan-a", **extra):
    options = {"group": "test", **extra}
    result = leader.call_tool("dispatch", {"template": "task {item}", "items": [item], **options})
    assert result["status"] == "OK"
    assert result["launched"], result
    return result["launched"][0]


def test_spawn_records_ledger_and_worker_id_env(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader, _, spawned = spawn_and_worker(project, monkeypatch, state, "fan-a", group="review")
    env = state["spawn_envs"]["fan-a"]
    assert env["AGENT_CONTROL_WORKER_ID"] == str(spawned["worker_id"])
    with ledger.open_db(project) as conn:
        rows = ledger.select_workers(conn, LEADER_PANE)
    assert [(r["name"], r["status"], r["group_name"]) for r in rows] == [("fan-a", "running", "review")]


def test_spawn_failure_closes_ledger_row(project, monkeypatch):
    fake_herdr(monkeypatch)
    monkeypatch.setattr(
        herdr, "start_agent",
        lambda *a, **k: (_ for _ in ()).throw(herdr.HerdrError("startup failed")),
    )
    leader = make_leader(project, monkeypatch)
    result = leader.call_tool("spawn", {"name": "broken", "prompt": "p"})
    assert result["status"] == "ERROR"
    with ledger.open_db(project) as conn:
        row = ledger.select_workers(conn, LEADER_PANE, names=["broken"])[0]
    assert row["status"] == "closed"
    assert row["close_reason"] == "startup_failed"


def test_report_writes_ledger_and_pastes_nudge(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    _, worker, spawned = spawn_and_worker(project, monkeypatch, state, "fan-a")
    result = worker.call_tool("report", {"message": "done"})
    assert result["status"] == "OK"
    assert result["ledger"] is True
    assert result["auto_close_seconds"] == 300
    assert state["reapers"] == [(str(project), spawned["worker_id"])]
    assert state["sent"][-1] == (LEADER_PANE, "[AGENT_REPORT fan-a kind=execute] done")
    with ledger.open_db(project) as conn:
        reports = ledger.unconsumed_reports(conn, spawned["worker_id"])
    assert [(r["body"], r["is_final"]) for r in reports] == [("done", 1)]


def test_nonfinal_report_does_not_start_idle_reaper(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    _, worker, _ = spawn_and_worker(project, monkeypatch, state, "fan-a")

    result = worker.call_tool("report", {"message": "working", "final": False})

    assert result["status"] == "OK"
    assert state["reapers"] == []


def test_send_rejects_worker_after_final_report(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader, worker, _ = spawn_and_worker(project, monkeypatch, state, "fan-a")
    worker.call_tool("report", {"message": "done"})
    sent_before = list(state["sent"])

    result = leader.call_tool("send", {"target": "fan-a", "message": "more work"})

    assert result["status"] == "REJECTED"
    assert result["error"] == "FINAL_ALREADY_REPORTED"
    assert state["sent"] == sent_before


def test_reaper_requires_continuous_idle_after_final_report(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    _, worker, spawned = spawn_and_worker(project, monkeypatch, state, "fan-a")
    worker.call_tool("report", {"message": "done"})
    clock = {"value": 0.0}
    statuses = ["idle", "idle", "working", "idle", "idle", "done"]
    cleaned = []

    def list_workers(owner=None):
        index = min(int(clock["value"]), len(statuses) - 1)
        observed = dict(state["workers"][0], status=statuses[index])
        return [observed] if owner in {None, observed["owner_pane"]} else []

    monkeypatch.setattr(herdr, "list_agent_workers", list_workers)
    monkeypatch.setattr(reaper, "cleanup_completed", lambda root, row: cleaned.append(int(row["id"])))

    outcome = reaper.reap_worker(
        project,
        spawned["worker_id"],
        idle_ttl=2.0,
        poll_seconds=1.0,
        now=lambda: clock["value"],
        sleep=lambda seconds: clock.__setitem__("value", clock["value"] + seconds),
    )

    assert outcome == "auto_expired"
    assert clock["value"] == 5.0
    assert state["closed"][-1] == "w1:p-fan-a"
    assert cleaned == [spawned["worker_id"]]
    with ledger.open_db(project) as conn:
        row = ledger.worker_row(conn, spawned["worker_id"])
    assert row["status"] == "closed"
    assert row["close_reason"] == "auto_expired"


def test_report_survives_leader_pane_gone_via_ledger(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    _, worker, _ = spawn_and_worker(project, monkeypatch, state, "fan-a")
    monkeypatch.setattr(
        herdr, "send",
        lambda pane, text, wait_idle=True: (_ for _ in ()).throw(herdr.HerdrError("pane gone")),
    )
    result = worker.call_tool("report", {"message": "done"})
    assert result["status"] == "OK"
    assert result["transport"] == "ledger"
    assert result["warning"] == "LEADER_PANE_GONE"


def test_legacy_worker_without_worker_id_pastes_only(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    worker = make_worker(project, monkeypatch, {
        "AGENT_CONTROL_ROLE": "worker",
        "AGENT_CONTROL_NAME": "legacy",
        "AGENT_LEADER_PANE": LEADER_PANE,
    })
    result = worker.call_tool("report", {"message": "done"})
    assert result["status"] == "OK"
    assert result["ledger"] is False
    assert state["sent"] == [(LEADER_PANE, "[AGENT_REPORT legacy kind=unknown] done")]


def test_collect_returns_reports_and_consumes(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    _, worker_a, _ = spawn_and_worker(project, monkeypatch, state, "fan-a", group="review")
    worker_a.call_tool("report", {"message": "A done"})
    leader, worker_b, _ = spawn_and_worker(project, monkeypatch, state, "fan-b", group="review")
    worker_b.call_tool("report", {"message": "B done"})

    result = leader.call_tool("collect", {"group": "review", "timeout_ms": 0})
    assert result["complete"] is True
    by_name = {w["name"]: w for w in result["workers"]}
    assert by_name["fan-a"]["status"] == "reported"
    assert by_name["fan-a"]["reports"] == [{"body": "A done", "final": True}]
    assert by_name["fan-b"]["terminal"] is True

    again = leader.call_tool("collect", {"group": "review", "timeout_ms": 0})
    assert again["complete"] is True
    assert all(w["reports"] == [] for w in again["workers"])


def test_collect_partial_snapshot_on_timeout(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    _, worker_a, _ = spawn_and_worker(project, monkeypatch, state, "fan-a")
    leader, _, _ = spawn_and_worker(project, monkeypatch, state, "fan-b")
    worker_a.call_tool("report", {"message": "A done"})

    result = leader.call_tool("collect", {"timeout_ms": 0})
    assert result["complete"] is False
    by_name = {w["name"]: w for w in result["workers"]}
    assert by_name["fan-a"]["terminal"] is True
    assert by_name["fan-b"]["status"] == "idle"
    assert by_name["fan-b"]["terminal"] is False


def test_collect_polls_until_reports_arrive(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader, worker, _ = spawn_and_worker(project, monkeypatch, state, "fan-a")
    slept = []

    def sleep_and_report(seconds):
        slept.append(seconds)
        worker.call_tool("report", {"message": "late"})

    monkeypatch.setattr(mcp_server, "_sleep", sleep_and_report)
    result = leader.call_tool("collect", {"timeout_ms": 20_000})
    assert slept == [mcp_server.COLLECT_POLL_SECONDS]
    assert result["complete"] is True
    assert result["workers"][0]["reports"] == [{"body": "late", "final": True}]


def test_collect_nonfinal_report_is_not_terminal(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader, worker, _ = spawn_and_worker(project, monkeypatch, state, "fan-a")
    worker.call_tool("report", {"message": "50% 진행", "final": False})
    result = leader.call_tool("collect", {"timeout_ms": 0})
    assert result["complete"] is False
    assert result["workers"][0]["status"] == "idle"
    assert result["workers"][0]["reports"] == [{"body": "50% 진행", "final": False}]


def test_collect_reports_clamped_timeout(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader, _, _ = spawn_and_worker(project, monkeypatch, state, "fan-a")
    monkeypatch.setattr(mcp_server, "_sleep", lambda s: None)
    monkeypatch.setattr(mcp_server.time, "monotonic", iter(range(100)).__next__)
    result = leader.call_tool("collect", {"timeout_ms": 30000})
    assert result["timeout_ms"] == mcp_server.COLLECT_MAX_TIMEOUT_MS  # 클램프를 숨기지 않는다


def test_collect_no_matching_workers(project, monkeypatch):
    fake_herdr(monkeypatch)
    leader = make_leader(project, monkeypatch)
    result = leader.call_tool("collect", {"timeout_ms": 0})
    assert result == {"status": "OK", "complete": True, "workers": [], "note": "no matching workers"}


def test_collect_marks_dead_after_grace(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    monkeypatch.setattr(mcp_server, "DEAD_GRACE_SECONDS", 0.0)
    leader, _, _ = spawn_and_worker(project, monkeypatch, state, "fan-a")
    state["workers"].clear()
    # 첫 관측 실패는 missing_since 기록일 뿐 dead가 아니다.
    first = leader.call_tool("collect", {"timeout_ms": 0})
    assert first["complete"] is False
    second = leader.call_tool("collect", {"timeout_ms": 0})
    assert second["complete"] is True
    assert second["workers"][0]["status"] == "dead"
    assert second["workers"][0]["terminal"] is True


def test_transient_empty_listing_does_not_kill_workers(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader, _, _ = spawn_and_worker(project, monkeypatch, state, "fan-a")
    live = state["workers"].pop()
    result = leader.call_tool("collect", {"timeout_ms": 0})
    assert result["workers"][0]["status"] == "running"
    # 다음 tick에 재관측되면 missing 기록이 복원된다.
    state["workers"].append(live)
    result = leader.call_tool("collect", {"timeout_ms": 0})
    assert result["workers"][0]["status"] == "idle"
    with ledger.open_db(project) as conn:
        assert ledger.select_workers(conn, LEADER_PANE)[0]["missing_since"] is None


def test_reconcile_ignores_reused_pane_with_other_name(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    monkeypatch.setattr(mcp_server, "DEAD_GRACE_SECONDS", 0.0)
    leader, _, _ = spawn_and_worker(project, monkeypatch, state, "fan-a")
    state["workers"][0]["name"] = "someone-else"
    leader.call_tool("collect", {"timeout_ms": 0})
    result = leader.call_tool("collect", {"timeout_ms": 0})
    assert result["workers"][0]["status"] == "dead"


def test_collect_surfaces_blocked_advisory(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader, _, _ = spawn_and_worker(project, monkeypatch, state, "fan-a")
    state["workers"][0]["status"] = "blocked"
    result = leader.call_tool("collect", {"timeout_ms": 0})
    assert result["workers"][0]["status"] == "blocked"
    assert "개입" in result["workers"][0]["advisory"]


def test_collect_idle_without_report_advisory(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader, _, _ = spawn_and_worker(project, monkeypatch, state, "fan-a")
    result = leader.call_tool("collect", {"timeout_ms": 0})
    assert "리마인드" in result["workers"][0]["advisory"]


def test_collect_degrades_when_herdr_unreachable(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader, _, _ = spawn_and_worker(project, monkeypatch, state, "fan-a")
    monkeypatch.setattr(
        herdr, "list_agent_workers",
        lambda owner=None: (_ for _ in ()).throw(herdr.HerdrError("socket down")),
    )
    result = leader.call_tool("collect", {"timeout_ms": 0})
    assert result["warning"] == "HERDR_UNREACHABLE"
    assert result["workers"][0]["status"] == "running"


def test_dead_worker_with_final_report_stays_reported(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    monkeypatch.setattr(mcp_server, "DEAD_GRACE_SECONDS", 0.0)
    leader, worker, _ = spawn_and_worker(project, monkeypatch, state, "fan-a")
    worker.call_tool("report", {"message": "done"})
    state["workers"].clear()
    leader.call_tool("collect", {"timeout_ms": 0, "consume": False})
    result = leader.call_tool("collect", {"timeout_ms": 0})
    assert result["complete"] is True
    assert result["workers"][0]["status"] == "reported"


def test_list_merges_ledger_info_and_dead_workers(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader, worker, _ = spawn_and_worker(project, monkeypatch, state, "fan-a")
    worker.call_tool("report", {"message": "done"})
    agents = leader.call_tool("list", {})["agents"]
    assert agents[0]["name"] == "fan-a"
    assert agents[0]["reported"] is True
    assert agents[0]["unconsumed_reports"] == 1

    monkeypatch.setattr(mcp_server, "DEAD_GRACE_SECONDS", 0.0)
    state["workers"].clear()
    leader.call_tool("list", {})
    agents = leader.call_tool("list", {})["agents"]
    assert agents[0]["alive"] is False
    assert agents[0]["ledger_status"] == "dead"


def test_list_degrades_when_herdr_unreachable(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader, _, _ = spawn_and_worker(project, monkeypatch, state, "fan-a")
    monkeypatch.setattr(
        herdr, "list_agent_workers",
        lambda owner=None: (_ for _ in ()).throw(herdr.HerdrError("socket down")),
    )
    result = leader.call_tool("list", {})
    assert result["warning"] == "HERDR_UNREACHABLE"
    assert result["agents"][0]["name"] == "fan-a"
    assert "alive" not in result["agents"][0]


def test_list_does_not_mark_starting_row_dead(project, monkeypatch):
    fake_herdr(monkeypatch)
    leader = make_leader(project, monkeypatch)
    with ledger.open_db(project) as conn:
        ledger.add_worker(conn, "booting", LEADER_PANE, model="m", cwd=str(project))
    agents = leader.call_tool("list", {})["agents"]
    assert agents[0]["ledger_status"] == "starting"
    assert "alive" not in agents[0]


def test_headless_spawn_report_collect(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    monkeypatch.setattr(herdr, "list_workspaces", lambda: [
        {"workspace_id": "w1", "label": "other"},
        {"workspace_id": "w9", "label": project.name},
    ])
    clear_env(monkeypatch)
    monkeypatch.setenv("AGENT_CONTROL_OWNER", "owner:test")
    leader = MCPServer(project)
    spawned = leader.call_tool("spawn", {"name": "fan-a", "prompt": "p"})
    assert spawned["status"] == "OK"
    # 프로젝트 label과 일치하는 workspace를 골랐고, nudge용 pane env는 없다.
    assert state["spawn_workspaces"]["fan-a"] == "w9"
    env = state["spawn_envs"]["fan-a"]
    assert env["AGENT_CONTROL_OWNER"] == "owner:test"
    assert "AGENT_LEADER_PANE" not in env

    worker = make_worker(project, monkeypatch, env)
    result = worker.call_tool("report", {"message": "done"})
    assert result == {"status": "OK", "transport": "ledger", "auto_close_seconds": 300}
    assert state["sent"] == [("w1:p-fan-a", "p")]
    assert state["notified"] == ["agent:fan-a final report"]  # 사람용 push는 UI 알림

    clear_env(monkeypatch)
    monkeypatch.setenv("AGENT_CONTROL_OWNER", "owner:test")
    leader = MCPServer(project)
    collected = leader.call_tool("collect", {"timeout_ms": 0})
    assert collected["complete"] is True
    assert collected["workers"][0]["reports"] == [{"body": "done", "final": True}]


def test_cancel_closes_ledger_row(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    scratch_root = project.parent / f"{project.name}-agent-control-scratch"
    monkeypatch.setenv("AGENT_CONTROL_SCRATCH_ROOT", str(scratch_root))
    leader, _, spawned = spawn_and_worker(project, monkeypatch, state, "fan-a")
    scratch = mcp_server.run_scratch_dir(project, "fan-a", spawned["worker_id"])
    assert state["spawn_envs"]["fan-a"]["BUN_TMPDIR"] == str(scratch / "tmp")
    assert (scratch / "tmp").is_dir()
    assert leader.call_tool("cancel", {"target": "fan-a"})["status"] == "OK"
    assert not scratch.exists()
    result = leader.call_tool("collect", {"targets": ["fan-a"], "timeout_ms": 0})
    assert result["complete"] is True
    assert result["workers"][0]["status"] == "closed"


def test_cancel_already_gone_still_closes_ledger(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader, _, _ = spawn_and_worker(project, monkeypatch, state, "fan-a")
    monkeypatch.setattr(
        herdr, "resolve_target",
        lambda target, owner=None: (_ for _ in ()).throw(herdr.HerdrError("gone")),
    )
    assert leader.call_tool("cancel", {"target": "agent:fan-a"})["status"] == "OK"
    result = leader.call_tool("collect", {"timeout_ms": 0})
    assert result["workers"][0]["status"] == "closed"


def test_cancel_already_gone_by_pane_id_closes_ledger(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader, _, spawned = spawn_and_worker(project, monkeypatch, state, "fan-a")
    monkeypatch.setattr(
        herdr, "resolve_target",
        lambda target, owner=None: (_ for _ in ()).throw(herdr.HerdrError("gone")),
    )
    cancelled = leader.call_tool("cancel", {"target": spawned["pane"]})
    assert cancelled["status"] == "OK"
    assert cancelled["pane"] == spawned["pane"]  # ledger가 아는 pane으로 닫는다
    result = leader.call_tool("collect", {"timeout_ms": 0})
    assert result["workers"][0]["status"] == "closed"


def test_cancel_warns_about_unconsumed_reports(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader, worker, _ = spawn_and_worker(project, monkeypatch, state, "fan-a")
    worker.call_tool("report", {"message": "done"})
    result = leader.call_tool("cancel", {"target": "fan-a"})
    assert result["warning"] == "UNCONSUMED_REPORTS"
    assert result["unconsumed_reports"] == 1


def test_report_rejects_mismatched_worker_id(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    _, _, spawned_a = spawn_and_worker(project, monkeypatch, state, "fan-a")
    leader, _, _ = spawn_and_worker(project, monkeypatch, state, "fan-b")
    # fan-b가 fan-a의 worker_id로 report를 시도한다.
    forged = dict(state["spawn_envs"]["fan-b"])
    forged["AGENT_CONTROL_WORKER_ID"] = str(spawned_a["worker_id"])
    impostor = make_worker(project, monkeypatch, forged)
    result = impostor.call_tool("report", {"message": "done"})
    assert result == {"status": "ERROR", "error": "WORKER_ID_MISMATCH",
                      "hint": "이 프로세스에 발급된 AGENT_CONTROL_WORKER_ID가 아니다."}
    with ledger.open_db(project) as conn:
        assert ledger.unconsumed_reports(conn, spawned_a["worker_id"]) == []


def test_collect_empty_targets_matches_nothing(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader, _, _ = spawn_and_worker(project, monkeypatch, state, "fan-a")
    result = leader.call_tool("collect", {"targets": [], "timeout_ms": 0})
    assert result["workers"] == []
    assert result["note"] == "no matching workers"


def test_spawn_worktree_isolation(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    calls = fake_worktree(monkeypatch)
    leader = make_leader(project, monkeypatch)
    spawned = leader.call_tool("spawn", {"name": "fan-a", "prompt": "edit files",
                                         "isolation": "worktree", "oneshot": True})
    assert spawned["status"] == "OK"
    worker_id = spawned["worker_id"]
    expected = str(project / ".agent-control" / "worktrees" / f"fan-a-{worker_id}")
    assert spawned["worktree"] == expected
    assert spawned["branch"] == f"agent/fan-a-{worker_id}"
    assert calls["added"] == [(expected, f"agent/fan-a-{worker_id}", None)]
    assert state["spawn_cwds"]["fan-a"] == expected
    assert state["spawn_envs"]["fan-a"]["AGENT_CONTROL_WORKTREE"] == expected
    assert state["spawn_envs"]["fan-a"]["AGENT_CONTROL_BRANCH"] == f"agent/fan-a-{worker_id}"
    assert state["sent"][-1][1] == "edit files"
    with ledger.open_db(project) as conn:
        row = ledger.select_workers(conn, LEADER_PANE)[0]
    assert row["worktree"] == expected
    assert row["oneshot"] == 1


def test_dispatch_auto_approves_permissions(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    fake_worktree(monkeypatch)
    leader = make_leader(project, monkeypatch)

    dispatch_one(leader, isolation="worktree")

    assert "opencode run --auto --format json" in state["launches"]["fan-a"]["command"]
    assert "--title fan-a" in state["launches"]["fan-a"]["command"]


def test_spawn_worktree_failure_closes_row(project, monkeypatch):
    fake_herdr(monkeypatch)
    monkeypatch.setattr(mcp_server, "git_worktree_add", lambda *a: "not a git repo")
    leader = make_leader(project, monkeypatch)
    result = leader.call_tool("spawn", {"name": "fan-a", "prompt": "p", "isolation": "worktree"})
    assert result["error"] == "WORKTREE_FAILED"
    with ledger.open_db(project) as conn:
        row = ledger.select_workers(conn, LEADER_PANE)[0]
    assert row["close_reason"] == "startup_failed"


def test_oneshot_cleanup_on_collect_consume(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    calls = fake_worktree(monkeypatch)
    leader = make_leader(project, monkeypatch)
    spawned = leader.call_tool("spawn", {"name": "fan-a", "prompt": "p",
                                         "isolation": "worktree", "oneshot": True})
    worker = make_worker(project, monkeypatch, state["spawn_envs"]["fan-a"])
    worker.call_tool("report", {"message": "done"})
    leader = make_leader(project, monkeypatch)

    result = leader.call_tool("collect", {"timeout_ms": 0})
    entry = result["workers"][0]
    assert entry["closed"] is True
    assert entry["worktree_removed"] == spawned["worktree"]
    assert state["closed"] == [spawned["pane"]]
    assert calls["removed"] == [spawned["worktree"]]
    with ledger.open_db(project) as conn:
        row = ledger.select_workers(conn, LEADER_PANE)[0]
    assert row["close_reason"] == "oneshot_done"


def test_oneshot_dirty_worktree_is_kept(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    calls = fake_worktree(monkeypatch, dirty=True)
    leader = make_leader(project, monkeypatch)
    spawned = leader.call_tool("spawn", {"name": "fan-a", "prompt": "p",
                                         "isolation": "worktree", "oneshot": True})
    worker = make_worker(project, monkeypatch, state["spawn_envs"]["fan-a"])
    worker.call_tool("report", {"message": "done"})
    leader = make_leader(project, monkeypatch)

    entry = leader.call_tool("collect", {"timeout_ms": 0})["workers"][0]
    assert entry["worktree_kept"] == spawned["worktree"]
    assert calls["removed"] == []


def test_oneshot_without_final_report_is_not_cleaned(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    fake_worktree(monkeypatch)
    leader = make_leader(project, monkeypatch)
    leader.call_tool("spawn", {"name": "fan-a", "prompt": "p", "oneshot": True})
    result = leader.call_tool("collect", {"timeout_ms": 0})
    assert result["complete"] is False
    assert "closed" not in result["workers"][0]
    assert state["closed"] == []


def test_cancel_worktree_cleanup_and_keep_option(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    calls = fake_worktree(monkeypatch)
    leader = make_leader(project, monkeypatch)
    spawned = leader.call_tool("spawn", {"name": "fan-a", "prompt": "p", "isolation": "worktree"})
    result = leader.call_tool("cancel", {"target": "fan-a"})
    assert result["worktree_removed"] == spawned["worktree"]

    state["workers"].clear()
    spawned = leader.call_tool("spawn", {"name": "fan-b", "prompt": "p", "isolation": "worktree"})
    result = leader.call_tool("cancel", {"target": "fan-b", "keep_worktree": True})
    assert "worktree_removed" not in result
    assert calls["removed"] == [str(project / ".agent-control" / "worktrees" / "fan-a-1")]


def test_worker_project_env_overrides_cli_project(project, monkeypatch, tmp_path_factory):
    state = fake_herdr(monkeypatch)
    _, _, spawned = spawn_and_worker(project, monkeypatch, state, "fan-a")
    clear_env(monkeypatch)
    for key, value in state["spawn_envs"]["fan-a"].items():
        monkeypatch.setenv(key, value)
    # worktree에서 뜬 worker처럼 --project가 엉뚱한 경로를 가리켜도 env가 이긴다.
    wrong = tmp_path_factory.mktemp("worktree-cwd")
    worker = MCPServer(wrong)
    assert worker.project == project.resolve()
    worker.call_tool("report", {"message": "done"})
    with ledger.open_db(project) as conn:
        assert len(ledger.unconsumed_reports(conn, spawned["worker_id"])) == 1


def test_group_done_marker_wakes_tui_leader(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    _, worker_a, _ = spawn_and_worker(project, monkeypatch, state, "fan-a", group="review")
    _, worker_b, _ = spawn_and_worker(project, monkeypatch, state, "fan-b", group="review")

    worker_a.call_tool("report", {"message": "A done"})
    assert not any("AGENT_GROUP_DONE" in text for _, text in state["sent"])
    worker_b.call_tool("report", {"message": "B done"})
    assert state["sent"][-1] == (
        LEADER_PANE, "[AGENT_GROUP_DONE review] 2/2 interactive report 완료",
    )


def test_group_done_counts_dead_workers_as_terminal(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    monkeypatch.setattr(mcp_server, "DEAD_GRACE_SECONDS", 0.0)
    leader, _, _ = spawn_and_worker(project, monkeypatch, state, "fan-a", group="review")
    _, worker_b, _ = spawn_and_worker(project, monkeypatch, state, "fan-b", group="review")
    # fan-a가 죽어도 fan-b의 final report가 그룹 완주를 확정해야 한다.
    dead = next(w for w in state["workers"] if w["name"] == "fan-a")
    state["workers"].remove(dead)
    leader.call_tool("collect", {"timeout_ms": 0, "consume": False})
    leader.call_tool("collect", {"timeout_ms": 0, "consume": False})
    worker_b.call_tool("report", {"message": "B done"})
    assert "[AGENT_GROUP_DONE review]" in state["sent"][-1][1]


def test_headless_group_completion_notifies_and_wakes(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    monkeypatch.setattr(herdr, "list_workspaces", lambda: [{"workspace_id": "w9", "label": project.name}])
    woken = []
    monkeypatch.setattr(mcp_server, "spawn_wake_cmd", lambda cmd: woken.append(cmd))
    clear_env(monkeypatch)
    monkeypatch.setenv("AGENT_CONTROL_OWNER", "owner:test")
    monkeypatch.setenv("AGENT_CONTROL_WAKE_CMD", "curl -s http://wake.me")
    leader = MCPServer(project)
    leader.call_tool("spawn", {"name": "fan-a", "prompt": "p", "group": "solo"})
    env = state["spawn_envs"]["fan-a"]
    assert env["AGENT_CONTROL_WAKE_CMD"] == "curl -s http://wake.me"

    worker = make_worker(project, monkeypatch, env)
    result = worker.call_tool("report", {"message": "done"})
    assert result["group_complete"] == {"group": "solo", "total": 1}
    assert state["notified"][-1] == "group solo 완료 1/1"
    assert woken == ["curl -s http://wake.me"]


def test_run_mode_spawn_report_collect_cleanup(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader = make_leader(project, monkeypatch)
    launched = dispatch_one(leader, "fan-a")
    env = state["spawn_envs"]["fan-a"]
    launch = state["launches"]["fan-a"]
    # 실제 작업만 prompt 파일 경유 argv로 전달되고, 계약 metadata는 system prompt용 env다.
    prompt_file = project / ".agent-control" / "prompts" / f"fan-a-{launched['worker_id']}.md"
    assert prompt_file.exists()
    content = prompt_file.read_text()
    assert content == "task fan-a"  # {item} 치환
    assert env["AGENT_CONTROL_REPORT_PATH"].endswith("/.agent-control/reports/fan-a.md")
    assert str(prompt_file) in launch["command"]
    assert "run --auto --format json" in launch["command"]
    assert "--title fan-a" in launch["command"]
    assert "tools.agent_control.postrun" in launch["command"]  # 종료 훅 체인
    assert launched["pid"] == launch["pid"]
    assert state["sent"] == []
    assert [worker["name"] for worker in state["workers"]] == ["batch-test"]
    # dispatch worker 자체는 pane이 없고, 필수 group monitor만 Herdr에 존재한다.

    worker = make_worker(project, monkeypatch, env)
    worker.call_tool("report", {"message": "done"})
    assert state["sent"] == [
        (LEADER_PANE, "[AGENT_GROUP_DONE test] 1/1 final report 완료 — collect로 수거하라"),
    ]  # 개별 report가 아니라 group completion만 한 번 보낸다.
    leader = make_leader(project, monkeypatch)
    result = leader.call_tool("collect", {"timeout_ms": 0})
    assert result["complete"] is True
    entry = result["workers"][0]
    assert entry["reports"] == [{"body": "done", "final": True}]
    assert entry["closed"] is True  # dispatch는 oneshot 고정
    assert not prompt_file.exists()  # oneshot 정리가 prompt 파일도 지운다


def test_collect_removes_live_json_events_after_report(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader = make_leader(project, monkeypatch)
    launched = dispatch_one(leader, "fan-a")
    live_dir = mcp_server.run_live_dir(project, "fan-a", launched["worker_id"])
    live_dir.mkdir(parents=True)
    (live_dir / "events.jsonl").write_text('{"type":"step_start"}\n')
    (live_dir / "stderr.log").write_text("diagnostic\n")
    worker = make_worker(project, monkeypatch, state["spawn_envs"]["fan-a"])
    worker.call_tool("report", {"message": "done"})

    leader = make_leader(project, monkeypatch)
    assert leader.call_tool("collect", {"timeout_ms": 0})["complete"] is True
    assert not live_dir.exists()


def test_dead_worker_live_events_survive_until_consuming_collect(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader = make_leader(project, monkeypatch)
    launched = dispatch_one(leader, "fan-a")
    live_dir = mcp_server.run_live_dir(project, "fan-a", launched["worker_id"])
    live_dir.mkdir(parents=True)
    (live_dir / "events.jsonl").write_text('{"type":"step_start"}\n')
    state["alive_pids"].discard(launched["pid"])

    result = leader.call_tool("collect", {"timeout_ms": 0, "consume": False})
    assert result["workers"][0]["status"] == "dead"
    assert live_dir.exists()
    leader.call_tool("collect", {"timeout_ms": 0, "consume": True})
    assert not live_dir.exists()


def test_run_mode_rejects_send(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader = make_leader(project, monkeypatch)
    dispatch_one(leader, "fan-a")
    # dispatch worker는 herdr agent facade에 없다.
    monkeypatch.setattr(
        herdr, "resolve_target",
        lambda target, owner=None: (_ for _ in ()).throw(herdr.HerdrError("not an agent")),
    )
    result = leader.call_tool("send", {"target": "fan-a", "message": "more"})
    assert result["error"] == "SEND_NOT_SUPPORTED_FOR_DISPATCH_WORKER"


def test_run_mode_liveness_via_pane_and_duplicate_check(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    monkeypatch.setattr(mcp_server, "DEAD_GRACE_SECONDS", 0.0)
    leader = make_leader(project, monkeypatch)
    launched = dispatch_one(leader, "fan-a")
    # dispatch worker는 pid가 살아있으면 dead가 아니다.
    result = leader.call_tool("collect", {"timeout_ms": 0, "consume": False})
    assert result["workers"][0]["status"] == "running"
    # 실행 중인 동명 worker가 있으면 중복 dispatch는 거절된다.
    dup = leader.call_tool("dispatch", {
        "template": "again {item}", "items": ["fan-a"], "group": "test",
    })
    assert dup["rejected"] == [{"item": "fan-a", "error": "DUPLICATE_NAME"}]
    # 프로세스가 죽으면(report 없이) 유예 없이 즉시 dead.
    state["alive_pids"].discard(launched["pid"])
    result = leader.call_tool("collect", {"timeout_ms": 0, "consume": False})
    assert result["workers"][0]["status"] == "dead"


def test_run_worker_death_after_report_closes_cleanly(project, monkeypatch):
    # report 후 프로세스가 죽었는데 postrun이 실패한 경우 — reconcile이 정상 종료로 닫는다.
    state = fake_herdr(monkeypatch)
    leader = make_leader(project, monkeypatch)
    launched = dispatch_one(leader, "fan-a")
    worker = make_worker(project, monkeypatch, state["spawn_envs"]["fan-a"])
    worker.call_tool("report", {"message": "done"})
    state["alive_pids"].discard(launched["pid"])
    leader = make_leader(project, monkeypatch)
    result = leader.call_tool("collect", {"timeout_ms": 0, "consume": False})
    assert result["complete"] is True
    assert result["workers"][0]["status"] == "reported"
    with ledger.open_db(project) as conn:
        row = ledger.select_workers(conn, LEADER_PANE, names=["fan-a"])[0]
    assert row["close_reason"] == "oneshot_done"


def test_spawn_rejects_duplicate_while_starting(project, monkeypatch):
    fake_herdr(monkeypatch)
    leader = make_leader(project, monkeypatch)
    # 병렬 spawn race의 직렬화 결과와 동일한 상태: pane 미배정 starting row가 살아있다.
    with ledger.open_db(project) as conn:
        ledger.add_worker(conn, "fan-a", LEADER_PANE, model="m", cwd=str(project))
    result = leader.call_tool("spawn", {"name": "fan-a", "prompt": "p"})
    assert result["error"] == "DUPLICATE_NAME"


def test_consume_reports_claims_atomically(project):
    with ledger.open_db(project) as conn:
        wid = ledger.add_worker(conn, "w", "o", model="m", cwd=".")
        rid = ledger.add_report(conn, wid, "x", is_final=True)
    with ledger.open_db(project) as conn:
        assert ledger.consume_reports(conn, [rid]) == {rid}
    with ledger.open_db(project) as conn:
        assert ledger.consume_reports(conn, [rid]) == set()


def test_run_worker_shown_alive_in_list(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader = make_leader(project, monkeypatch)
    dispatch_one(leader, "fan-a")
    monkeypatch.setattr(herdr, "list_agent_workers", lambda owner=None: [])
    agents = leader.call_tool("list", {})["agents"]
    assert agents[0]["mode"] == "run"
    assert agents[0]["alive"] is True


def test_list_excludes_live_worker_from_another_project(project, monkeypatch):
    fake_herdr(monkeypatch)
    leader = make_leader(project, monkeypatch)
    monkeypatch.setattr(herdr, "list_agent_workers", lambda owner=None: [{
        "name": "foreign",
        "agent": "agent:foreign",
        "pane": "w1:p9",
        "alive": True,
        "status": "idle",
        "owner_pane": LEADER_PANE,
        "project": "/tmp/another-project",
    }])

    agents = leader.call_tool("list", {})["agents"]

    assert agents == []


def test_cancel_kills_run_worker_process(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader = make_leader(project, monkeypatch)
    launched = dispatch_one(leader, "fan-a")
    result = leader.call_tool("cancel", {"target": "fan-a"})
    assert result["killed_pid"] == launched["pid"]
    assert state["killed"] == [launched["pid"]]
    assert state["closed"] == []  # pane이 애초에 없다


def test_oneshot_pane_close_failure_is_honest_and_retried(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader = make_leader(project, monkeypatch)
    leader.call_tool("spawn", {"name": "fan-a", "prompt": "p", "oneshot": True})
    worker = make_worker(project, monkeypatch, state["spawn_envs"]["fan-a"])
    worker.call_tool("report", {"message": "done"})
    leader = make_leader(project, monkeypatch)
    monkeypatch.setattr(
        herdr, "close",
        lambda pane: (_ for _ in ()).throw(herdr.HerdrError("daemon busy")),
    )
    entry = leader.call_tool("collect", {"timeout_ms": 0})["workers"][0]
    assert "closed" not in entry
    assert entry["warning"] == "PANE_CLOSE_FAILED"
    # 다음 collect에서 재시도되어 성공한다.
    monkeypatch.setattr(herdr, "close", lambda pane: state["closed"].append(pane))
    entry = leader.call_tool("collect", {"timeout_ms": 0})["workers"][0]
    assert entry["closed"] is True


def test_list_all_owners_diagnostic_view(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader, _, _ = spawn_and_worker(project, monkeypatch, state, "fan-a")
    clear_env(monkeypatch)
    monkeypatch.setenv("AGENT_CONTROL_OWNER", "someone-else")
    stranger = MCPServer(project)
    assert stranger.call_tool("list", {})["agents"] == []
    diagnostic = stranger.call_tool("list", {"all_owners": True})
    assert diagnostic["agents"][0]["name"] == "fan-a"
    assert diagnostic["agents"][0]["owner"] == LEADER_PANE


def test_explicit_owner_beats_inherited_pane_env(project, monkeypatch):
    # Herdr pane에서 실행된 headless 세션은 HERDR_PANE_ID/WORKSPACE_ID를 상속받는다.
    # 명시 설정이 있으면 상속 env가 리더 행세를 하면 안 된다(남의 pane에 nudge 유출).
    state = fake_herdr(monkeypatch)
    clear_env(monkeypatch)
    monkeypatch.setenv("HERDR_PANE_ID", "w6F:p1")
    monkeypatch.setenv("HERDR_WORKSPACE_ID", "w6F")
    monkeypatch.setenv("AGENT_CONTROL_OWNER", "owner:exp1")
    monkeypatch.setenv("HERDR_DEFAULT_WORKSPACE", "w8A")
    leader = MCPServer(project)
    assert leader.owner_id() == "owner:exp1"
    dispatch_one(leader, "fan-a", group="g")
    assert "AGENT_LEADER_PANE" not in state["spawn_envs"]["fan-a"]
    # workspace 폴백은 monitor pane 생성에 쓰인다 — 명시(w8A)가 상속(w6F)을 이긴다.
    assert state["spawn_workspaces"]["batch-g"] == "w8A"


def test_session_identity_resolves_exact_leader_pane(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    monkeypatch.setattr(herdr, "list_agents", lambda: [
        {
            "pane_id": "wAK:p1", "workspace_id": "wAK",
            "agent_session": {"value": "ses-tab-1"},
        },
        {
            "pane_id": "wAK:p5", "workspace_id": "wAK",
            "agent_session": {"value": "ses-tab-2"},
        },
    ])
    clear_env(monkeypatch)
    monkeypatch.setenv("HERDR_PANE_ID", "wAK:p1")
    monkeypatch.setenv("HERDR_WORKSPACE_ID", "wAK")
    monkeypatch.setenv("AGENT_CONTROL_OWNER", "owner:ses-tab-2")
    monkeypatch.setenv("AGENT_CONTROL_SESSION_ID", "ses-tab-2")
    leader = MCPServer(project)

    spawned = leader.call_tool("spawn", {"name": "tab-two-worker", "prompt": "task"})

    assert spawned["status"] == "OK"
    with ledger.open_db(project) as conn:
        row = ledger.select_workers(conn, "wAK:p5", names=["tab-two-worker"])[0]
    assert row["owner"] == "wAK:p5"
    assert state["spawn_envs"]["tab-two-worker"]["AGENT_LEADER_PANE"] == "wAK:p5"


def test_session_identity_prefers_ambient_pane_over_cross_workspace_stale_match(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    monkeypatch.setattr(herdr, "list_agents", lambda: [
        {
            "pane_id": "w8D:p1", "workspace_id": "w8D",
            "agent_session": {"value": "ses-restored"},
        },
    ])
    clear_env(monkeypatch)
    monkeypatch.setenv("HERDR_PANE_ID", "wB3:p3")
    monkeypatch.setenv("HERDR_WORKSPACE_ID", "wB3")
    monkeypatch.setenv("AGENT_CONTROL_OWNER", "owner:ses-restored")
    monkeypatch.setenv("AGENT_CONTROL_SESSION_ID", "ses-restored")
    leader = MCPServer(project)

    spawned = leader.call_tool("spawn", {"name": "restored-worker", "prompt": "task"})

    assert spawned["status"] == "OK"
    with ledger.open_db(project) as conn:
        row = ledger.select_workers(conn, "wB3:p3", names=["restored-worker"])[0]
    assert row["owner"] == "wB3:p3"
    assert state["spawn_envs"]["restored-worker"]["AGENT_LEADER_PANE"] == "wB3:p3"
    assert state["spawn_workspaces"]["restored-worker"] == "wB3"


def test_session_identity_uses_ambient_pane_when_session_match_is_missing(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    monkeypatch.setattr(herdr, "list_agents", lambda: [])
    clear_env(monkeypatch)
    monkeypatch.setenv("HERDR_PANE_ID", "wB3:p2")
    monkeypatch.setenv("HERDR_WORKSPACE_ID", "wB3")
    monkeypatch.setenv("AGENT_CONTROL_OWNER", "owner:ses-restored-missing")
    monkeypatch.setenv("AGENT_CONTROL_SESSION_ID", "ses-restored-missing")
    leader = MCPServer(project)

    spawned = leader.call_tool("spawn", {"name": "missing-session-worker", "prompt": "task"})

    assert spawned["status"] == "OK"
    with ledger.open_db(project) as conn:
        row = ledger.select_workers(conn, "wB3:p2", names=["missing-session-worker"])[0]
    assert row["owner"] == "wB3:p2"
    assert state["spawn_envs"]["missing-session-worker"]["AGENT_LEADER_PANE"] == "wB3:p2"


def test_spawn_target_routes_report_to_semantic_parent_agent(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader = make_leader(project, monkeypatch)
    parent = leader.call_tool("spawn", {"name": "foundation", "prompt": "build foundation"})

    child = leader.call_tool("spawn", {
        "name": "page-p01",
        "prompt": "build page",
        "target": "agent:foundation",
    })

    assert child["status"] == "OK", child
    with ledger.open_db(project) as conn:
        row = ledger.select_workers(conn, parent["pane"], names=["page-p01"])[0]
    assert row["owner"] == parent["pane"]
    assert state["spawn_envs"]["page-p01"]["AGENT_LEADER_PANE"] == parent["pane"]


def test_owner_env_gets_namespace_prefix(project, monkeypatch):
    clear_env(monkeypatch)
    monkeypatch.setenv("AGENT_CONTROL_OWNER", "w1:p1")  # pane id 형식 실수
    server = MCPServer(project)
    assert server.owner_id() == "owner:w1:p1"


def test_postrun_marks_dead_and_wakes_leader(project, monkeypatch):
    from tools.agent_control import postrun

    state = fake_herdr(monkeypatch)
    leader = make_leader(project, monkeypatch)
    leader.call_tool("dispatch", {
        "template": "task {item}", "items": ["fan-a", "fan-b"], "group": "g",
    })

    # fan-a가 report 없이 종료 — 그룹 미완주이므로 AGENT_DEAD로 깨운다.
    clear_env(monkeypatch)
    for key, value in state["spawn_envs"]["fan-a"].items():
        monkeypatch.setenv(key, value)
    postrun.main()
    assert "[AGENT_DEAD fan-a]" in state["sent"][-1][1]
    with ledger.open_db(project) as conn:
        row = ledger.select_workers(conn, LEADER_PANE, names=["fan-a"])[0]
    assert row["status"] == "dead"
    assert row["close_reason"] == "run_exit_no_report"

    # fan-b도 report 없이 종료 — 이 죽음으로 그룹이 완주되므로 GROUP_DONE으로 깨운다.
    clear_env(monkeypatch)
    for key, value in state["spawn_envs"]["fan-b"].items():
        monkeypatch.setenv(key, value)
    postrun.main()
    assert "[AGENT_GROUP_DONE g] 2/2" in state["sent"][-1][1]


def test_postrun_after_final_report_self_cleans(project, monkeypatch):
    from tools.agent_control import postrun

    state = fake_herdr(monkeypatch)
    leader = make_leader(project, monkeypatch)
    launched = dispatch_one(leader, "fan-a")
    worker = make_worker(project, monkeypatch, state["spawn_envs"]["fan-a"])
    worker.call_tool("report", {"message": "done"})
    sent_before = len(state["sent"])
    postrun.main()  # worker env가 그대로 살아있는 상태에서 훅 실행
    assert len(state["sent"]) == sent_before  # 죽음 신호는 없다
    prompt_file = project / ".agent-control" / "prompts" / f"fan-a-{launched['worker_id']}.md"
    assert not prompt_file.exists()  # 자기 잔여물을 정리했다
    with ledger.open_db(project) as conn:
        row = ledger.select_workers(conn, LEADER_PANE, names=["fan-a"])[0]
    assert row["close_reason"] == "oneshot_done"
    # 정리 이후에도 collect는 report를 정상 수거한다.
    leader = make_leader(project, monkeypatch)
    result = leader.call_tool("collect", {"timeout_ms": 0})
    assert result["complete"] is True
    assert result["workers"][0]["reports"] == [{"body": "done", "final": True}]


def test_postrun_headless_uses_notify_and_wake(project, monkeypatch):
    from tools.agent_control import postrun

    state = fake_herdr(monkeypatch)
    monkeypatch.setattr(herdr, "list_workspaces", lambda: [{"workspace_id": "w9", "label": project.name}])
    woken = []
    monkeypatch.setattr(mcp_server, "spawn_wake_cmd", lambda cmd: woken.append(cmd))
    clear_env(monkeypatch)
    monkeypatch.setenv("AGENT_CONTROL_OWNER", "owner:test")
    monkeypatch.setenv("AGENT_CONTROL_WAKE_CMD", "curl -s http://wake.me")
    leader = MCPServer(project)
    dispatch_one(leader, "fan-a")

    clear_env(monkeypatch)
    for key, value in state["spawn_envs"]["fan-a"].items():
        monkeypatch.setenv(key, value)
    postrun.main()
    assert state["notified"][-1] == "group test 완료 (일부 실패)"
    assert woken == ["curl -s http://wake.me"]


def test_monitor_created_once_per_group(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader = make_leader(project, monkeypatch)
    leader.call_tool("dispatch", {"template": "t {item}", "items": ["a1"], "group": "pilot"})
    leader.call_tool("dispatch", {"template": "t {item}", "items": ["a2"], "group": "pilot"})
    monitors = [w for w in state["workers"] if w["name"] == "batch-pilot"]
    assert len(monitors) == 1  # 두 번째 dispatch는 기존 monitor를 재사용한다
    cmd = state["spawn_envs"]["batch-pilot"]["AGENT_CONTROL_RUN_CMD"]
    assert "tools.agent_control.monitor" in cmd
    assert "--group pilot" in cmd
    # monitor는 collect/list 결과에 섞이지 않는다.
    result = leader.call_tool("collect", {"group": "pilot", "timeout_ms": 0, "consume": False})
    assert sorted(w["name"] for w in result["workers"]) == ["a1", "a2"]
    agents = leader.call_tool("list", {})["agents"]
    assert "batch-pilot" not in [a["name"] for a in agents]


def test_reconcile_marks_missing_monitor_dead_after_grace(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    monkeypatch.setattr(mcp_server, "DEAD_GRACE_SECONDS", 0.0)
    leader = make_leader(project, monkeypatch)
    leader.call_tool("dispatch", {
        "template": "t {item}", "items": ["a1"], "group": "pilot",
    })
    state["workers"] = [w for w in state["workers"] if w["name"] != "batch-pilot"]

    leader.call_tool("collect", {"group": "pilot", "timeout_ms": 0, "consume": False})
    leader.call_tool("collect", {"group": "pilot", "timeout_ms": 0, "consume": False})

    with ledger.open_db(project) as conn:
        monitor_row = next(
            row for row in ledger.select_workers(conn, LEADER_PANE, group="pilot")
            if row["mode"] == "monitor"
        )
    assert monitor_row["status"] == "dead"
    assert monitor_row["close_reason"] == "dead"


def test_reconcile_restores_transiently_missing_monitor(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader = make_leader(project, monkeypatch)
    leader.call_tool("dispatch", {
        "template": "t {item}", "items": ["a1"], "group": "pilot",
    })
    monitor = next(w for w in state["workers"] if w["name"] == "batch-pilot")
    state["workers"].remove(monitor)

    leader.call_tool("collect", {"group": "pilot", "timeout_ms": 0, "consume": False})
    state["workers"].append(monitor)
    leader.call_tool("collect", {"group": "pilot", "timeout_ms": 0, "consume": False})

    with ledger.open_db(project) as conn:
        monitor_row = next(
            row for row in ledger.select_workers(conn, LEADER_PANE, group="pilot")
            if row["mode"] == "monitor"
        )
    assert monitor_row["status"] == "running"
    assert monitor_row["missing_since"] is None


def test_monitor_snapshot_and_render(project, monkeypatch):
    from tools.agent_control import monitor

    state = fake_herdr(monkeypatch)
    leader = make_leader(project, monkeypatch)
    leader.call_tool("dispatch", {
        "template": "t {item}", "items": ["a1", "a2"], "group": "pilot",
    })
    worker = make_worker(project, monkeypatch, state["spawn_envs"]["a1"])
    worker.call_tool("report", {"message": "a1 완료"})

    snap = monitor.snapshot(project, LEADER_PANE, "pilot")
    assert snap["total"] == 2
    assert snap["counts"]["reported"] == 1
    assert snap["counts"]["running"] == 1
    assert snap["complete"] is False
    text = monitor.render(snap)
    assert "batch:pilot" in text
    assert "1/2" in text
    assert "a1 완료" in text


def test_monitor_freezes_elapsed_time_for_terminal_workers(project, monkeypatch):
    from tools.agent_control import ledger, monitor

    state = fake_herdr(monkeypatch)
    monkeypatch.setattr(ledger.time, "time", lambda: 100.0)
    leader = make_leader(project, monkeypatch)
    leader.call_tool("dispatch", {
        "template": "t {item}", "items": ["reported", "dead", "stopped"], "group": "pilot",
    })
    reported = make_worker(project, monkeypatch, state["spawn_envs"]["reported"])
    monkeypatch.setattr(ledger.time, "time", lambda: 130.0)
    reported.call_tool("report", {"message": "done"})
    with ledger.open_db(project) as conn:
        rows = {row["name"]: row for row in ledger.select_workers(conn, LEADER_PANE, group="pilot")}
        monkeypatch.setattr(ledger.time, "time", lambda: 140.0)
        ledger.close_worker(conn, rows["dead"]["id"], "dead", status="dead")
        monkeypatch.setattr(ledger.time, "time", lambda: 150.0)
        ledger.close_worker(conn, rows["stopped"]["id"], "workflow_stopped")
    monkeypatch.setattr(monitor.time, "time", lambda: 999.0)

    snap = monitor.snapshot(project, LEADER_PANE, "pilot")

    elapsed = {item["name"]: item["elapsed"] for item in snap["items"]}
    assert elapsed == {"reported": 30, "dead": 40, "stopped": 50}


def test_monitor_adapts_wide_compact_and_narrow_cells():
    from tools.agent_control import monitor

    snap = {
        "group": "pilot", "total": 1, "done": 0, "unconsumed": 0, "complete": False,
        "counts": {"pending": 0, "running": 1, "reported": 0, "dead": 0, "closed": 0},
        "recent": [],
        "items": [{
            "id": 1, "name": "alpha", "state": "running", "elapsed": 65,
            "pid": 123, "model": "openai/test", "agent": "build",
            "prompt": "inspect exact behavior", "prompt_preview": "inspect exact behavior",
            "close_reason": None,
        }],
    }
    for width in (140, 90, 52):
        rendered = monitor.render(snap, width=width, height=20)
        visible = [mcp_server.strip_ansi(line) for line in rendered.splitlines()]
        assert len(visible) == 20
        assert all(len(line) == width for line in visible)
        assert "[0/1" in visible[0]
        assert "[#" not in visible[1]  # zero progress
        assert "RUN 1" in visible[1] or "R1" in visible[1]
    assert "INSPECTOR" in mcp_server.strip_ansi(monitor.render(snap, width=140, height=20))
    assert "INSPECTOR" not in mcp_server.strip_ansi(monitor.render(snap, width=90, height=20))
    colored = monitor.render(snap, width=90, height=20)
    assert monitor.CYAN in colored and monitor.AMBER in colored
    assert monitor.GREEN in colored and monitor.RED in colored


def test_monitor_uses_terminal_cell_width_for_cjk_and_emoji():
    from tools.agent_control import monitor

    snap = {
        "group": "전투🙂", "total": 1, "done": 0, "unconsumed": 0, "complete": False,
        "counts": {"pending": 0, "running": 1, "reported": 0, "dead": 0, "closed": 0},
        "recent": [],
        "items": [{
            "id": 1, "name": "규칙-é", "state": "running", "elapsed": 65,
            "pid": 123, "model": "openai/test", "agent": "build",
            "prompt": "동시 피해 판정🙂 정확히 조사", "prompt_preview": "동시 피해 판정🙂 정확히 조사",
            "close_reason": None,
        }],
    }
    for width in (140, 90, 52):
        rendered = monitor.render(snap, width=width, height=20)
        visible = [mcp_server.strip_ansi(line) for line in rendered.splitlines()]
        assert all(monitor._cell_width(line) == width for line in visible)


def test_monitor_interactive_uses_terminal_alt_screen(project, monkeypatch):
    from tools.agent_control import monitor

    fake_herdr(monkeypatch)
    leader = make_leader(project, monkeypatch)
    dispatch_one(leader, "fan-a", group="pilot")
    master_fd, slave_fd = pty.openpty()
    fake_stdin = os.fdopen(os.dup(slave_fd), "r", buffering=1)
    fake_stdout = os.fdopen(os.dup(slave_fd), "w", buffering=1)
    monkeypatch.setattr(monitor.sys, "stdin", fake_stdin)
    monkeypatch.setattr(monitor.sys, "stdout", fake_stdout)
    keys = iter([None, None, "x"])
    monkeypatch.setattr(monitor, "_read_key", lambda timeout: next(keys))
    monkeypatch.setattr(monitor.shutil, "get_terminal_size", lambda fallback: os.terminal_size((90, 24)))
    try:
        assert monitor.run_interactive(project, LEADER_PANE, "pilot") == "monitor_detached"
        fake_stdout.flush()
        os.set_blocking(master_fd, False)
        chunks = []
        while True:
            try:
                chunks.append(os.read(master_fd, 100_000))
            except BlockingIOError:
                break
        output = b"".join(chunks).decode(errors="replace")
    finally:
        fake_stdin.close()
        fake_stdout.close()
        os.close(master_fd)
        os.close(slave_fd)
    assert monitor.ALT_ON in output
    assert monitor.ALT_OFF in output
    assert output.count(monitor.CLEAR) == 1
    assert "batch:pilot" in mcp_server.strip_ansi(output)


def test_monitor_k_key_terminates_real_process(project, monkeypatch):
    from tools.agent_control import monitor

    real_pid_alive = mcp_server.pid_alive
    real_terminate = mcp_server.terminate_process
    fake_herdr(monkeypatch)
    monkeypatch.setattr(mcp_server, "pid_alive", real_pid_alive)
    monkeypatch.setattr(mcp_server, "terminate_process", real_terminate)
    leader = make_leader(project, monkeypatch)
    process = subprocess.Popen(
        ["sleep", "30"], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL, start_new_session=True,
    )
    try:
        with ledger.open_db(project) as conn:
            worker_id = ledger.add_worker(
                conn, "kill-real", LEADER_PANE, model="test/sleep", cwd=str(project),
                group="kill-real-group", oneshot=True, mode="run", status="starting",
            )
            ledger.set_workflow_running(conn, LEADER_PANE, "kill-real-group")
            ledger.set_prompt_text(conn, worker_id, "real kill test")
            ledger.mark_started_pid(
                conn, worker_id, process.pid, mcp_server.process_start_ticks(process.pid), os.getpgid(process.pid),
            )
        master_fd, slave_fd = pty.openpty()
        fake_stdin = os.fdopen(os.dup(slave_fd), "r", buffering=1)
        fake_stdout = os.fdopen(os.dup(slave_fd), "w", buffering=1)
        monkeypatch.setattr(monitor.sys, "stdin", fake_stdin)
        monkeypatch.setattr(monitor.sys, "stdout", fake_stdout)
        keys = iter(["K", "y", "x"])
        monkeypatch.setattr(monitor, "_read_key", lambda timeout: next(keys))
        monkeypatch.setattr(monitor.shutil, "get_terminal_size", lambda fallback: os.terminal_size((90, 24)))
        try:
            assert monitor.run_interactive(project, LEADER_PANE, "kill-real-group") == "monitor_detached"
        finally:
            fake_stdin.close()
            fake_stdout.close()
            os.close(master_fd)
            os.close(slave_fd)
        process.wait(timeout=3)
        with ledger.open_db(project) as conn:
            row = ledger.worker_row(conn, worker_id)
        assert row["close_reason"] == "user_killed"
    finally:
        if process.poll() is None:
            process.kill()


def test_monitor_q_key_stops_real_workflow_processes(project, monkeypatch):
    from tools.agent_control import monitor

    real_pid_alive = mcp_server.pid_alive
    real_terminate = mcp_server.terminate_process
    state = fake_herdr(monkeypatch)
    monkeypatch.setattr(mcp_server, "pid_alive", real_pid_alive)
    monkeypatch.setattr(mcp_server, "terminate_process", real_terminate)
    make_leader(project, monkeypatch)
    processes = [subprocess.Popen(
        ["sleep", "30"], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL, start_new_session=True,
    ) for _ in range(2)]
    worker_ids = []
    try:
        for index, process in enumerate(processes):
            with ledger.open_db(project) as conn:
                worker_id = ledger.add_worker(
                    conn, f"stop-real-{index}", LEADER_PANE, model="test/sleep", cwd=str(project),
                    group="stop-real-group", oneshot=True, mode="run", status="starting",
                )
                ledger.set_workflow_running(conn, LEADER_PANE, "stop-real-group")
                ledger.set_prompt_text(conn, worker_id, "real stop test")
                ledger.mark_started_pid(
                    conn, worker_id, process.pid, mcp_server.process_start_ticks(process.pid), os.getpgid(process.pid),
                )
                worker_ids.append(worker_id)
        master_fd, slave_fd = pty.openpty()
        fake_stdin = os.fdopen(os.dup(slave_fd), "r", buffering=1)
        fake_stdout = os.fdopen(os.dup(slave_fd), "w", buffering=1)
        monkeypatch.setattr(monitor.sys, "stdin", fake_stdin)
        monkeypatch.setattr(monitor.sys, "stdout", fake_stdout)
        keys = iter(["Q", "y"])
        monkeypatch.setattr(monitor, "_read_key", lambda timeout: next(keys))
        monkeypatch.setattr(monitor.shutil, "get_terminal_size", lambda fallback: os.terminal_size((90, 24)))
        try:
            assert monitor.run_interactive(project, LEADER_PANE, "stop-real-group") == "workflow_stopped"
        finally:
            fake_stdin.close()
            fake_stdout.close()
            os.close(master_fd)
            os.close(slave_fd)
        for process in processes:
            process.wait(timeout=3)
        with ledger.open_db(project) as conn:
            rows = [ledger.worker_row(conn, worker_id) for worker_id in worker_ids]
        assert all(row["close_reason"] == "workflow_stopped" for row in rows)
        assert "[AGENT_WORKFLOW_STOPPED stop-real-group]" in state["sent"][-1][1]
    finally:
        for process in processes:
            if process.poll() is None:
                process.kill()


def test_monitor_keeps_injected_prompt_after_worker_cleanup(project, monkeypatch):
    from tools.agent_control import monitor, postrun

    state = fake_herdr(monkeypatch)
    leader = make_leader(project, monkeypatch)
    launched = dispatch_one(leader, "fan-a", group="pilot")
    worker = make_worker(project, monkeypatch, state["spawn_envs"]["fan-a"])
    worker.call_tool("report", {"message": "done"})
    postrun.main()
    prompt_file = project / ".agent-control" / "prompts" / f"fan-a-{launched['worker_id']}.md"
    assert not prompt_file.exists()

    snap = monitor.snapshot(project, LEADER_PANE, "pilot")
    assert "task fan-a" in snap["items"][0]["prompt"]
    assert "task fan-a" in snap["items"][0]["prompt_preview"]
    detail = monitor.render_prompt(snap["items"][0], 90, 24)
    assert "injected contract" in detail
    assert "task fan-a" in detail


def test_monitor_kill_refills_pending_slot(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    monkeypatch.setenv("AGENT_CONTROL_MAX_WORKERS", "1")
    leader = make_leader(project, monkeypatch)
    result = leader.call_tool("dispatch", {
        "template": "task {item}", "items": ["a1", "a2"], "group": "pilot",
    })
    assert result["pending"] == ["a2"]
    first_pid = result["launched"][0]["pid"]

    killed = leader.kill_run_worker(LEADER_PANE, "a1")
    assert killed["status"] == "OK"
    assert state["killed"] == [first_pid]
    assert "a2" in state["spawn_envs"]
    with ledger.open_db(project) as conn:
        row = ledger.select_workers(conn, LEADER_PANE, names=["a1"])[0]
    assert row["close_reason"] == "user_killed"


def test_monitor_restart_creates_fresh_attempt_with_same_prompt(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader = make_leader(project, monkeypatch)
    launched = dispatch_one(leader, "fan-a", group="pilot")
    old_pid = launched["pid"]

    result = leader.restart_run_worker(LEADER_PANE, "fan-a")
    assert result["status"] == "OK"
    assert result["worker_id"] != launched["worker_id"]
    assert state["killed"] == [old_pid]
    assert result["state"] == "running"
    with ledger.open_db(project) as conn:
        old = ledger.worker_row(conn, launched["worker_id"])
        fresh = ledger.worker_row(conn, result["worker_id"])
    assert old["close_reason"] == "restarted"
    assert fresh["prompt_text"] == old["prompt_text"]
    assert "task fan-a" in fresh["prompt_text"]

    # The monitor, not the leader MCP process, may launch this attempt. Completion
    # still has to target the original leader pane.
    assert state["spawn_envs"]["fan-a"]["AGENT_LEADER_PANE"] == LEADER_PANE

    stale = leader.kill_run_worker(
        LEADER_PANE, "fan-a", expected_worker_id=launched["worker_id"],
    )
    assert stale["error"] == "STALE_SELECTION"


def test_monitor_restart_regenerates_isolated_system_metadata(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    fake_worktree(monkeypatch)
    leader = make_leader(project, monkeypatch)
    leader.call_tool("dispatch", {
        "template": "change {item}", "items": ["fan-a"], "group": "pilot",
        "isolation": "worktree",
    })["launched"][0]
    restarted = leader.restart_run_worker(LEADER_PANE, "fan-a")
    assert restarted["status"] == "OK"
    with ledger.open_db(project) as conn:
        fresh = ledger.worker_row(conn, restarted["worker_id"])
    assert fresh["prompt_text"] == "change fan-a"
    env = state["spawn_envs"]["fan-a"]
    assert env["AGENT_CONTROL_WORKTREE"].endswith(f"/fan-a-{fresh['id']}")
    assert env["AGENT_CONTROL_BRANCH"] == f"agent/fan-a-{fresh['id']}"


def test_monitor_restart_refuses_completed_report(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader = make_leader(project, monkeypatch)
    dispatch_one(leader, "fan-a", group="pilot")
    worker = make_worker(project, monkeypatch, state["spawn_envs"]["fan-a"])
    worker.call_tool("report", {"message": "done"})

    result = leader.restart_run_worker(LEADER_PANE, "fan-a")
    assert result["error"] == "ALREADY_REPORTED"


def test_killed_attempt_rejects_late_report(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader = make_leader(project, monkeypatch)
    dispatch_one(leader, "fan-a", group="pilot")
    worker_env = dict(state["spawn_envs"]["fan-a"])
    leader.kill_run_worker(LEADER_PANE, "fan-a")

    worker = make_worker(project, monkeypatch, worker_env)
    result = worker.call_tool("report", {"message": "late result"})
    assert result["error"] == "LEDGER_WRITE_FAILED"
    assert result["detail"] == "WORKER_ATTEMPT_CLOSED"


def test_monitor_sanitizes_prompt_terminal_controls(project, monkeypatch):
    from tools.agent_control import monitor

    item = {"name": "unsafe", "prompt": "hello\x1b[2Jworld\nnext"}
    rendered = monitor.render_prompt(item, 80, 20)
    visible = mcp_server.strip_ansi(rendered)
    assert "[2J" not in visible
    assert "helloworld" in visible


def test_monitor_parses_and_renders_real_opencode_json_events(project):
    from tools.agent_control import monitor

    events_path = project / "events.jsonl"
    events = [
        {"type": "step_start", "timestamp": 1785724207369, "sessionID": "ses_test", "part": {}},
        {"type": "tool_use", "timestamp": 1785724208387, "sessionID": "ses_test", "part": {
            "tool": "read", "state": {"status": "completed", "input": {"filePath": "/tmp/a"},
                                         "title": "tmp/a"}}},
        {"type": "text", "timestamp": 1785724212341, "sessionID": "ses_test",
         "part": {"text": "TOOL_SCHEMA_OK"}},
        {"type": "step_finish", "timestamp": 1785724212613, "sessionID": "ses_test",
         "part": {"reason": "stop", "tokens": {"total": 30854}}},
    ]
    events_path.write_text("\n".join(json.dumps(event) for event in events) + "\nnot-json\n")
    item = {"name": "worker", "events_path": str(events_path)}
    assert len(monitor.load_live_events(str(events_path))) == 4
    summary = mcp_server.strip_ansi(monitor.render_live_session(item, 100, 20))
    assert "TOOL COMPLETED read" in summary
    assert "TOOL_SCHEMA_OK" in summary
    assert "tokens=30854" in summary
    assert '{"filePath"' not in summary
    raw = mcp_server.strip_ansi(monitor.render_live_session(item, 100, 20, raw=True))
    assert "sessionID" in raw

    _, _, fallback = monitor._event_summary({
        "type": "tool_use", "part": {"tool": "agentControl_report", "state": {
            "status": "completed", "input": {"message": "done", "final": True},
        }},
    })
    assert fallback == "inputs: message, final"


def test_monitor_stop_workflow_kills_active_workers_and_notifies(project, monkeypatch):
    from tools.agent_control import monitor

    state = fake_herdr(monkeypatch)
    leader = make_leader(project, monkeypatch)
    result = leader.call_tool("dispatch", {
        "template": "task {item}", "items": ["a1", "a2"], "group": "pilot",
    })
    pids = sorted(item["pid"] for item in result["launched"])
    stopped = leader.stop_run_group(LEADER_PANE, "pilot")
    assert stopped["stopped"] == 2
    assert sorted(state["killed"]) == pids
    with ledger.open_db(project) as conn:
        rows = ledger.select_workers(conn, LEADER_PANE, group="pilot")
    assert {row["close_reason"] for row in rows if row["mode"] == "run"} == {"workflow_stopped"}

    monitor._notify_workflow_stopped(LEADER_PANE, "pilot", 2)
    assert state["sent"][-1] == (
        LEADER_PANE,
        "[AGENT_WORKFLOW_STOPPED pilot] 사용자가 batch monitor에서 workflow를 종료했다 — 2개 active worker 중단",
    )


def test_partial_workflow_stop_notifies_once_with_failures(project, monkeypatch):
    from tools.agent_control import monitor

    state = fake_herdr(monkeypatch)
    leader = make_leader(project, monkeypatch)
    leader.call_tool("dispatch", {
        "template": "task {item}", "items": ["a1", "a2"], "group": "pilot",
    })
    failed_pid = state["launches"]["a2"]["pid"]

    def partial_terminate(pid, start_ticks=None, pgid=None, timeout=1.0):
        if pid == failed_pid:
            return False
        state["alive_pids"].discard(pid)
        return True

    monkeypatch.setattr(mcp_server, "terminate_process", partial_terminate)
    result = leader.stop_run_group(LEADER_PANE, "pilot")
    assert result["status"] == "ERROR"
    assert result["notify_leader"] is True
    assert result["failed"] == ["a2"]
    monitor._notify_workflow_stopped(LEADER_PANE, "pilot", result["stopped"], result["failed"])
    assert "종료 확인 실패: a2" in state["sent"][-1][1]
    assert leader.stop_run_group(LEADER_PANE, "pilot")["notify_leader"] is False


def test_workflow_stop_wins_launch_publication_race(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader = make_leader(project, monkeypatch)
    pid = 95555

    def launch_then_stop(command, env, cwd, events_path, stderr_path):
        state["alive_pids"].add(pid)
        leader.stop_run_group(LEADER_PANE, "pilot")
        return pid

    monkeypatch.setattr(mcp_server, "launch_run_process", launch_then_stop)
    result = leader.call_tool("dispatch", {
        "template": "task {item}", "items": ["fan-a"], "group": "pilot",
    })
    assert result["launch_failures"][0]["error"] == "LAUNCH_CANCELLED"
    assert state["killed"] == [pid]
    with ledger.open_db(project) as conn:
        row = ledger.select_workers(conn, LEADER_PANE, names=["fan-a"])[0]
    assert row["closed_at"] is not None
    assert row["pid"] is None


def test_terminate_process_refuses_reused_pid(monkeypatch):
    signals = []
    monkeypatch.setattr(mcp_server, "pid_alive", lambda pid: True)
    monkeypatch.setattr(mcp_server, "process_start_ticks", lambda pid: 222)
    monkeypatch.setattr(mcp_server.os, "killpg", lambda pgid, sig: signals.append((pgid, sig)))
    assert mcp_server.terminate_process(123, start_ticks=111, pgid=123) is False
    assert signals == []


def test_reconcile_marks_reused_pid_dead_without_signalling(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader = make_leader(project, monkeypatch)
    launched = dispatch_one(leader, "fan-a")
    with ledger.open_db(project) as conn:
        conn.execute("UPDATE workers SET pid_start_ticks=111 WHERE id=?", (launched["worker_id"],))
    monkeypatch.setattr(mcp_server, "process_start_ticks", lambda pid: 222)

    entry = leader.call_tool("collect", {"timeout_ms": 0, "consume": False})["workers"][0]
    assert entry["status"] == "dead"
    assert state["killed"] == []
    with ledger.open_db(project) as conn:
        row = ledger.worker_row(conn, launched["worker_id"])
    assert row["close_reason"] == "pid_identity_lost"


def test_cancel_refuses_mismatched_process_identity(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader = make_leader(project, monkeypatch)
    dispatch_one(leader, "fan-a")
    monkeypatch.setattr(mcp_server, "terminate_process", lambda *args, **kwargs: False)
    result = leader.call_tool("cancel", {"target": "fan-a"})
    assert result["warning"] == "PROCESS_IDENTITY_OR_TERMINATION_FAILED"
    assert state["killed"] == []


def test_dispatch_isolates_opencode_storage_and_cleans_it(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    # 실제 auth.json이 있는 상황을 흉내낸다.
    fake_data_home = project / "fake-data-home"
    (fake_data_home / "opencode").mkdir(parents=True)
    (fake_data_home / "opencode" / "auth.json").write_text("{\"token\": \"x\"}")
    monkeypatch.setenv("XDG_DATA_HOME", str(fake_data_home))

    leader = make_leader(project, monkeypatch)
    scratch_root = project.parent / f"{project.name}-agent-control-scratch"
    monkeypatch.setenv("AGENT_CONTROL_SCRATCH_ROOT", str(scratch_root))
    launched = dispatch_one(leader, "fan-a")
    env = state["spawn_envs"]["fan-a"]
    scratch = mcp_server.run_scratch_dir(project, "fan-a", launched["worker_id"])
    # worker 세션은 메인 opencode.db가 아니라 일회용 저장소에 남는다.
    assert project not in scratch.parents
    assert env["XDG_DATA_HOME"] == str(scratch)
    assert env["BUN_TMPDIR"] == str(scratch / "tmp")
    assert env["TMPDIR"] == str(scratch / "tmp")
    assert (scratch / "opencode" / "auth.json").exists()  # 자격 증명은 이어진다

    worker = make_worker(project, monkeypatch, env)
    worker.call_tool("report", {"message": "done"})
    leader = make_leader(project, monkeypatch)
    monkeypatch.setenv("XDG_DATA_HOME", str(fake_data_home))
    leader.call_tool("collect", {"timeout_ms": 0})
    assert not scratch.exists()  # oneshot 정리가 저장소도 통째로 지운다
    assert (fake_data_home / "opencode" / "auth.json").exists()  # 원본은 무사하다


def test_peek_run_worker_reads_log_tail(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader = make_leader(project, monkeypatch)
    dispatch_one(leader, "fan-a")
    events_path = Path(state["launches"]["fan-a"]["events"])
    stderr_path = Path(state["launches"]["fan-a"]["stderr"])
    events_path.parent.mkdir(parents=True, exist_ok=True)
    events_path.write_text("line1\n\x1b[0mline2\x1b[1;32m\nline3\n")
    stderr_path.write_text("warning\n")
    result = leader.call_tool("peek", {"target": "fan-a", "lines": 2})
    assert "line2\nline3" in result["output"]  # ANSI 이스케이프는 제거된다
    assert "warning" in result["output"]
    assert result["events"] == str(events_path)


def test_collect_closed_flag_consistent_when_postrun_wins_race(project, monkeypatch):
    from tools.agent_control import postrun

    state = fake_herdr(monkeypatch)
    leader = make_leader(project, monkeypatch)
    dispatch_one(leader, "fan-a")
    worker = make_worker(project, monkeypatch, state["spawn_envs"]["fan-a"])
    worker.call_tool("report", {"message": "done"})
    postrun.main()  # collect보다 먼저 postrun이 정리를 끝낸 상황
    leader = make_leader(project, monkeypatch)
    entry = leader.call_tool("collect", {"timeout_ms": 0})["workers"][0]
    assert entry["closed"] is True  # 정리 주체와 무관하게 응답 표현은 일관돼야 한다


def test_dispatch_uses_fixed_worker_without_model_override(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader = make_leader(project, monkeypatch)
    result = leader.call_tool("dispatch", {
        "template": "조사 {item}", "items": ["fan-a"], "group": "model",
    })
    assert result["status"] == "OK"
    command = state["launches"]["fan-a"]["command"]
    assert "--agent agentcontrol-dispatch" in command
    assert "--model" not in command
    with ledger.open_db(project) as conn:
        row = ledger.select_workers(conn, LEADER_PANE, names=["fan-a"])[0]
    assert row["agent"] == "agentcontrol-dispatch"
    assert row["model"] == ""


def test_dispatch_template_placeholder_required(project, monkeypatch):
    fake_herdr(monkeypatch)
    leader = make_leader(project, monkeypatch)
    result = leader.call_tool("dispatch", {
        "template": "no placeholder", "items": ["a"], "group": "g",
    })
    assert result["error"] == "TEMPLATE_MISSING_PLACEHOLDER"


def test_item_slug():
    assert mcp_server.item_slug("OXM24315K6") == "oxm24315k6"
    assert mcp_server.item_slug("9abc") == "w-9abc"
    assert mcp_server.item_slug("A/B c") == "a-b-c"


def test_dispatch_batch_queues_beyond_cap_and_refills(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    monkeypatch.setenv("AGENT_CONTROL_MAX_WORKERS", "2")
    leader = make_leader(project, monkeypatch)
    result = leader.call_tool("dispatch", {
        "template": "observe {item}", "items": ["A1", "A2", "A3"], "group": "batch",
    })
    assert result["total"] == 3
    assert [l["name"] for l in result["launched"]] == ["a1", "a2"]
    assert result["pending"] == ["a3"]

    # cap을 차지한 두 worker가 보고를 마치면, collect가 정리하면서 세 번째를 launch한다.
    for name in ("a1", "a2"):
        worker = make_worker(project, monkeypatch, state["spawn_envs"][name])
        worker.call_tool("report", {"message": "done"})
    leader = make_leader(project, monkeypatch)
    result = leader.call_tool("collect", {"group": "batch", "timeout_ms": 0})
    assert result["complete"] is False  # a3가 아직 남았다
    assert "a3" in state["spawn_envs"]  # 자리가 나자 자동 launch
    prompt_files = list((project / ".agent-control" / "prompts").glob("a3-*.md"))
    assert prompt_files and "observe A3" in prompt_files[0].read_text()


def test_collect_cleans_one_hundred_terminal_worker_event_dirs(project, monkeypatch):
    fake_herdr(monkeypatch)
    leader = make_leader(project, monkeypatch)
    owner = leader.owner_id()
    for index in range(100):
        name = f"bulk-{index}"
        with ledger.open_db(project) as conn:
            worker_id = ledger.add_worker(
                conn, name, owner, model="m", cwd=str(project), group="bulk",
                oneshot=True, mode="run", status="starting",
            )
            ledger.close_worker(conn, worker_id, "bulk_fixture")
        live_dir = mcp_server.run_live_dir(project, name, worker_id)
        live_dir.mkdir(parents=True)
        (live_dir / "events.jsonl").write_text('{"type":"step_finish"}\n')
    result = leader.call_tool("collect", {"group": "bulk", "timeout_ms": 0})
    assert result["complete"] is True
    assert len(result["workers"]) == 100
    assert not any((project / ".agent-control" / "live").iterdir())


def test_final_report_is_atomic_and_unique_per_attempt(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader = make_leader(project, monkeypatch)
    dispatch_one(leader, "fan-a")
    env = state["spawn_envs"]["fan-a"]
    worker_a = make_worker(project, monkeypatch, env)
    worker_b = make_worker(project, monkeypatch, env)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(
            lambda pair: pair[0].call_tool("report", {"message": pair[1]}),
            [(worker_a, "first"), (worker_b, "second")],
        ))
    assert sorted(result["status"] for result in results) == ["ERROR", "OK"]
    assert [result.get("error") for result in results].count("FINAL_ALREADY_REPORTED") == 1
    leader = make_leader(project, monkeypatch)
    collected = leader.call_tool("collect", {"timeout_ms": 0})["workers"][0]["reports"]
    assert len(collected) == 1
    assert collected[0]["body"] in {"first", "second"}


def test_peek_reads_worker_terminal(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader, _, spawned = spawn_and_worker(project, monkeypatch, state, "fan-a")
    monkeypatch.setattr(
        herdr, "read_output",
        lambda pane, lines, facade="agent": f"{pane}:{lines} lines of output",
    )
    result = leader.call_tool("peek", {"target": "fan-a", "lines": 10})
    assert result["status"] == "OK"
    assert result["output"] == f"{spawned['pane']}:10 lines of output"


def test_threaded_run_loop_smoke(project, monkeypatch, capsys):
    fake_herdr(monkeypatch)
    server = make_leader(project, monkeypatch)
    lines = [
        json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}}),
        json.dumps({"jsonrpc": "2.0", "id": 2, "method": "tools/call",
                    "params": {"name": "list", "arguments": {}}}),
    ]
    monkeypatch.setattr(mcp_server.sys, "stdin", iter(lines))
    server.run()
    out = [json.loads(l) for l in capsys.readouterr().out.strip().splitlines()]
    by_id = {r["id"]: r for r in out}
    assert by_id[1]["result"]["serverInfo"]["version"] == "3.0.0"
    assert by_id[2]["result"]["structuredContent"]["status"] == "OK"


def test_spawn_reuse_after_close_supersedes_old_row(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader, worker, _ = spawn_and_worker(project, monkeypatch, state, "fan-a")
    worker.call_tool("report", {"message": "old run"})
    leader.call_tool("cancel", {"target": "fan-a"})

    leader, _, spawned = spawn_and_worker(project, monkeypatch, state, "fan-a")
    result = leader.call_tool("collect", {"timeout_ms": 0})
    assert result["complete"] is False
    assert result["workers"][0]["status"] == "idle"
    assert result["workers"][0]["reports"] == []


def test_spawn_uses_fixed_internal_worker_preset(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader = make_leader(project, monkeypatch)
    spawned = leader.call_tool(
        "spawn", {"name": "role-worker", "prompt": "task"},
    )
    assert spawned["status"] == "OK"
    assert spawned["agent"] == "agentcontrol-execute"
    assert "model" not in spawned
    assert state["spawn_commands"]["role-worker"] == [
        "opencode", "--agent", "agentcontrol-execute",
    ]


def test_spawn_forwards_opencode_environment(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader = make_leader(project, monkeypatch)
    expected = {
        "XDG_DATA_HOME": "/tmp/agentcontrol/data",
        "XDG_CONFIG_HOME": "/tmp/agentcontrol/config",
        "XDG_CACHE_HOME": "/tmp/agentcontrol/cache",
        "XDG_STATE_HOME": "/tmp/agentcontrol/state",
        "OPENCODE_CONFIG_DIR": "/tmp/agentcontrol/config/opencode",
        "OPENCODE_DISABLE_AUTOUPDATE": "1",
        "OPENCODE_DISABLE_MODELS_FETCH": "1",
    }
    for key, value in expected.items():
        monkeypatch.setenv(key, value)

    spawned = leader.call_tool(
        "spawn", {"name": "isolated-worker", "prompt": "task"},
    )

    assert spawned["status"] == "OK"
    worker_env = state["spawn_envs"]["isolated-worker"]
    assert {key: worker_env[key] for key in expected} == expected


def test_dispatch_requires_group_and_allows_shared_workspace(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    fake_worktree(monkeypatch)
    leader = make_leader(project, monkeypatch)

    missing_group = leader.call_tool("dispatch", {
        "template": "task {item}", "items": ["a"],
    })
    shared_write = leader.call_tool("dispatch", {
        "template": "task {item}", "items": ["a"], "group": "g",
    })

    assert missing_group["error"] == "GROUP_REQUIRED"
    assert shared_write["status"] == "OK"
    assert state["spawn_cwds"]["a"] == str(project)


def test_dispatch_uses_internal_preset_without_model_argument(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader = make_leader(project, monkeypatch)

    result = leader.call_tool("dispatch", {
        "template": "task {item}", "items": ["a"], "group": "g",
    })

    assert result["status"] == "OK"
    command = state["launches"]["a"]["command"]
    assert "opencode run --auto --format json" in command
    assert "--agent agentcontrol-dispatch" in command
    assert "--model" not in command


def test_direct_agent_actions_select_matching_kind_and_preserve_plain_prompt(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader = make_leader(project, monkeypatch)

    for action in ("Execute", "Explore", "Plan", "Research"):
        name = action.lower()
        prompt = f"plain {name} task"
        args = {"name": name, "prompt": prompt}
        if action == "Explore":
            args["breadth"] = "thorough"
        result = leader.call_tool(action, args)
        assert result["status"] == "OK"
        assert result["kind"] == name
        assert result["agent"] == f"agentcontrol-{name}"
        assert state["spawn_commands"][name] == ["opencode", "--agent", f"agentcontrol-{name}"]
        assert state["spawn_envs"][name]["AGENT_CONTROL_KIND"] == name
        assert state["sent"][-1] == (f"w1:p-{name}", prompt)

    assert state["spawn_envs"]["explore"]["AGENT_CONTROL_BREADTH"] == "thorough"


def test_report_details_write_only_canonical_worker_artifact(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader = make_leader(project, monkeypatch)
    result = leader.call_tool("Explore", {"name": "trace", "prompt": "trace code"})
    worker = make_worker(project, monkeypatch, state["spawn_envs"]["trace"])

    reported = worker.call_tool("Report", {
        "summary": "Found the flow.",
        "details": "# Flow\n\nDetailed evidence.",
    })

    expected = project / ".agent-control" / "reports" / "trace.md"
    assert reported["status"] == "OK"
    assert reported["details_path"] == str(expected)
    assert expected.read_text() == "# Flow\n\nDetailed evidence."
    assert state["sent"][-1] == (
        LEADER_PANE,
        f"[AGENT_REPORT trace kind=explore] details={expected} Found the flow.",
    )
    assert result["report_path"] == str(expected)


def test_report_details_require_final_and_enforce_utf8_byte_limit(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader = make_leader(project, monkeypatch)
    leader.call_tool("Plan", {"name": "qa-plan", "prompt": "plan"})
    worker = make_worker(project, monkeypatch, state["spawn_envs"]["qa-plan"])

    assert worker.call_tool("Report", {
        "summary": "partial", "details": "detail", "final": False,
    })["error"] == "DETAILS_REQUIRE_FINAL"
    assert worker.call_tool("Report", {
        "summary": "large", "details": "가" * 50_000,
    })["error"] == "REPORT_DETAILS_TOO_LARGE"
    with ledger.open_db(project) as conn:
        assert ledger.has_final_report(conn, int(state["spawn_envs"]["qa-plan"]["AGENT_CONTROL_WORKER_ID"])) is False


def test_report_artifact_failure_does_not_publish_final_report(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader = make_leader(project, monkeypatch)
    leader.call_tool("Research", {"name": "docs", "prompt": "research"})
    worker = make_worker(project, monkeypatch, state["spawn_envs"]["docs"])
    monkeypatch.setattr(mcp_server.os, "replace", lambda *_: (_ for _ in ()).throw(OSError("disk full")))

    result = worker.call_tool("Report", {"summary": "done", "details": "evidence"})

    assert result["status"] == "ERROR"
    with ledger.open_db(project) as conn:
        worker_id = int(state["spawn_envs"]["docs"]["AGENT_CONTROL_WORKER_ID"])
        assert ledger.has_final_report(conn, worker_id) is False


def make_runtime_leader(project: Path, monkeypatch: pytest.MonkeyPatch) -> RuntimeMCPServer:
    clear_env(monkeypatch)
    monkeypatch.setenv("HERDR_PANE_ID", LEADER_PANE)
    monkeypatch.setenv("HERDR_WORKSPACE_ID", "w1")
    return RuntimeMCPServer(project)


def test_direct_action_rejects_missing_handoff_before_creating_worker(project, monkeypatch):
    fake_herdr(monkeypatch)
    leader = make_runtime_leader(project, monkeypatch)

    result = leader.call_tool("Explore", {"name": "trace", "prompt": "trace code"})

    assert result == {"status": "REJECTED", "error": "HANDOFF_REQUIRED"}
    with ledger.open_db(project) as conn:
        assert ledger.select_workers(conn, LEADER_PANE) == []


@pytest.mark.parametrize(
    ("setup", "action", "error"),
    [
        ("missing-section", "explore", "HANDOFF_SECTION_EMPTY"),
        ("wrong-action", "plan", "HANDOFF_ACTION_MISMATCH"),
        ("outside-project", "explore", "HANDOFF_OUTSIDE_PROJECT"),
        ("oversized", "explore", "HANDOFF_TOO_LARGE"),
    ],
)
def test_handoff_validation_rejects_unsafe_or_incomplete_documents(
    project, setup, action, error,
):
    path = write_handoff(project, action)
    requested = action
    if setup == "missing-section":
        path = write_handoff(project, action, body_overrides={"Verification": ""})
    elif setup == "wrong-action":
        requested = "explore"
    elif setup == "outside-project":
        path = project.parent / "outside-handoff.md"
        path.write_text(write_handoff(project, action).read_text(), encoding="utf-8")
    elif setup == "oversized":
        path.write_text(path.read_text() + ("x" * (handoff.MAX_HANDOFF_BYTES + 1)), encoding="utf-8")

    with pytest.raises(handoff.HandoffValidationError) as exc:
        handoff.validate_handoff(project, str(path), requested)

    assert exc.value.code == error


def test_valid_handoff_is_injected_as_trusted_direct_agent_metadata(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader = make_runtime_leader(project, monkeypatch)
    path = write_handoff(project, "explore", name="p20-revalidation")

    result = leader.call_tool("Explore", {
        "name": "trace", "prompt": "trace code", "handoff": str(path),
    })

    metadata = handoff.validate_handoff(project, str(path), "explore")
    assert result["status"] == "OK"
    assert result["handoff"] == {
        "id": metadata.id,
        "path": str(metadata.path),
        "sha256": metadata.sha256,
    }
    worker_env = state["spawn_envs"]["trace"]
    assert worker_env["AGENT_CONTROL_HANDOFF_ID"] == metadata.id
    assert worker_env["AGENT_CONTROL_HANDOFF_PATH"] == str(metadata.path)
    assert worker_env["AGENT_CONTROL_HANDOFF_SHA256"] == metadata.sha256


def test_dispatch_shares_validated_handoff_with_every_item(project, monkeypatch):
    state = fake_herdr(monkeypatch)
    leader = make_runtime_leader(project, monkeypatch)
    path = write_handoff(project, "dispatch", name="shared-review")

    result = leader.call_tool("Dispatch", {
        "template": "review {item}",
        "items": ["alpha", "beta"],
        "group": "review",
        "handoff": str(path),
    })

    metadata = handoff.validate_handoff(project, str(path), "dispatch")
    assert result["status"] == "OK"
    assert result["handoff"]["sha256"] == metadata.sha256
    for name in ("alpha", "beta"):
        worker_env = state["spawn_envs"][name]
        assert worker_env["AGENT_CONTROL_HANDOFF_ID"] == metadata.id
        assert worker_env["AGENT_CONTROL_HANDOFF_PATH"] == str(metadata.path)
        assert worker_env["AGENT_CONTROL_HANDOFF_SHA256"] == metadata.sha256
        with ledger.open_db(project) as conn:
            row = next(row for row in ledger.select_workers(conn, LEADER_PANE) if row["name"] == name)
            assert row["handoff_path"] == str(metadata.path)
            assert row["handoff_sha256"] == metadata.sha256


def test_dispatch_monitor_exposes_verified_handoff_document(project, monkeypatch):
    from tools.agent_control import monitor

    fake_herdr(monkeypatch)
    leader = make_runtime_leader(project, monkeypatch)
    path = write_handoff(project, "dispatch", name="dashboard-context")
    leader.call_tool("Dispatch", {
        "template": "review {item}", "items": ["alpha"], "group": "review",
        "handoff": str(path),
    })

    snap = monitor.snapshot(project, LEADER_PANE, "review")
    item = snap["items"][0]
    assert item["handoff_id"] == "dashboard-context"
    assert item["handoff_status"] == "verified"
    assert "## Acceptance atoms" in item["handoff"]
    dashboard = mcp_server.strip_ansi(monitor.render(snap, width=140, height=24))
    assert "handoff dashboard-context · VERIFIED" in dashboard
    assert "H handoff" in dashboard
    detail = mcp_server.strip_ansi(monitor.render_handoff(item, 180, 60))
    assert "HANDOFF alpha" in detail
    assert "dashboard-context.md" in detail
    assert "## Acceptance atoms" in detail

    path.write_text("substituted content", encoding="utf-8")
    changed = monitor.snapshot(project, LEADER_PANE, "review")["items"][0]
    assert changed["handoff_status"] == "changed"
    assert changed["handoff"] == ""
    assert "substituted content" not in monitor.render_handoff(changed, 100, 24)
