#!/usr/bin/env python3
"""Isolated todo-17 probes; no product or QA skill source files are changed."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import tomllib

REPO = Path(__file__).resolve().parents[3]
EVIDENCE = Path(__file__).resolve().parent
PLUGIN = REPO / "packages/omo-codex/plugin"
SKILL = REPO / ".agents/skills/codex-qa/scripts"
REAL_CONFIG = Path.home() / ".codex/config.toml"
CODEX_BIN = shutil.which("codex")
BEFORE = subprocess.check_output(["shasum", str(REAL_CONFIG)], text=True).strip()


def run(args, log, *, env=None, cwd=REPO, stdin=None):
    print("COMMAND:", json.dumps([str(arg) for arg in args]), file=log, flush=True)
    result = subprocess.run(args, input=stdin, text=True, capture_output=True,
                            cwd=cwd, env=env, timeout=600)
    print(result.stdout, end="", file=log)
    if result.stderr:
        print("STDERR:", result.stderr, file=log)
    print("EXIT=", result.returncode, sep="", file=log, flush=True)
    result.check_returncode()
    return result.stdout


root = Path(tempfile.mkdtemp(prefix="lcx-c-qa-st_01a08420-")).resolve()
env = os.environ.copy()
env.update({"TMPDIR": str(root), "REPO_ROOT": str(REPO),
            "OMO_DISABLE_POSTHOG": "1", "OMO_CODEX_DISABLE_POSTHOG": "1",
            "CODEX_BIN": CODEX_BIN})
try:
    home = root / "fresh/codex"
    home.mkdir(parents=True)
    # A remaining-only run does not rerun or erase the recorded installer failure.
    # The strict count assertion is preserved for every full run.
    if "--remaining-only" not in sys.argv and "--app-only" not in sys.argv:
        with (EVIDENCE / "task-17-install.log").open("w") as log:
            print("CONFIG_SHA_BEFORE=" + BEFORE, file=log)
            project = root / "fresh/project"
            project.mkdir()
            install_env = env | {"CODEX_HOME": str(home), "OMO_CODEX_PROJECT": str(project),
                                 "CODEX_LOCAL_BIN_DIR": str(home / "bin")}
            run([CODEX_BIN, "--version"], log, env=install_env)
            run(["node", REPO / "packages/omo-codex/scripts/install-local.mjs", "install"],
                log, env=install_env)
            config = tomllib.loads((home / "config.toml").read_text())
            assert config["model"] == "gpt-6-astra", config["model"]
            assert config["model_context_window"] == 600000
            assert config["model_reasoning_effort"] == "high"
            assert config["plan_mode_reasoning_effort"] == "xhigh"
            agents = config["agents"]
            roles = {key: value for key, value in agents.items() if isinstance(value, dict)}
            assert len(roles) == 12, roles.keys()
            assert "max_threads" not in agents
            v2 = config.get("features", {}).get("multi_agent_v2", {})
            assert "max_concurrent_threads_per_session" not in v2
            agent_files = list((home / "agents").glob("*.toml"))
            assert len(agent_files) == 12, agent_files
            assert all(tomllib.loads(path.read_text())["model"] == "gpt-6-astra" for path in agent_files)
            source_manifest = PLUGIN / ".codex-plugin/plugin.json"
            source_count = int(run(["jq", ".hooks|length", source_manifest], log))
            manifests = list((home / "plugins/cache/sisyphuslabs/omo").glob("*/.codex-plugin/plugin.json"))
            assert len(manifests) == 1, manifests
            manifest = json.loads(manifests[0].read_text())
            installed_count = int(run(["jq", ".hooks|length", manifests[0]], log))
            assert installed_count == source_count == 21
            installed_plugin = manifests[0].parents[1]
            for hook in manifest["hooks"]:
                assert (installed_plugin / hook).is_file(), hook
            print("PASS: model=gpt-6-astra; context=600000; reasoning=high; plan=xhigh", file=log)
            print("PASS: 12 agents.* blocks; 12 Astra agent TOMLs; no thread cap keys", file=log)
            print(f"PASS: installed hook count={installed_count}; source hook count={source_count}; all paths exist", file=log)
            print("INSTALLED_HOOK_PATHS=" + json.dumps(manifest["hooks"]), file=log)
            print("CONFIG_SHA_AFTER=" + subprocess.check_output(["shasum", str(REAL_CONFIG)], text=True).strip(), file=log)

    # The shipped helper polls for mock startup. In a disposable copy only,
    # replace that readiness mechanism with a bounded FIFO event read.
    # App-server client, script, mock responses, assertions and cleanup are unchanged.
    copied = root / "codex-qa/scripts"
    (copied / "lib").mkdir(parents=True)
    for rel in ("app-server-drive.sh", "lib/app-server-client.mjs", "lib/mock-model.mjs"):
        shutil.copy2(SKILL / rel, copied / rel)
        assert (SKILL / rel).read_bytes() == (copied / rel).read_bytes()
    common = (SKILL / "lib/common.sh").read_text()
    start = common.index("cqa_start_mock() {")
    end = common.index("\n# Install THIS repo", start)
    readiness = '''cqa_start_mock() {
  local lib_dir fifo signal port
  lib_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  fifo="$CQA_HOME_ROOT/mock-ready.fifo"
  mkfifo "$fifo" || return 1
  node "$lib_dir/mock-model.mjs" >"$fifo" 2>"$CQA_HOME_ROOT/mock.stderr" &
  CQA_MOCK_PID=$!; CQA_PIDS+=("$CQA_MOCK_PID")
  if ! read -r -t 15 signal port <"$fifo"; then
    cqa_fail "mock did not signal readiness within 15 seconds"
    return 1
  fi
  [ "$signal" = "MOCK_LISTENING" ] && [ -n "$port" ] || return 1
  export MOCK_PORT="$port"
}
'''
    (copied / "lib/common.sh").write_text(common[:start] + readiness + common[end:])
    for name, args in (("self-test", ["--self-test"]),
                       ("plugin", ["--plugin", "--expect", "sessionStart,userPromptSubmit"])):
        with (EVIDENCE / f"task-17-app-server-{name}.log").open("w") as log:
            print("CONFIG_SHA_BEFORE=" + BEFORE, file=log)
            print("QA-only adaptation: disposable skill copy; mock startup uses FIFO read -t 15, not polling.", file=log)
            for rel in ("app-server-drive.sh", "lib/app-server-client.mjs", "lib/mock-model.mjs"):
                print("BYTE_IDENTICAL=" + rel + " SHA256=" + hashlib.sha256((SKILL / rel).read_bytes()).hexdigest(), file=log)
            output = run(["bash", copied / "app-server-drive.sh", *args], log, env=env)
            summary, _ = json.JSONDecoder().raw_decode(output.lstrip())
            assert summary["ok"] and summary["turnStatus"] == "completed", summary
            assert summary["assistantText"] == "Hello from the codex-qa mock model.", summary
            if name == "plugin":
                for event in ("sessionStart", "userPromptSubmit"):
                    completed = [hook for hook in summary["hooks"] if hook["method"] == "hook/completed" and hook["eventName"] == event and hook["status"] == "completed"]
                    assert completed, (event, summary)
                    for hook in completed:
                        assert any(started["method"] == "hook/started" and started["runId"] == hook["runId"] for started in summary["hooks"]), hook
            print("PASS: parsed real JSON summary, mock assistant text, and paired hook events", file=log)
            print("CONFIG_SHA_AFTER=" + subprocess.check_output(["shasum", str(REAL_CONFIG)], text=True).strip(), file=log)
    if "--app-only" in sys.argv:
        print("PASS: app-server JSON and paired hook proofs; previous install failure remains recorded")
        raise SystemExit(0)

    # Exercise the rebuilt component through its public CLI stdin/stdout contract.
    with (EVIDENCE / "task-15-executor-verify.log").open("w") as log:
        print("CONFIG_SHA_BEFORE=" + BEFORE, file=log)
        print("Fresh scratch cwd per case prevents the three-attempt escape hatch from masking failures.", file=log)
        receipt_text = ("command exit=0; verification output PASS\n" * 6)[:200]
        assert len(receipt_text) == 200
        cli = PLUGIN / "components/lazycodex-executor-verify/dist/cli.js"
        for case in ("fresh", "stale", "placeholder", "missing-transcript"):
            scratch = root / ("executor-" + case)
            receipt = scratch / ".omo/evidence/receipt.txt"
            receipt.parent.mkdir(parents=True)
            transcript = scratch / "transcript.jsonl"
            run(["touch", transcript], log)
            receipt.write_text("placeholder evidence\n" if case == "placeholder" else receipt_text)
            if case == "stale":
                run(["touch", "-t", "202601010000", receipt], log)
            transcript_path = "/nonexistent" if case == "missing-transcript" else str(transcript)
            if case == "missing-transcript":
                assert not Path(transcript_path).exists()
            payload = {"session_id": "qa", "turn_id": "t1", "transcript_path": transcript_path,
                       "cwd": str(scratch), "hook_event_name": "SubagentStop", "model": "gpt-6-astra",
                       "permission_mode": "default", "agent_id": "w1", "agent_type": "lazycodex-worker-low",
                       "agent_transcript_path": "/dev/null", "stop_hook_active": False,
                       "last_assistant_message": "done. EVIDENCE_RECORDED: .omo/evidence/receipt.txt"}
            print("\nCASE=" + case + " PAYLOAD=" + json.dumps(payload), file=log)
            stats = run(["node", "--input-type=module", "-e",
                         "import {statSync} from 'node:fs'; const [t,e]=process.argv.slice(1).map(p=>statSync(p)); console.log(JSON.stringify({transcriptBirthtimeMs:t.birthtimeMs,transcriptCtimeMs:t.ctimeMs,evidenceMtimeMs:e.mtimeMs}));",
                         transcript, receipt], log)
            times = json.loads(stats)
            if case == "fresh":
                assert times["evidenceMtimeMs"] >= times["transcriptBirthtimeMs"]
            if case == "stale":
                assert times["evidenceMtimeMs"] < times["transcriptBirthtimeMs"]
            probe_env = env | {"CODEX_HOME": str(home), "PLUGIN_ROOT": str(PLUGIN),
                               "PLUGIN_DATA": str(scratch / "plugin-data")}
            output = run(["node", cli, "hook", "subagent-stop"], log, env=probe_env,
                         cwd=scratch, stdin=json.dumps(payload))
            if case in ("fresh", "missing-transcript"):
                assert output == "", repr(output)
                print("PASS: empty stdout (0 bytes)", file=log)
            else:
                parsed = json.loads(output)
                assert set(parsed) == {"decision", "reason"}, parsed
                assert parsed["decision"] == "block" and case in parsed["reason"], parsed
                print("PASS: decision=block; named reason=" + case, file=log)
        print("CONFIG_SHA_AFTER=" + subprocess.check_output(["shasum", str(REAL_CONFIG)], text=True).strip(), file=log)
finally:
    shutil.rmtree(root)
    after = subprocess.check_output(["shasum", str(REAL_CONFIG)], text=True).strip()
    with (EVIDENCE / "task-17-ship.log").open("a") as log:
        print("\nQA_TEMP_ROOT=" + str(root), file=log)
        print("QA_TEMP_ROOT_REMOVED=" + str(not root.exists()).lower(), file=log)
        print("CONFIG_SHA_BEFORE=" + BEFORE, file=log)
        print("CONFIG_SHA_AFTER=" + after, file=log)
    assert after == BEFORE, (BEFORE, after)
    assert not root.exists()
print("PASS: mock app-server self-test/plugin, four raw-pipe cases, cleanup, and config shasum equality")
if "--remaining-only" in sys.argv:
    print("Installer equality failure is retained in task-17-install.log; no overall green result is claimed.")
