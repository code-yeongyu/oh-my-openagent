#!/usr/bin/env node
// Live QA for #10818: cancelling a task must stop the hosted children ITS session started.
// A parent spawns a hosted child; the child spawns a hosted grandchild that holds a tool call open.
// The parent then cancels the child with task_cancel. The fixed engine cancels the grandchild when
// the child's session shuts down; the bug detaches it instead. To make the difference observable
// the driver releases the grandchild's hold afterwards: a grandchild that survived its cancelled
// parent runs on to "completed", a stopped one stays "cancelled".
//   node task-host-e2e-cancel-cascade.mjs --bin <compiled omo> [--before-bin <compiled base omo>] --out <dir>
import { mkdirSync, rmSync, writeFileSync, existsSync } from "node:fs"
import { join, resolve } from "node:path"

import { observeState, stopParent } from "./task-host-e2e-events.mjs"
import { sandboxProcesses } from "./task-host-e2e-process.mjs"
import { changedRealAgentFiles, createRunRoot, realAgentDigests } from "./task-host-e2e-sandbox.mjs"
import {
  mainProject,
  newSandbox,
  provisionConfig,
  startParent,
  taskRecords,
  teardownSandbox,
} from "./task-host-e2e-shard-cost-support.mjs"
import { shardConfig, writeRoute } from "./task-host-e2e-shards-support.mjs"

const TERMINAL = ["cancelled", "completed", "error", "lost", "interrupted"]

function hold(path, summary) {
  return {
    type: "tool_call",
    name: "eval",
    arguments: {
      language: "js",
      summary,
      timeout: 660,
      code: `var fs = await import("node:fs"); await new Promise((resolve, reject) => {
        var finish = () => { if (!fs.existsSync(${JSON.stringify(path)})) return;
          clearTimeout(timer); watcher.close(); resolve(); };
        var watcher = fs.watch(${JSON.stringify(join(path, ".."))}, finish);
        var timer = setTimeout(() => { watcher.close(); reject(new Error("cancel-cascade release missing")); }, 600000);
        finish();
      });`,
    },
  }
}

function scripts(routes, gates) {
  return {
    parent: {
      parentSteps: [
        { type: "tool_call", name: "task", arguments: {
          category: "proc", run_in_background: true, name: "cc-child",
          prompt: `cc child [[mock-cwd:${routes.child}]]` } },
        hold(gates.cancel, "hold the parent until the grandchild is mid-tool"),
        { type: "tool_call", name: "task_cancel", arguments: { name: "cc-child", reason: "cancel-cascade QA" } },
        hold(gates.parentRelease, "keep the parent alive while the driver observes"),
        { type: "text", text: "cc parent done" },
      ],
      childSteps: [{ type: "text", text: "unused" }],
    },
    child: {
      parentSteps: [],
      childSteps: [
        { type: "tool_call", name: "task", arguments: {
          category: "proc", run_in_background: true, name: "cc-grandchild",
          prompt: `cc grandchild [[mock-cwd:${routes.grandchild}]]` } },
        hold(gates.childHold, "child holds until it is cancelled"),
        { type: "text", text: "cc child done" },
      ],
    },
    grandchild: {
      parentSteps: [],
      childSteps: [
        hold(gates.grandchildHold, "grandchild holds a tool call open"),
        { type: "text", text: "cc grandchild done" },
      ],
    },
  }
}

const byName = (project, name) => taskRecords(project).find((record) => record.name === name)
const view = (record) => record === undefined ? null : {
  status: record.status, residency_state: record.residency_state ?? null, error_message: record.error_message ?? null,
}

