"""얇은 tmux 헬퍼. tmux가 실행기·상태 저장소·로그·통신 채널 전부다."""

from __future__ import annotations

import os
import subprocess
import time
from typing import Any

WINDOW_PREFIX = "agent:"
LIST_FORMAT = "#{window_id}\t#{window_name}\t#{pane_id}\t#{pane_dead}\t#{pane_current_command}\t#{window_activity}"


class TmuxError(RuntimeError):
    pass


def tmux_bin() -> str:
    return os.environ.get("AGENT_CONTROL_TMUX_BIN", "tmux")


def run(args: list[str], stdin_text: str | None = None, timeout: float = 10.0) -> str:
    completed = subprocess.run(
        [tmux_bin(), *args],
        input=stdin_text,
        capture_output=True, text=True, timeout=timeout, check=False,
        stdin=subprocess.DEVNULL if stdin_text is None else None,
    )
    if completed.returncode != 0:
        raise TmuxError(f"tmux {args[0]} failed: {completed.stderr.strip()}")
    return completed.stdout


def display(target: str, fmt: str) -> str:
    return run(["display-message", "-p", "-t", target, fmt]).strip()


def pane_session(pane: str) -> str:
    return display(pane, "#{session_id}")


def window_name(name: str) -> str:
    return f"{WINDOW_PREFIX}{name}"


def list_agent_windows() -> list[dict[str, Any]]:
    """모든 세션의 agent:* 창 목록. 링크된 창은 window_id로 중복 제거."""
    try:
        raw = run(["list-windows", "-a", "-F", LIST_FORMAT])
    except TmuxError:
        return []
    seen: set[str] = set()
    windows: list[dict[str, Any]] = []
    for line in raw.splitlines():
        fields = line.split("\t")
        if len(fields) != 6 or not fields[1].startswith(WINDOW_PREFIX):
            continue
        window_id, name, pane_id, pane_dead, command, activity = fields
        if window_id in seen:
            continue
        seen.add(window_id)
        windows.append({
            "name": name.removeprefix(WINDOW_PREFIX),
            "window": window_id,
            "pane": pane_id,
            "alive": pane_dead == "0",
            "command": command,
            "last_output_at": int(activity) if activity.isdigit() else None,
        })
    return windows


def find_agent_window(name: str) -> dict[str, Any] | None:
    for window in list_agent_windows():
        if window["name"] == name:
            return window
    return None


def resolve_target(target: str) -> dict[str, Any]:
    """이름(agent: 접두 유무 무관), %pane, @window를 pane 딕셔너리로 해석."""
    if target.startswith("%") or target.startswith("@"):
        for window in list_agent_windows():
            if target in (window["pane"], window["window"]):
                return window
        raise TmuxError(f"no agent window for target: {target}")
    name = target.removeprefix(WINDOW_PREFIX)
    window = find_agent_window(name)
    if window is None:
        raise TmuxError(f"no agent window named: {name}")
    return window


def new_agent_window(
    leader_session: str, name: str, command: list[str], env: dict[str, str], cwd: str,
) -> dict[str, str]:
    """리더 세션에 agent:<name> 창을 만들고(즉시 포커스) 식별자를 반환한다."""
    args = ["new-window", "-t", f"{leader_session}:", "-n", window_name(name), "-c", cwd,
            "-P", "-F", "#{session_id}\t#{window_id}\t#{pane_id}"]
    for key, value in env.items():
        args += ["-e", f"{key}={value}"]
    args += ["--", *command]
    fields = run(args).strip().split("\t")
    if len(fields) != 3:
        raise TmuxError("tmux new-window returned invalid identity")
    session_id, window_id, pane_id = fields
    # 프로세스가 죽어도 pane을 남겨 사람이 마지막 화면을 볼 수 있게 한다.
    run(["set-option", "-p", "-t", pane_id, "remain-on-exit", "on"])
    return {"session": session_id, "window": window_id, "pane": pane_id}


def capture(pane: str) -> str:
    return run(["capture-pane", "-p", "-t", pane])


def wait_idle(pane: str, timeout: float = 40.0, stable_polls: int = 4, interval: float = 0.4) -> bool:
    """화면이 비어있지 않고 연속 N회 폴링 동안 동일하면 idle로 판정한다."""
    deadline = time.monotonic() + timeout
    previous: str | None = None
    stable = 0
    while time.monotonic() < deadline:
        try:
            screen = capture(pane)
        except TmuxError:
            return False
        if screen.strip() and screen == previous:
            stable += 1
            if stable >= stable_polls - 1:
                return True
        else:
            stable = 0
        previous = screen
        time.sleep(interval)
    return False


def paste(pane: str, text: str, enter: bool = True) -> None:
    """bracketed paste로 텍스트를 입력 상자에 넣고 Enter를 보낸다."""
    buffer = f"agent-control-{os.getpid()}-{time.monotonic_ns()}"
    run(["load-buffer", "-b", buffer, "-"], stdin_text=text)
    run(["paste-buffer", "-p", "-d", "-b", buffer, "-t", pane])
    if enter:
        time.sleep(0.2)
        run(["send-keys", "-t", pane, "Enter"])


def idle_safe_paste(pane: str, text: str, settle_timeout: float = 5.0) -> None:
    """짧은 안정화 대기 후 paste. TUI는 생성 중에도 입력을 큐잉하므로 대기 실패는 치명적이지 않다."""
    wait_idle(pane, timeout=settle_timeout, stable_polls=3, interval=0.3)
    paste(pane, text)


def kill_window(window_id: str) -> None:
    run(["kill-window", "-t", window_id])
