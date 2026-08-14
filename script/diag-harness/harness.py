#!/usr/bin/env python3
"""Self-improving stress harness for Sisyphus on DeepSeek V4 Flash 0731.

Scenarios ship a `gen.py <seed> <project-dir>` generator: the harness calls it
per seed to produce a fresh randomized project (tests + check.sh carry expected
values computed by the generator). Scenarios without gen.py reset a pristine
snapshot between runs.

Search: epsilon-greedy bandit over config combos (variant x temperature x top_p)
with pass-rate memory; untried combos get exploration priority. Learning:
failure signals map to guardrail lines appended to guardrails.md, rendered into
`.omo/rules/diag-guardrail-*.md` rule files (alwaysApply) consumed by the native
rules-injector hook, capped at 12 lines.

Usage: harness.py <scenarios-dir> <evidence-dir> [--seeds N] [--max-iter N]
"""
import argparse
import json
import os
import random
import re
import shutil
import subprocess
import sys
import tempfile
import time

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RUN_TASK = os.path.join(BASE_DIR, "run-task.sh")
SCORE = os.path.join(BASE_DIR, "score.py")
GUARDRAILS = os.path.join(BASE_DIR, "guardrails.md")
BASE_CONFIG = os.path.join(BASE_DIR, "sandbox-omo-config.jsonc")
PRISTINE = os.path.join(tempfile.gettempdir(), "diag-harness-pristine")
RUN_TIMEOUT = 1200

MUTATIONS = [
    ("base", {}),
    ("high", {"variant": "high"}),
    ("temp07", {"temperature": 0.7}),
    ("high-temp07", {"variant": "high", "temperature": 0.7}),
    ("temp10", {"temperature": 1.0}),
    ("topp95", {"top_p": 0.95}),
    ("temp10-topp95", {"temperature": 1.0, "top_p": 0.95}),
]

GUARDRAIL_RULES = [
    ("drift", "TOOL FORMAT: Never serialize tool calls into text content. Use the structured tool_calls field only."),
    ("cjk", "OUTPUT LANGUAGE: Respond in English only. Never emit CJK characters."),
    ("hallucination", "VERIFY PATHS: Never claim a file exists or a value is correct without reading it yourself."),
    ("fabricated-id", "TOOL ARGUMENTS: Never invent task/background/session IDs or file paths. Only use IDs returned by tool results."),
    ("unavailable-tool", "TOOL FALLBACK: If a tool is unavailable, switch to a bash equivalent immediately."),
    ("error", "API FAILURES: On API failure retry once, then proceed with what you have; never fabricate output."),
    ("lost-constraint", "CONSTRAINTS: Every rule stated in the task prompt must be honored until the task ends, including rules at the start and end."),
]

COMBO_STATS = {}


def combo_key(mut_cfg):
    return json.dumps(mut_cfg, sort_keys=True)


def pick_combo():
    untried = [m for m in MUTATIONS if combo_key(m[1]) not in COMBO_STATS]
    if untried and (random.random() < 0.5 or not COMBO_STATS):
        return random.choice(untried)
    best = max(COMBO_STATS.items(), key=lambda kv: (kv[1][0] / kv[1][1], kv[1][1]))
    for mut in MUTATIONS:
        if combo_key(mut[1]) == best[0]:
            return mut
    return MUTATIONS[0]


def record_combo(mut_cfg, passed):
    key = combo_key(mut_cfg)
    wins, n = COMBO_STATS.get(key, (0, 0))
    COMBO_STATS[key] = (wins + (1 if passed else 0), n + 1)


def load_config(mutation_name, mut_cfg):
    with open(BASE_CONFIG) as f:
        cfg = f.read()
    cfg = cfg.replace('"variant": "max"', f'"variant": "{mut_cfg.get("variant", "max")}"')
    junior = '"sisyphus-junior": {'
    if mut_cfg.get("temperature") is not None:
        cfg = cfg.replace(junior, f'"sisyphus-junior": {{ "temperature": {mut_cfg["temperature"]},')
    if mut_cfg.get("top_p") is not None:
        cfg = cfg.replace(junior, f'"sisyphus-junior": {{ "top_p": {mut_cfg["top_p"]},')
    out = os.path.join(tempfile.gettempdir(), f"diag-harness-config-{mutation_name}.jsonc")
    with open(out, "w") as f:
        f.write(cfg)
    return out


def score_jsonl(path):
    r = subprocess.run([sys.executable, SCORE, path, "x"], capture_output=True, text=True)
    try:
        return json.loads(r.stdout)
    except json.JSONDecodeError:
        return {"score_error": (r.stdout + r.stderr)[-500:]}


