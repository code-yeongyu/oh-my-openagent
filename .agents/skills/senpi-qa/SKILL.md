---
name: senpi-qa
description: "QA the omo Senpi adapter (packages/omo-senpi, packages/senpi-task) against the REAL senpi binary in strict isolation, and write every artifact to the one canonical evidence path .omo/evidence/omo-senpi-adapter/<slug>/. The live drivers under packages/omo-senpi/scripts/qa/ create their own isolated SENPI_CODING_AGENT_DIR and ignore the caller's, so the real ~/.senpi/agent is never written. Ships scripts/resolve-evidence-dir.mjs, which is the ONLY sanctioned way to pick an evidence directory: it rejects traversal, separators, absolute paths, and stray roots such as local-ignore/qa-evidence. Use whenever someone changes anything under packages/omo-senpi or packages/senpi-task, or wants to QA, smoke-test, verify, or debug the Senpi adapter, the task/team engine, the DAG, task RPC, or skill delivery. Triggers: senpi qa, qa senpi, senpi-qa, test senpi adapter, verify senpi task, senpi task e2e, senpi team e2e, task dag qa, live senpi driver, senpi evidence path."
---

# Senpi QA

QA the omo Senpi adapter (`packages/omo-senpi/`) and the task engine
(`packages/senpi-task/`) by driving the REAL `senpi` binary. Unit tests never
count as live QA here: `bun run test:senpi` is the package gate, the drivers in
`packages/omo-senpi/scripts/qa/` are the harness proof.

## Golden rules

- **Evidence lives at exactly one path.** Every artifact goes under
  `.omo/evidence/omo-senpi-adapter/<slug>/`. Pick it with
  `scripts/resolve-evidence-dir.mjs` and nothing else — a hand-typed path is how
  runs end up somewhere like `local-ignore/qa-evidence/`, which no reviewer reads
  and the PR cannot cite.
- **The real agent dir stays untouched.** The live drivers build their own
  isolated `SENPI_CODING_AGENT_DIR` and deliberately IGNORE a caller-provided
  one, so `~/.senpi/agent` is never used as the sandbox. Report the driver's
  `realSenpiUntouched` / changed-path fields and the isolated agent-dir path;
  treat a whole-directory digest as supporting evidence, not proof by itself.
- **No binary means SKIP, not silence.** When `senpi` is absent the live drivers
  report `SKIP` or `FAIL` in their final JSON rather than degrading to the real
  home. A `SKIP` is not a pass — say so in the evidence README.
- **The captured JSON is the evidence.** No file on disk means the QA did not
  happen, which means no commit and no push.

## Resolve the evidence directory first

```bash
ev="$(node .agents/skills/senpi-qa/scripts/resolve-evidence-dir.mjs \
  --repo-root "$(git rev-parse --show-toplevel)" --slug <YYYYMMDD>-<short-slug>)"
mkdir -p "$ev"
```

The resolver returns an absolute path and creates nothing, so the caller decides
when the directory appears. A slug is ONE relative segment of lowercase letters,
digits, and hyphens (`20260820-senpi-qa-contract`). Separators, `.`/`..`,
traversal, absolute paths, and a non-git root are rejected with a non-zero exit
and a message naming the offending slug.

## Router: pick your case

| You changed… | Run | Proves |
|---|---|---|
| Any adapter code, as the fast precondition | `node packages/omo-senpi/scripts/qa/drive.mjs --self-test` | the driver + isolation harness itself works |
| Adapter wiring reaching a live session | `node packages/omo-senpi/scripts/qa/drive.mjs` | a real senpi run with the plugin loaded, isolated agent dir, and no attributed real-home changes |
| Task lifecycle (single + batch) | `SENPI_BIN="$(command -v senpi)" node packages/omo-senpi/scripts/qa/task-e2e.mjs` | live task start/stream/terminal states |
| Team delivery, shutdown, reclaim, restart recovery | `SENPI_BIN="$(command -v senpi)" node packages/omo-senpi/scripts/qa/team-e2e.mjs` | injection delivery and exactly-once recovery |
| Task RPC driver scripts | `node packages/omo-senpi/scripts/qa/task-rpc-e2e.mjs --self-test` | the RPC surface contract |
| Skill delivery into a task | `SENPI_BIN="$(command -v senpi)" node packages/omo-senpi/scripts/qa/task-load-skills-e2e.mjs` | skills reach the child |
| Continuation behavior | `node packages/omo-senpi/scripts/qa/probe-continuation.mjs` | turns continue as expected |
| DAG state machine / runners | `bun test packages/senpi-task` | unit + chaos invariants (NOT live proof) |

Point a driver's output at the resolved directory, e.g.:

```bash
TASK_E2E_OUT_DIR="$ev/live-task-dag" SENPI_BIN="$(command -v senpi)" \
  node packages/omo-senpi/scripts/qa/task-e2e.mjs
```

## Package gate

```bash
tsgo --noEmit -p packages/omo-senpi/tsconfig.json
bun run test:senpi
```

## Write the evidence README

Every run leaves `$ev/README.md` a reviewer can read without rerunning anything.
The required sections are the repo-wide evidence rules in the root
[`AGENTS.md`](../../../AGENTS.md) (what was tested / observed / why it is enough /
what was omitted). For Senpi, record the driver's changed-path/isolation fields
and sandbox agent-dir path. Some drivers report sandbox paths without removing
them; the caller must delete every task-owned sandbox and verify child PIDs are
terminal before writing the cleanup receipt.
