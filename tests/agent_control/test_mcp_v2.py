"""Agent Control v2 Herdr adapter and MCP tests."""

from __future__ import annotations

from pathlib import Path

import pytest

from tools.agent_control import herdr
from tools.agent_control.mcp_server import (
    LEADER_MESSAGE_PREFIX,
    MCPServer,
    REPORT_MAX_CHARS,
    leader_message,
)


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
        if mapped == "Report" and "message" in args:
            args = {**args, "summary": args["message"]}
            args.pop("message")
        return super().call_tool(mapped, args)


@pytest.fixture()
def project(tmp_path: Path) -> Path:
    return tmp_path


def make_server(project: Path, monkeypatch: pytest.MonkeyPatch, role: str | None = None, **env: str) -> MCPServer:
    for key in (
        "AGENT_CONTROL_ROLE",
        "AGENT_CONTROL_NAME",
        "AGENT_CONTROL_WORKER_ID",
        "AGENT_CONTROL_PROJECT",
        "AGENT_CONTROL_OWNER",
        "AGENT_LEADER_PANE",
        "AGENT_CONTROL_REPORT_PATH",
        "HERDR_PANE_ID",
        "HERDR_WORKSPACE_ID",
        "HERDR_DEFAULT_WORKSPACE",
    ):
        monkeypatch.delenv(key, raising=False)
    if role:
        monkeypatch.setenv("AGENT_CONTROL_ROLE", role)
    for key, value in env.items():
        monkeypatch.setenv(key, value)
    return LegacyTestMCPServer(project)


def test_role_tool_visibility(project, monkeypatch):
    tools = make_server(project, monkeypatch).visible_tools()
    assert [tool["name"] for tool in tools] == [
        "Execute", "Explore", "Plan", "Research", "Dispatch", "Send", "List", "Collect", "Peek", "Cancel",
    ]
    execute = next(tool for tool in tools if tool["name"] == "Execute")
    assert set(execute["inputSchema"]["properties"]) == {
        "name", "prompt", "handoff", "isolation", "base", "target",
    }
    assert set(execute["inputSchema"]["required"]) == {"name", "prompt", "handoff"}
    dispatch = next(tool for tool in tools if tool["name"] == "Dispatch")
    assert set(dispatch["inputSchema"]["properties"]) == {
        "template", "items", "group", "handoff", "isolation", "base",
    }
    assert set(dispatch["inputSchema"]["required"]) == {"template", "items", "group", "handoff"}
    assert "개입 채널(send)이 없는" in dispatch["description"]
    assert "not completed" in execute["description"]
    send = next(tool for tool in tools if tool["name"] == "Send")
    assert "즉시 읽게 하지 않으며" in send["description"]
    cancel = next(tool for tool in tools if tool["name"] == "Cancel")
    assert "후속 작업이 없을 때" in cancel["description"]
    worker_tools = make_server(project, monkeypatch, role="worker").visible_tools()
    assert [tool["name"] for tool in worker_tools] == ["Report"]
    assert worker_tools[0]["inputSchema"]["properties"]["summary"]["maxLength"] == REPORT_MAX_CHARS


def test_role_tool_rejection(project, monkeypatch):
    worker = make_server(project, monkeypatch, role="worker")
    assert worker.call_tool("spawn", {"name": "x", "prompt": "p"})["error"] == "TOOL_FORBIDDEN_FOR_ROLE"
    leader = make_server(project, monkeypatch)
    assert leader.call_tool("report", {"message": "hi"})["error"] == "TOOL_FORBIDDEN_FOR_ROLE"


def test_leader_message_normalizes_source_prefix():
    assert leader_message("follow") == f"{LEADER_MESSAGE_PREFIX}\nfollow"
    assert leader_message(f"{LEADER_MESSAGE_PREFIX}\nfollow") == f"{LEADER_MESSAGE_PREFIX}\nfollow"
    assert leader_message(
        f"{LEADER_MESSAGE_PREFIX}\n{LEADER_MESSAGE_PREFIX}\nfollow"
    ) == f"{LEADER_MESSAGE_PREFIX}\nfollow"


