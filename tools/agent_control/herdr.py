"""Thin Herdr adapter for Agent Control runtime operations."""

from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

AGENT_PREFIX = "agent:"
OWNER_TOKEN = "agent_control_owner_pane"
PROJECT_TOKEN = "agent_control_project"
SHELL_ZDOTDIR = Path(__file__).with_name("zsh")


class HerdrError(RuntimeError):
    pass


def herdr_bin() -> str:
    configured = os.environ.get("AGENT_CONTROL_HERDR_BIN")
    if configured:
        return configured
    resolved = shutil.which("herdr")
    if resolved:
        return resolved
    local = Path.home() / ".local" / "bin" / "herdr"
    return str(local) if local.is_file() else "herdr"


def run(args: list[str], timeout: float = 10.0) -> dict[str, Any]:
    try:
        completed = subprocess.run(
            [herdr_bin(), *args],
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
            stdin=subprocess.DEVNULL,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise HerdrError(f"herdr {args[0]} failed: {exc}") from exc

    output = completed.stdout.strip()
    try:
        payload = json.loads(output) if output else {}
    except ValueError as exc:
        detail = completed.stderr.strip() or output or f"exit {completed.returncode}"
        raise HerdrError(f"herdr {args[0]} returned invalid JSON: {detail}") from exc

    error = payload.get("error") if isinstance(payload, dict) else None
    if completed.returncode != 0 or error:
        if isinstance(error, dict):
            detail = error.get("message") or error.get("code") or str(error)
        else:
            detail = completed.stderr.strip() or output or f"exit {completed.returncode}"
        raise HerdrError(f"herdr {args[0]} failed: {detail}")
    return payload


def result(payload: dict[str, Any]) -> dict[str, Any]:
    value = payload.get("result")
    if not isinstance(value, dict):
        raise HerdrError("herdr response has no result object")
    return value


def agent_name(name: str) -> str:
    return name if name.startswith(AGENT_PREFIX) else f"{AGENT_PREFIX}{name}"


def list_workspaces() -> list[dict[str, Any]]:
    workspaces = result(run(["workspace", "list"])).get("workspaces", [])
    return [w for w in workspaces if isinstance(w, dict) and w.get("workspace_id")]


def list_agents() -> list[dict[str, Any]]:
    agents = result(run(["agent", "list"])).get("agents", [])
    return [agent for agent in agents if isinstance(agent, dict)]


def find_agent_by_session(session_id: str) -> dict[str, Any] | None:
    for agent in list_agents():
        session = agent.get("agent_session")
        if isinstance(session, dict) and session.get("value") == session_id:
            return agent
    return None


def list_agent_workers(owner_pane: str | None = None) -> list[dict[str, Any]]:
    workers: list[dict[str, Any]] = []
    for agent in list_agents():
        tokens = agent.get("tokens") if isinstance(agent.get("tokens"), dict) else {}
        owner = tokens.get(OWNER_TOKEN)
        raw_name = str(agent.get("name", ""))
        if owner is None and not raw_name.startswith(AGENT_PREFIX):
            continue
        if owner_pane is not None and owner != owner_pane:
            continue
        short_name = raw_name.removeprefix(AGENT_PREFIX)
        workers.append({
            "name": short_name,
            "agent": agent_name(short_name),
            "pane": agent.get("pane_id"),
            "terminal": agent.get("terminal_id"),
            "tab": agent.get("tab_id"),
            "workspace": agent.get("workspace_id"),
            "alive": True,
            "status": agent.get("agent_status", "unknown"),
            "cwd": agent.get("cwd"),
            "foreground_cwd": agent.get("foreground_cwd"),
            "revision": agent.get("revision"),
            "owner_pane": owner,
            "project": tokens.get(PROJECT_TOKEN),
        })
    return workers


def find_agent_worker(name: str, owner_pane: str | None = None) -> dict[str, Any] | None:
    wanted = name.removeprefix(AGENT_PREFIX)
    return next((worker for worker in list_agent_workers(owner_pane) if worker["name"] == wanted), None)


def resolve_target(target: str, owner_pane: str | None = None) -> dict[str, Any]:
    short_name = target.removeprefix(AGENT_PREFIX)
    for worker in list_agent_workers(owner_pane):
        if target in {worker["agent"], worker["pane"], worker["terminal"]} or short_name == worker["name"]:
            return worker
    raise HerdrError(f"no agent pane for target: {target}")


def list_pane_ids() -> set[str]:
    panes = result(run(["pane", "list"])).get("panes", [])
    return {str(p["pane_id"]) for p in panes if isinstance(p, dict) and p.get("pane_id")}


def start_run(name: str, workspace: str, env: dict[str, str], cwd: str) -> dict[str, Any]:
    """run 모드 worker용 pane을 만든다. agent 감지 배리어 없이 shell 훅이 명령을 실행한다."""
    tab_args = [
        "tab", "create", "--workspace", workspace, "--cwd", cwd,
        "--label", agent_name(name), "--no-focus",
    ]
    tab_env = {**env, "ZDOTDIR": str(SHELL_ZDOTDIR)}
    for key, value in tab_env.items():
        tab_args += ["--env", f"{key}={value}"]
    created = result(run(tab_args))
    root_pane = created.get("root_pane")
    if not isinstance(root_pane, dict) or not root_pane.get("pane_id"):
        raise HerdrError("herdr tab create returned invalid root pane identity")
    pane = str(root_pane["pane_id"])
    try:
        metadata = [
            "pane", "report-metadata", pane, "--source", "agent-control",
            "--token", f"{PROJECT_TOKEN}={env.get('AGENT_CONTROL_PROJECT', cwd)}",
        ]
        owner = env.get("AGENT_CONTROL_OWNER") or env.get("AGENT_LEADER_PANE")
        if owner:
            metadata += ["--token", f"{OWNER_TOKEN}={owner}"]
        run(metadata)
    except HerdrError as exc:
        try:
            run(["pane", "close", pane])
        except HerdrError:
            pass
        raise HerdrError(f"run worker {agent_name(name)} startup failed and its tab was cleaned up: {exc}") from exc
    return dict(root_pane)


def start_agent(
    name: str,
    workspace: str,
    command: list[str],
    env: dict[str, str],
    cwd: str,
) -> dict[str, Any]:
    if not command or Path(command[0]).name != "opencode":
        raise HerdrError("Agent Control requires an opencode command")
    tab_args = [
        "tab", "create", "--workspace", workspace, "--cwd", cwd,
        "--label", agent_name(name), "--no-focus",
    ]
    tab_env = {**env, "ZDOTDIR": str(SHELL_ZDOTDIR)}
    for key, value in tab_env.items():
        tab_args += ["--env", f"{key}={value}"]
    created = result(run(tab_args))
    root_pane = created.get("root_pane")
    if not isinstance(root_pane, dict) or not root_pane.get("pane_id"):
        raise HerdrError("herdr tab create returned invalid root pane identity")
    pane = str(root_pane["pane_id"])
    try:
        # agent start can return before process detection; the rendered composer
        # is the first reliable signal that pane-addressed input can be accepted.
        start_args = [
            "agent", "start", name, "--kind", "opencode", "--pane", pane,
            "--timeout", "30000", "--", *command[1:],
        ]
        agent = result(run(start_args, timeout=32.0)).get("agent")
        if not isinstance(agent, dict) or agent.get("pane_id") != pane:
            raise HerdrError("herdr agent start returned invalid identity")
        run(
            [
                "pane", "wait-output", pane, "--match", "ctrl+p commands",
                "--source", "visible", "--lines", "120", "--timeout", "30000",
            ],
            timeout=32.0,
        )
        metadata = [
            "pane", "report-metadata", pane, "--source", "agent-control",
            "--token", f"{PROJECT_TOKEN}={cwd}",
        ]
        # headless 리더는 pane이 없으므로 owner uuid가 소유권 토큰이 된다.
        owner_pane = env.get("AGENT_CONTROL_OWNER") or env.get("AGENT_LEADER_PANE")
        if owner_pane:
            metadata += ["--token", f"{OWNER_TOKEN}={owner_pane}"]
        run(metadata)
        current = result(run(["pane", "get", pane])).get("pane")
    except HerdrError as exc:
        try:
            run(["pane", "close", pane])
        except HerdrError:
            pass
        raise HerdrError(f"agent {agent_name(name)} startup failed and its partial tab was cleaned up: {exc}") from exc
    if not isinstance(current, dict) or current.get("pane_id") != pane:
        raise HerdrError(f"agent {agent_name(name)} started, but Herdr returned invalid pane identity")
    return {**root_pane, **agent, **current}


def wait_status(pane: str, status: str = "idle", timeout: float = 40.0) -> bool:
    milliseconds = max(1, int(timeout * 1000))
    try:
        run(
            ["agent", "wait", pane, "--until", status, "--timeout", str(milliseconds)],
            timeout=timeout + 2.0,
        )
    except HerdrError:
        return False
    return True


def send(pane: str, text: str, wait_idle: bool = True) -> None:
    if wait_idle and not wait_status(pane, timeout=120.0):
        raise HerdrError(f"OpenCode pane {pane} did not become idle")
    if wait_idle:
        run(
            [
                "agent", "prompt", pane, text,
                "--wait", "--until", "working", "--timeout", "15000",
            ],
            timeout=17.0,
        )
        return
    run(["pane", "send-text", pane, text], timeout=15.0)
    run(["pane", "send-keys", pane, "enter"], timeout=15.0)


def close(pane: str) -> None:
    run(["pane", "close", pane])


def notify(title: str, body: str = "", sound: str = "done") -> None:
    """Herdr UI/데스크톱 알림. 사람에게 보내는 best-effort push다."""
    args = ["notification", "show", title, "--sound", sound]
    if body:
        args += ["--body", body]
    run(args)


def read_output(pane: str, lines: int, facade: str = "agent") -> str:
    """`herdr agent|pane read`는 JSON이 아닌 raw 터미널 텍스트를 출력한다."""
    try:
        completed = subprocess.run(
            [herdr_bin(), facade, "read", pane, "--lines", str(lines)],
            capture_output=True, text=True, timeout=10.0, check=False,
            stdin=subprocess.DEVNULL,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise HerdrError(f"herdr agent read failed: {exc}") from exc
    if completed.returncode != 0:
        raise HerdrError(f"herdr agent read failed: {completed.stderr.strip() or completed.returncode}")
    return completed.stdout
