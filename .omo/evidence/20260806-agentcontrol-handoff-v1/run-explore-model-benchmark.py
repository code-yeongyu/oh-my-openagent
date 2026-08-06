from __future__ import annotations

import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from tools.agent_control import ledger

EVIDENCE = Path(__file__).resolve().parent
HANDOFF = EVIDENCE / "explore-model-handoff.md"
AUTH = Path.home() / ".local" / "share" / "opencode" / "auth.json"
MODELS = ("openai/gpt-5.6-sol", "openai/gpt-5.6-luna")
REPEATS = 2
PROMPT = (
    "Trace the mandatory AgentControl handoff implementation end to end. "
    "Satisfy every acceptance atom in the handoff, verify source rather than docs, "
    "and return the required detailed Report."
)


def run_once(model: str, repeat: int, metadata: dict[str, str]) -> dict[str, object]:
    slug = model.rsplit("/", 1)[1]
    name = f"bench-{slug}-{repeat}"
    report_path = ROOT / ".agent-control" / "reports" / f"{name}.md"
    with ledger.open_db(ROOT) as conn:
        worker_id = ledger.add_worker(
            conn,
            name,
            "owner:explore-model-benchmark",
            model=model,
            cwd=str(ROOT),
            mode="run",
            agent="agentcontrol-explore",
            handoff_id=metadata["id"],
            handoff_path=metadata["path"],
            handoff_sha256=metadata["sha256"],
        )

    with tempfile.TemporaryDirectory(prefix=f"agentcontrol-{slug}-") as sandbox:
        sandbox_path = Path(sandbox)
        data_home = sandbox_path / "data"
        auth_target = data_home / "opencode" / "auth.json"
        auth_target.parent.mkdir(parents=True)
        shutil.copy2(AUTH, auth_target)
        for directory in ("config", "cache", "state"):
            (sandbox_path / directory).mkdir()
        config = {
            "plugin": [f"file://{ROOT / 'dist' / 'index.js'}"],
            "model": model,
        }
        env = {
            **os.environ,
            "XDG_DATA_HOME": str(data_home),
            "XDG_CONFIG_HOME": str(sandbox_path / "config"),
            "XDG_CACHE_HOME": str(sandbox_path / "cache"),
            "XDG_STATE_HOME": str(sandbox_path / "state"),
            "OPENCODE_CONFIG_CONTENT": json.dumps(config),
            "OPENCODE_DISABLE_AUTOUPDATE": "1",
            "OPENCODE_DISABLE_MODELS_FETCH": "1",
            "AGENT_CONTROL_ROLE": "worker",
            "AGENT_CONTROL_KIND": "explore",
            "AGENT_CONTROL_NAME": name,
            "AGENT_CONTROL_WORKER_ID": str(worker_id),
            "AGENT_CONTROL_OWNER": "owner:explore-model-benchmark",
            "AGENT_CONTROL_REPORT_PATH": str(report_path),
            "AGENT_CONTROL_HANDOFF_ID": metadata["id"],
            "AGENT_CONTROL_HANDOFF_PATH": metadata["path"],
            "AGENT_CONTROL_HANDOFF_SHA256": metadata["sha256"],
        }
        started = time.perf_counter()
        completed = subprocess.run(
            [
                "opencode", "run", "--auto", "--format", "json",
                "--agent", "agentcontrol-explore", "--model", model, PROMPT,
            ],
            cwd=ROOT,
            env=env,
            capture_output=True,
            text=True,
            timeout=600,
            check=False,
        )
        elapsed = time.perf_counter() - started

    events = []
    for line in completed.stdout.splitlines():
        try:
            events.append(json.loads(line))
        except ValueError:
            continue
    token_events = [
        event["part"]["tokens"]
        for event in events
        if event.get("type") == "step_finish"
        and isinstance(event.get("part"), dict)
        and isinstance(event["part"].get("tokens"), dict)
    ]
    with ledger.open_db(ROOT) as conn:
        row = conn.execute(
            "SELECT body, created_at FROM reports "
            "WHERE worker_id=? AND is_final=1 ORDER BY id DESC LIMIT 1",
            (worker_id,),
        ).fetchone()
    details = report_path.read_text(encoding="utf-8") if report_path.exists() else ""
    (EVIDENCE / f"{slug}-run-{repeat}-report.md").write_text(details, encoding="utf-8")
    return {
        "model": model,
        "repeat": repeat,
        "exit_code": completed.returncode,
        "elapsed_seconds": round(elapsed, 3),
        "input_tokens": sum(int(tokens.get("input", 0)) for tokens in token_events),
        "output_tokens": sum(int(tokens.get("output", 0)) for tokens in token_events),
        "reasoning_tokens": sum(int(tokens.get("reasoning", 0)) for tokens in token_events),
        "report_summary": row["body"] if row else None,
        "details_bytes": len(details.encode("utf-8")),
        "stderr_tail": completed.stderr[-500:] if completed.returncode else "",
    }


def main() -> None:
    if not AUTH.is_file():
        raise SystemExit("OpenCode auth.json is unavailable")
    runtime = ROOT / ".agent-control"
    if runtime.exists():
        raise SystemExit(f"refusing to replace existing runtime directory: {runtime}")
    raw = HANDOFF.read_bytes()
    metadata = {
        "id": "explore-model-comparison",
        "path": str(HANDOFF.resolve()),
        "sha256": hashlib.sha256(raw).hexdigest(),
    }
    results: list[dict[str, object]] = []
    try:
        for model in MODELS:
            for repeat in range(1, REPEATS + 1):
                result = run_once(model, repeat, metadata)
                results.append(result)
                print(json.dumps(result, ensure_ascii=False), flush=True)
        (EVIDENCE / "explore-model-metrics.json").write_text(
            json.dumps(results, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
        )
    finally:
        shutil.rmtree(runtime, ignore_errors=True)


if __name__ == "__main__":
    main()