def test_spawn_input_validation(project, monkeypatch):
    server = make_server(project, monkeypatch)
    assert server.call_tool("spawn", {"name": "Bad Name!", "prompt": "p"}) == {
        "status": "REJECTED", "error": "INVALID_NAME",
    }
    assert server.call_tool("spawn", {"name": "1-worker", "prompt": "p"})["error"] == "INVALID_NAME"


def test_spawn_without_any_workspace_fails(project, monkeypatch):
    monkeypatch.setattr(herdr, "find_agent_worker", lambda name: None)
    monkeypatch.setattr(herdr, "list_workspaces", lambda: [])
    result = make_server(project, monkeypatch).call_tool(
        "spawn", {"name": "w1", "prompt": "p"},
    )
    assert "workspace" in result["error"]


def test_spawn_send_list_cancel(project, monkeypatch):
    workers: list[dict] = []
    sent: list[tuple[str, str, bool]] = []

    monkeypatch.setattr(herdr, "find_agent_worker", lambda name: next((w for w in workers if w["name"] == name), None))

    def start(name, workspace, command, env, cwd):
        worker = {
            "name": name,
            "agent": f"agent:{name}",
            "pane": "w1:p2",
            "pane_id": "w1:p2",
            "terminal": "term_2",
            "terminal_id": "term_2",
            "tab_id": "w1:t2",
            "workspace_id": workspace,
            "alive": True,
            "status": "idle",
        }
        workers.append(worker)
        assert env["AGENT_LEADER_PANE"] == "w1:p1"
        assert env["AGENT_CONTROL_REPORT_PATH"].endswith("/.agent-control/reports/rig-eval.md")
        assert "AGENT_CONTROL_WORKTREE" not in env
        assert "AGENT_CONTROL_BRANCH" not in env
        return worker

    monkeypatch.setattr(herdr, "start_agent", start)
    monkeypatch.setattr(herdr, "list_pane_ids", lambda: {w["pane"] for w in workers})
    monkeypatch.setattr(herdr, "send", lambda pane, text, wait_idle=True: sent.append((pane, text, wait_idle)))
    monkeypatch.setattr(herdr, "list_agent_workers", lambda owner=None: list(workers))
    monkeypatch.setattr(herdr, "resolve_target", lambda target, owner=None: workers[0] if workers else (_ for _ in ()).throw(herdr.HerdrError("gone")))
    monkeypatch.setattr(herdr, "close", lambda pane: workers.clear())

    server = make_server(project, monkeypatch, HERDR_PANE_ID="w1:p1", HERDR_WORKSPACE_ID="w1")
    spawned = server.call_tool(
        "spawn", {"name": "rig-eval", "prompt": "first"},
    )
    assert spawned["status"] == "OK"
    assert "model" not in spawned
    assert spawned["agent_name"] == "agent:rig-eval"
    assert spawned["report_path"].endswith("/.agent-control/reports/rig-eval.md")
    assert sent[-1][0] == "w1:p2"
    assert sent[-1][1] == "first"
    assert sent[-1][2] is True

    duplicate = server.call_tool(
        "spawn", {"name": "rig-eval", "prompt": "x"},
    )
    assert duplicate["error"] == "DUPLICATE_NAME"
    assert server.call_tool("list", {})["agents"][0]["name"] == "rig-eval"
    assert server.call_tool("send", {"target": "rig-eval", "message": "follow"})["status"] == "OK"
    assert sent[-1] == (
        "w1:p2", "[리드 세션 - 이 메시지에 대한 답변은 report로]\nfollow", False,
    )
    assert server.call_tool("cancel", {"target": "rig-eval"})["status"] == "OK"
    assert server.call_tool("cancel", {"target": "rig-eval"})["note"] == "already gone"