def bun_test(project_dir):
    try:
        r = subprocess.run(["bun", "test"], cwd=project_dir, capture_output=True, text=True, timeout=120)
        out = r.stdout + r.stderr
        m = re.search(r"(\d+)\s+pass", out)
        return r.returncode == 0, int(m.group(1)) if m else -1, out[-300:]
    except Exception:  # noqa: BLE001
        return False, -1, "bun test crashed"


def check_scenario(sc_dir):
    check = os.path.join(sc_dir, "check.sh")
    if not os.path.exists(check):
        check = os.path.join(sc_dir, "project", "check.sh")
    if not os.path.exists(check):
        return None, ""
    try:
        r = subprocess.run(["bash", check], cwd=os.path.join(sc_dir, "project"),
                           capture_output=True, text=True, timeout=120)
        return r.returncode == 0, (r.stdout + r.stderr)[-300:]
    except Exception:  # noqa: BLE001
        return False, "check.sh crashed"


def learn(signals, evidence):
    for sig_name, rule in GUARDRAIL_RULES:
        if sig_name not in signals:
            continue
        lines = [l for l in open(GUARDRAILS).read().splitlines() if l.strip()]
        for old_name, old_rule in GUARDRAIL_RULES:
            if old_name == sig_name and old_rule in lines:
                lines.remove(old_rule)
        if rule not in lines:
            lines.append(rule)
            print(f"[harness] LEARNING guardrail from signal '{sig_name}'")
        with open(GUARDRAILS, "w") as f:
            f.write("\n".join(lines) + "\n")


def cap_guardrails():
    if not os.path.exists(GUARDRAILS):
        return
    lines = [l for l in open(GUARDRAILS).read().splitlines() if l.strip()]
    if len(lines) > 12:
        with open(GUARDRAILS, "w") as f:
            f.write("\n".join(lines[:12]) + "\n")


def emit_rule_files(rules_dir):
    """Render learned guardrails as .omo/rules/*.md for the native rules-injector.

    The rules-injector hook scans `.omo/rules` in the project root and injects
    matched rule files into tool output. Each learned guardrail becomes its own
    rule file with `alwaysApply: true`, so a signal that fired in a previous
    iteration is injected into subsequent runs without any custom prompt_append.
    """
    os.makedirs(rules_dir, exist_ok=True)
    if not os.path.exists(GUARDRAILS):
        return
    lines = [l for l in open(GUARDRAILS).read().splitlines() if l.strip()]
    for index, rule in enumerate(lines):
        rule_path = os.path.join(rules_dir, f"diag-guardrail-{index + 1}.md")
        with open(rule_path, "w") as f:
            f.write(
                "---\n"
                "description: Learned guardrail from diag-harness failure signal\n"
                "alwaysApply: true\n"
                "---\n"
                f"{rule}\n"
            )


def detect_signals(score, bun_ok, check_ok, check_tail, jsonl_path):
    signals = set()
    if score.get("drift_marker_hits", 0) > 0:
        signals.add("drift")
    if score.get("cjk_text_hits", 0) > 0:
        signals.add("cjk")
    if not bun_ok:
        signals.add("hallucination")
        signals.add("error")
    if check_ok is not None and not check_ok:
        signals.add("lost-constraint")
    joined = json.dumps(score.get("error_samples", [])) + check_tail
    if "unavailable tool" in joined.lower():
        signals.add("unavailable-tool")
    if "task not found" in joined.lower():
        signals.add("fabricated-id")
    if jsonl_path and os.path.exists(jsonl_path) and re.search(r"\[ERROR\]", open(jsonl_path).read()):
        signals.add("fabricated-id")
    return signals


def snapshot_project(sc_dir):
    proj = os.path.join(sc_dir, "project")
    dst = os.path.join(PRISTINE, os.path.basename(sc_dir))
    if not os.path.exists(dst):
        shutil.copytree(proj, dst)
    return dst


def reset_project(sc_dir):
    proj = os.path.join(sc_dir, "project")
    dst = os.path.join(PRISTINE, os.path.basename(sc_dir))
    if not os.path.isdir(dst):
        snapshot_project(sc_dir)
    shutil.rmtree(proj, ignore_errors=True)
    shutil.copytree(dst, proj)


def gen_project(sc_dir, seed):
    gen = os.path.join(sc_dir, "gen.py")
    proj = os.path.join(sc_dir, "project")
    shutil.rmtree(proj, ignore_errors=True)
    if os.path.exists(gen):
        subprocess.run([sys.executable, gen, str(seed), proj], check=True, timeout=120)
    else:
        reset_project(sc_dir)