async function cancelCascade(config, artifacts, label) {
  const sandbox = newSandbox(config, `cancel-${label}`, {
    omoConfig: shardConfig(),
    script: { parentSteps: [{ type: "text", text: "unused" }], childSteps: [{ type: "text", text: "unused" }] },
  })
  const project = mainProject(sandbox)
  const routes = { child: writeRoute(sandbox, "cc-child", {}), grandchild: writeRoute(sandbox, "cc-grandchild", {}) }
  const gates = {
    cancel: join(sandbox.cwd, "gates", "cancel"), parentRelease: join(sandbox.cwd, "gates", "parent-release"),
    childHold: join(routes.child, "child-hold"), grandchildHold: join(routes.grandchild, "grandchild-hold"),
  }
  mkdirSync(join(sandbox.cwd, "gates"), { recursive: true })
  const plan = scripts(routes, gates)
  writeFileSync(join(sandbox.cwd, "mock-script.json"), `${JSON.stringify(plan.parent, null, 2)}\n`)
  writeFileSync(join(routes.child, "mock-script.json"), `${JSON.stringify(plan.child, null, 2)}\n`)
  writeFileSync(join(routes.grandchild, "mock-script.json"), `${JSON.stringify(plan.grandchild, null, 2)}\n`)
  const parent = startParent(sandbox, project, "spawn a child that spawns a grandchild")
  try {
    const both = await observeState(sandbox.root, () => {
      const child = byName(project, "cc-child")
      const grandchild = byName(project, "cc-grandchild")
      return child?.status === "running" && grandchild?.status === "running"
        && typeof grandchild.host_session?.socket === "string" ? { child, grandchild } : undefined
    }, { timeoutMs: 240_000 })
    if (both === undefined) throw new Error("child and hosted grandchild never both ran")
    writeFileSync(gates.cancel, "go\n")
    const childCancelled = await observeState(sandbox.root, () =>
      byName(project, "cc-child")?.status === "cancelled" ? true : undefined, { timeoutMs: 120_000 })
    const afterCancel = await observeState(sandbox.root, () => {
      const grandchild = byName(project, "cc-grandchild")
      return grandchild !== undefined && TERMINAL.includes(grandchild.status) ? grandchild : undefined
    }, { timeoutMs: 60_000 })
    const atCancel = view(afterCancel ?? byName(project, "cc-grandchild"))
    writeFileSync(gates.grandchildHold, "go\n")
    const settled = await observeState(sandbox.root, () => {
      const grandchild = byName(project, "cc-grandchild")
      return grandchild !== undefined && TERMINAL.includes(grandchild.status) ? grandchild : undefined
    }, { timeoutMs: 120_000 })
    const facts = {
      label,
      child_cancelled: childCancelled === true,
      grandchild_after_parent_cancel: atCancel,
      grandchild_after_release: view(settled ?? byName(project, "cc-grandchild")),
    }
    facts.grandchild_stopped = facts.grandchild_after_parent_cancel?.status === "cancelled"
      && facts.grandchild_after_release?.status === "cancelled"
    writeFileSync(join(artifacts, `cancel-cascade-${label}.json`), `${JSON.stringify(facts, null, 2)}\n`)
    return facts
  } finally {
    for (const gate of [gates.parentRelease, gates.childHold, gates.grandchildHold]) writeFileSync(gate, "go\n")
    await stopParent(parent)
    const cleanup = await teardownSandbox(sandbox, [parent])
    writeFileSync(join(artifacts, `cancel-cascade-${label}-cleanup.json`), `${JSON.stringify(cleanup, null, 2)}\n`)
  }
}

function argValue(argv, flag) {
  const index = argv.indexOf(flag)
  return index === -1 ? undefined : argv[index + 1]
}

async function main(argv) {
  if (process.platform === "win32") return console.log(JSON.stringify({ result: "SKIP", reason: "POSIX host shards only" })), 0
  const bin = argValue(argv, "--bin") ?? process.env.SENPI_BIN
  if (bin === undefined) throw new Error("--bin <compiled omo> is required")
  const beforeBin = argValue(argv, "--before-bin")
  const out = resolve(argValue(argv, "--out") ?? "task-host-e2e-cancel-cascade-out")
  mkdirSync(out, { recursive: true })
  const runRoot = createRunRoot()
  const realBefore = realAgentDigests()
  const results = {}
  try {
    results.fixed = await cancelCascade(provisionConfig("fixed", resolve(bin), runRoot), out, "fixed")
    if (beforeBin !== undefined) {
      results.base = await cancelCascade(provisionConfig("base", resolve(beforeBin), runRoot), out, "base")
    }
  } finally {
    for (const entry of sandboxProcesses({ root: runRoot })) {
      try { process.kill(entry.pid, "SIGKILL") } catch { /* gone */ }
    }
    rmSync(runRoot, { recursive: true, force: true })
  }
  const report = {
    results,
    pass: results.fixed?.grandchild_stopped === true
      && (results.base === undefined || results.base.grandchild_stopped === false),
    run_root_removed: !existsSync(runRoot),
    realSenpiUntouched: changedRealAgentFiles(realBefore, realAgentDigests()).length === 0,
  }
  writeFileSync(join(out, "cancel-cascade.json"), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report))
  return report.pass && report.realSenpiUntouched ? 0 : 2
}

if (import.meta.main ?? process.argv[1]?.endsWith("task-host-e2e-cancel-cascade.mjs")) {
  process.exitCode = await main(process.argv.slice(2))
}