def test_report(project, monkeypatch):
    sent: list[tuple[str, str, bool]] = []
    monkeypatch.setattr(herdr, "send", lambda pane, text, wait_idle=True: sent.append((pane, text, wait_idle)))
    missing = make_server(project, monkeypatch, role="worker")
    assert missing.call_tool("report", {"message": "done"})["error"] == "AGENT_LEADER_PANE_NOT_SET"

    worker = make_server(
        project,
        monkeypatch,
        role="worker",
        AGENT_CONTROL_NAME="rig-eval",
        AGENT_LEADER_PANE="w1:p1",
        AGENT_CONTROL_REPORT_PATH="/project/.agent-control/reports/rig-eval.md",
    )
    assert worker.call_tool("report", {"message": "done"})["status"] == "OK"
    assert sent == [("w1:p1", "[AGENT_REPORT rig-eval kind=unknown] done", False)]
    too_long = worker.call_tool("report", {"message": "x" * (REPORT_MAX_CHARS + 1)})
    assert too_long["error"] == "REPORT_TOO_LONG"
    assert too_long["max_chars"] == REPORT_MAX_CHARS
    assert "/project/.agent-control/reports/rig-eval.md" in too_long["hint"]
    assert len(sent) == 1


def test_report_from_pre_cutover_tmux_worker(project, monkeypatch):
    from tools.agent_control import tmux

    sent: list[tuple[str, str]] = []
    monkeypatch.setattr(tmux, "idle_safe_paste", lambda pane, text: sent.append((pane, text)))
    worker = make_server(
        project,
        monkeypatch,
        role="worker",
        AGENT_CONTROL_NAME="legacy",
        AGENT_LEADER_PANE="%207",
    )
    result = worker.call_tool("report", {"message": "done"})
    assert result["status"] == "OK"
    assert result["transport"] == "tmux-migration-bridge"
    assert sent == [("%207", "[AGENT_REPORT legacy kind=unknown] done")]


def test_adapter_filters_and_resolves_workers(monkeypatch):
    monkeypatch.setattr(herdr, "list_agents", lambda: [
        {"name": "opencode", "pane_id": "w1:p1"},
        {
            "name": "rig-eval",
            "pane_id": "w1:p2",
            "terminal_id": "term_2",
            "workspace_id": "w1",
            "tab_id": "w1:t2",
            "agent_status": "working",
            "revision": 4,
            "tokens": {
                "agent_control_owner_pane": "w1:p1",
                "agent_control_project": "/project",
            },
        },
        {
            "name": "agent:other",
            "pane_id": "w1:p3",
            "terminal_id": "term_3",
            "workspace_id": "w1",
            "tab_id": "w1:t3",
            "agent_status": "idle",
            "tokens": {"agent_control_owner_pane": "w1:p9"},
        },
    ])
    workers = herdr.list_agent_workers("w1:p1")
    assert [worker["name"] for worker in workers] == ["rig-eval"]
    assert workers[0]["owner_pane"] == "w1:p1"
    assert workers[0]["project"] == "/project"
    assert herdr.resolve_target("term_2", "w1:p1")["pane"] == "w1:p2"
    assert herdr.resolve_target("agent:rig-eval", "w1:p1")["status"] == "working"
    with pytest.raises(herdr.HerdrError):
        herdr.resolve_target("agent:other", "w1:p1")


def test_start_agent_creates_tab_then_uses_herdr_agent_facade(monkeypatch):
    calls: list[list[str]] = []

    def run(args, timeout=10.0):
        calls.append(args)
        if args[:2] == ["tab", "create"]:
            return {"result": {
                "tab": {"tab_id": "w1:t2", "workspace_id": "w1"},
                "root_pane": {
                    "pane_id": "w1:p2", "terminal_id": "term_2",
                    "tab_id": "w1:t2", "workspace_id": "w1",
                },
            }}
        if args[:2] == ["agent", "start"]:
            return {"result": {"agent": {
                "pane_id": "w1:p2", "terminal_id": "term_2",
                "tab_id": "w1:t2", "workspace_id": "w1", "name": "rig-eval",
            }}}
        if args[:2] == ["pane", "get"]:
            return {"result": {"pane": {
                "pane_id": "w1:p2", "terminal_id": "term_2",
                "tab_id": "w1:t2", "workspace_id": "w1",
            }}}
        return {"result": {}}

    monkeypatch.setattr(herdr, "run", run)
    created = herdr.start_agent(
        "rig-eval", "w1", ["opencode"],
        {"AGENT_CONTROL_ROLE": "worker", "AGENT_LEADER_PANE": "w1:p1"}, "/project",
    )

    assert "--no-focus" in calls[0]
    assert "--focus" not in calls[0]
    assert f"ZDOTDIR={herdr.SHELL_ZDOTDIR}" in calls[0]
    assert calls[1] == [
        "agent", "start", "rig-eval", "--kind", "opencode", "--pane", "w1:p2",
        "--timeout", "30000", "--",
    ]
    assert calls[2] == [
        "pane", "wait-output", "w1:p2", "--match", "ctrl+p commands",
        "--source", "visible", "--lines", "120", "--timeout", "30000",
    ]
    assert calls[3] == [
        "pane", "report-metadata", "w1:p2", "--source", "agent-control",
        "--token", "agent_control_project=/project",
        "--token", "agent_control_owner_pane=w1:p1",
    ]
    assert calls[4] == ["pane", "get", "w1:p2"]
    assert created["tab_id"] == "w1:t2"