def run_one(sc_dir, label, config_path, evidence_dir):
    env = {**os.environ, "EVIDENCE_DIR": evidence_dir}
    subprocess.run(["bash", RUN_TASK, sc_dir, label, config_path], timeout=RUN_TIMEOUT, env=env)
    jsonl = os.path.join(evidence_dir, f"{label}.jsonl")
    score = score_jsonl(jsonl) if os.path.exists(jsonl) else {"missing": True}
    bun_ok, bun_passes, _ = bun_test(os.path.join(sc_dir, "project"))
    check_ok, check_tail = check_scenario(sc_dir)
    return score, bun_ok, bun_passes, check_ok, check_tail, jsonl


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("scenarios_dir")
    ap.add_argument("evidence_dir")
    ap.add_argument("--seeds", type=int, default=1)
    ap.add_argument("--max-iter", type=int, default=2)
    args = ap.parse_args()

    scenarios = sorted(
        d for d in os.listdir(args.scenarios_dir)
        if os.path.isdir(os.path.join(args.scenarios_dir, d))
        and os.path.exists(os.path.join(args.scenarios_dir, d, "prompt.md"))
    )
    os.makedirs(args.evidence_dir, exist_ok=True)
    results = []
    guardrail_evidence = open(GUARDRAILS).read() if os.path.exists(GUARDRAILS) else ""

    for sc in scenarios:
        sc_dir = os.path.join(os.path.abspath(args.scenarios_dir), sc)
        print(f"\n===== SCENARIO {sc} =====")
        for seed in range(1, args.seeds + 1):
            gen_project(sc_dir, seed)
            sc_rules_dir = os.path.join(sc_dir, "project", ".omo", "rules")
            os.makedirs(sc_rules_dir, exist_ok=True)
            for iteration in range(args.max_iter):
                mut_name, mut_cfg = pick_combo()
                emit_rule_files(sc_rules_dir)
                label = f"{sc}-s{seed}-i{iteration}-{mut_name}"
                config_path = load_config(mut_name, mut_cfg)
                print(f"[harness] {label}: {combo_key(mut_cfg)} guardrails={'yes' if guardrail_evidence else 'no'}")
                t0 = time.time()
                score, bun_ok, bun_passes, check_ok, check_tail, jsonl = run_one(sc_dir, label, config_path, args.evidence_dir)
                elapsed = round(time.time() - t0, 1)
                passed = (
                    score.get("finished", False)
                    and score.get("error_events", 1) == 0
                    and score.get("drift_marker_hits", 1) == 0
                    and score.get("cjk_text_hits", 1) == 0
                    and bun_ok
                    and (check_ok if check_ok is not None else True)
                )
                record_combo(mut_cfg, passed)
                results.append({
                    "scenario": sc, "seed": seed, "iteration": iteration,
                    "mutation": mut_name, "config": mut_cfg,
                    "passed": passed, "elapsed_s": elapsed,
                    "events": score.get("events"), "errors": score.get("error_events"),
                    "drift": score.get("drift_marker_hits"), "cjk": score.get("cjk_text_hits"),
                    "bun_pass": bun_passes, "check_ok": check_ok,
                    "check_tail": check_tail[:150],
                })
                print(f"[harness] {label} -> {'PASS' if passed else 'FAIL'} ({elapsed}s bun {bun_passes} check={check_ok})")
                if passed:
                    break
                signals = detect_signals(score, bun_ok, check_ok, check_tail, jsonl)
                learn(signals, guardrail_evidence)
                cap_guardrails()
                guardrail_evidence = open(GUARDRAILS).read() if os.path.exists(GUARDRAILS) else ""

    report = {
        "runs": results,
        "combo_stats": {k: {"pass": v[0], "runs": v[1]} for k, v in COMBO_STATS.items()},
        "learned_guardrails": [l for l in open(GUARDRAILS).read().splitlines() if l.strip()],
        "per_scenario_pass_rate": {
            s: round(sum(1 for r in results if r["scenario"] == s and r["passed"]) / max(1, sum(1 for r in results if r["scenario"] == s)), 2)
            for s in sorted({r["scenario"] for r in results})
        },
    }
    with open(os.path.join(args.evidence_dir, "stress-report.json"), "w") as f:
        json.dump(report, f, indent=2)
    print("\n===== HARNESS REPORT =====")
    print(json.dumps(report["per_scenario_pass_rate"], indent=2))
    print("combo stats:", json.dumps(report["combo_stats"], indent=2))
    print("learned guardrails:", report["learned_guardrails"] or "(none)")


if __name__ == "__main__":
    main()