def test_start_agent_waits_for_shell_then_starts_once(monkeypatch):
    starts = 0

    def run(args, timeout=10.0):
        nonlocal starts
        if args[:2] == ["tab", "create"]:
            return {"result": {"root_pane": {"pane_id": "w1:p2"}}}
        if args[:2] == ["agent", "start"]:
            starts += 1
            return {"result": {"agent": {"pane_id": "w1:p2"}}}
        if args[:2] == ["pane", "get"]:
            return {"result": {"pane": {"pane_id": "w1:p2"}}}
        return {"result": {}}

    monkeypatch.setattr(herdr, "run", run)
    created = herdr.start_agent("ready-agent", "w1", ["opencode"], {}, "/project")

    assert starts == 1
    assert created["pane_id"] == "w1:p2"


def test_start_agent_cleans_partial_tab_after_failure(monkeypatch):
    calls: list[list[str]] = []

    def run(args, timeout=10.0):
        calls.append(args)
        if args[:2] == ["tab", "create"]:
            return {"result": {"root_pane": {"pane_id": "w1:p2"}}}
        if args[:2] == ["agent", "start"]:
            raise herdr.HerdrError("opencode exited before readiness")
        return {"result": {}}

    monkeypatch.setattr(herdr, "run", run)
    with pytest.raises(herdr.HerdrError, match="partial tab was cleaned up"):
        herdr.start_agent("broken-agent", "w1", ["opencode"], {}, "/project")

    assert calls[-1] == ["pane", "close", "w1:p2"]


def test_send_uses_delayed_agent_prompt_for_large_payload(monkeypatch):
    calls: list[list[str]] = []
    waits: list[tuple[str, str, float]] = []
    monkeypatch.setattr(herdr, "run", lambda args, timeout=10.0: calls.append(args) or {})
    monkeypatch.setattr(
        herdr,
        "wait_status",
        lambda pane, status="idle", timeout=5.0: waits.append((pane, status, timeout)) or True,
    )
    prompt = "x" * 5_000
    herdr.send("w1:p2", prompt)
    assert calls == [[
        "agent", "prompt", "w1:p2", prompt,
        "--wait", "--until", "working", "--timeout", "15000",
    ]]
    assert waits == [("w1:p2", "idle", 120.0)]


def test_queued_send_returns_without_status_polling(monkeypatch):
    calls: list[list[str]] = []
    monkeypatch.setattr(herdr, "run", lambda args, timeout=10.0: calls.append(args) or {})
    monkeypatch.setattr(
        herdr,
        "wait_status",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("queued sends must not poll status")),
    )
    herdr.send("w1:p2", "retry", wait_idle=False)
    assert calls == [
        ["pane", "send-text", "w1:p2", "retry"],
        ["pane", "send-keys", "w1:p2", "enter"],
    ]


def test_json_rpc_plumbing(project, monkeypatch):
    server = make_server(project, monkeypatch)
    init = server.handle({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}})
    assert init["result"]["serverInfo"]["version"] == "3.0.0"
    assert "접수일 뿐 열람이나 처리를 보장하지 않는다" in init["result"]["instructions"]
    tools = server.handle({"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
    assert {tool["name"] for tool in tools["result"]["tools"]} == {
        "Execute", "Explore", "Plan", "Research", "Dispatch", "Send", "List", "Collect", "Peek", "Cancel",
    }
    assert server.handle({"jsonrpc": "2.0", "method": "notifications/initialized"}) is None
