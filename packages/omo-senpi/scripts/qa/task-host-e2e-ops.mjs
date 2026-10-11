// Operator-surface scenarios for task-host-e2e.mjs (todo 41): F the zombie budget under a bash storm,
// G the `omo daemon` CLI contract plus a real pty attach, H a pre-wave-2 host on the sandbox socket.
import { spawn, spawnSync } from "node:child_process"
import { join } from "node:path"
export { scenarioF } from "./task-host-e2e-storm.mjs"

import { createScenarioSandbox, sandboxEnv } from "./task-host-e2e-sandbox.mjs"
import { generationHostPid, zombieChildCount } from "./task-host-e2e-daemon-state.mjs"
import {
  cleanupScenario,
  daemonStatus,
  lastJsonLine,
  perChildRpcProcesses,
  pidAlive,
  readTaskRecords,
  runBin,
  socketInode,
  spawnParent,
  waitFor,
} from "./task-host-e2e-process.mjs"
import {
  CHILD_DONE,
  childSessionFiles,
  childStartDiagnosis,
  childrenSettled,
  hostConfig,
  jsonlLines,
  spawnScript,
} from "./task-host-e2e-support.mjs"

function tmuxAttach(sandbox, run, session) {
  const command = [sandbox.bin, "daemon", "attach", "-e", run.mockEntry, "--provider", "omo-mock", "--model", "mock-1"]
    .map((part) => `'${part}'`)
    .join(" ")
  return spawnSync("tmux", ["new-session", "-d", "-s", session, "-x", "200", "-y", "50", command], {
    env: sandboxEnv(sandbox),
    cwd: sandbox.cwd,
    encoding: "utf8",
    timeout: 60_000,
  })
}

export async function scenarioG(run) {
  const sandbox = createScenarioSandbox(run, "sG", {
    omoConfig: hostConfig(),
    script: {
      parentSteps: [{ type: "text", text: "unused in the pty lane" }],
      childSteps: [
        { type: "tool_call", name: "task", arguments: { category: "proc", run_in_background: true, name: "tui", prompt: "work from the attached tui" } },
        { type: "text", text: "tui turn complete" },
      ],
    },
  })
  const exits = {
    statusBeforeRun: runBin(sandbox, ["daemon", "status", "--json"], { timeoutMs: 60_000 }).status,
    noSubcommand: runBin(sandbox, ["daemon"], { timeoutMs: 60_000 }).status,
    unknownSubcommand: runBin(sandbox, ["daemon", "frobnicate"], { timeoutMs: 60_000 }).status,
  }
  const started = runBin(sandbox, ["daemon", "run", "--json"], { timeoutMs: 120_000 })
  exits.run = started.status
  const startedJson = lastJsonLine(started.stdout)
  const reused = runBin(sandbox, ["daemon", "run", "--json"], { timeoutMs: 120_000 })
  exits.runAgain = reused.status
  const handoff = runBin(sandbox, ["daemon", "handoff", "--json"], { timeoutMs: 120_000 })
  exits.handoff = handoff.status
  const baseSessions = daemonStatus(sandbox).json?.sessions?.total ?? 0
  const session = `dh41-${process.pid}`
  const tmux = tmuxAttach(sandbox, run, session)
  const attached = await waitFor(() => {
    const total = daemonStatus(sandbox).json?.sessions?.total ?? 0
    return total > baseSessions ? total : undefined
  }, { timeoutMs: 120_000, intervalMs: 1_000 })
  if (attached !== undefined) {
    spawnSync("tmux", ["send-keys", "-t", session, "drive the task tool from the tui", "Enter"], { encoding: "utf8" })
  }
  const taskRan = await waitFor(() => (readTaskRecords(sandbox).some((record) => record.name === "tui") ? true : undefined), {
    timeoutMs: 120_000,
    intervalMs: 1_000,
  })
  const pane = spawnSync("tmux", ["capture-pane", "-p", "-t", session], { encoding: "utf8" })
  spawnSync("tmux", ["kill-session", "-t", session], { encoding: "utf8" })
  const drained = runBin(sandbox, ["daemon", "stop", "--drain"], { timeoutMs: 120_000 })
  exits.stopDrain = drained.status
  exits.statusAfterStop = runBin(sandbox, ["daemon", "status", "--json"], { timeoutMs: 60_000 }).status
  const facts = {
    exitCodes: exits,
    runAction: startedJson?.action ?? null,
    reuseAction: lastJsonLine(reused.stdout)?.action ?? null,
    handoffAction: lastJsonLine(handoff.stdout)?.action ?? null,
    tmuxLaunchExit: tmux.status,
    sessionsBeforeAttach: baseSessions,
    sessionsWithTui: attached ?? null,
    taskToolRanInsideTui: taskRan === true,
    tuiTaskRecords: readTaskRecords(sandbox).filter((record) => record.name === "tui").map((record) => record.status),
    paneExcerpt: (pane.stdout ?? "").split("\n").filter((line) => line.trim().length > 0).slice(-6),
  }
  const pass =
    exits.statusBeforeRun === 3 && exits.noSubcommand === 2 && exits.unknownSubcommand === 2 && exits.run === 0 &&
    exits.runAgain === 0 && exits.stopDrain === 0 && exits.statusAfterStop === 3 &&
    startedJson?.action === "start" && facts.reuseAction === "reuse" && attached === baseSessions + 1 && taskRan === true
  const receipt = await cleanupScenario(sandbox, { hostPids: [startedJson?.pid].filter(Boolean) })
  return {
    scenario: "G",
    title: "CLI: daemon run/status/stop/handoff exit codes + pty attach",
    status: pass ? "pass" : "fail",
    ...(pass ? {} : { reason: `exits=${JSON.stringify(exits)} runAction=${facts.runAction} reuse=${facts.reuseAction} sessions=${baseSessions}->${attached} taskRan=${taskRan === true}` }),
    facts,
    receipt,
  }
}

function distinctHostWarnings(stdout) {
  const found = new Set()
  for (const line of stdout.split("\n")) {
    for (const match of line.matchAll(/host_unavailable:[a-z_]+/g)) found.add(match[0])
  }
  return [...found]
}

export async function scenarioH(run) {
  if (run.legacyBin === undefined) {
    return {
      scenario: "H",
      title: "legacy/fallback: a pre-wave-2 host on the sandbox socket",
      status: "skipped",
      reason: "needs a pre-wave-2 omo/senpi binary to serve the sandbox socket",
      command: "node packages/omo-senpi/scripts/qa/task-host-e2e.mjs --bin <omob-daemon> --legacy-bin <mainline omob> --out <dir>",
    }
  }
  // `process` is pinned rather than left to `auto`: the plan's fallback is the RpcHostRunner's own loud
  // delegation to the per-child runner, while `auto` against a capability-short host resolves to
  // in-process before a child runner is ever chosen. `task_output` is what carries the notice.
  const sandbox = createScenarioSandbox(run, "sH", {
    omoConfig: hostConfig({ task: { default_execution_mode: "process" } }),
    script: {
      parentSteps: [
        { type: "tool_call", name: "task", arguments: { category: "proc", run_in_background: true, name: "lg0", prompt: "work against the legacy host" } },
        { type: "tool_call", name: "task_output", arguments: { name: "lg0", mode: "status" } },
        { type: "tool_call", name: "task_output", arguments: { name: "lg0", mode: "full" } },
        { type: "text", text: "legacy fallback scenario complete" },
      ],
      childSteps: CHILD_DONE,
    },
  })
  const socket = join(sandbox.agentDir, "rpc", "rpc.sock")
  const legacy = spawn(run.legacyBin, ["--mode", "rpc", "--multi-session", "--listen", `unix://${socket}`], {
    cwd: sandbox.cwd,
    env: sandboxEnv(sandbox),
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
  })
  const up = await waitFor(() => (socketInode(socket) === undefined ? undefined : socketInode(socket)), { timeoutMs: 60_000, intervalMs: 500 })
  const statusJson = daemonStatus(sandbox, { includeWorkers: true })
  const statusPlain = runBin(sandbox, ["daemon", "status"], { timeoutMs: 60_000 })
  const parent = runBin(sandbox, run.parentArgs(sandbox, "run one child against the legacy host"), { timeoutMs: 240_000 })
  const warnings = distinctHostWarnings(parent.stdout)
  const records = readTaskRecords(sandbox)
  const perChild = perChildRpcProcesses(sandbox)
  const capabilities = statusJson.json?.capabilities ?? []
  const facts = {
    legacyPid: legacy.pid,
    legacyAlive: pidAlive(legacy.pid),
    socketInodeBefore: up ?? null,
    socketInodeAfter: socketInode(socket) ?? null,
    statusExit: statusJson.exitCode,
    statusCapabilities: capabilities,
    legacyHostReported: !capabilities.includes("session_context") && !capabilities.includes("session_kind"),
    statusSummary: statusPlain.stdout.trim(),
    parentExit: parent.status,
    hostWarnings: warnings,
    childStatuses: records.map((record) => record.status),
    childExecutionModes: [...new Set(records.map((record) => record.execution_mode))],
    perChildRpcProcessesSeen: perChild.length,
  }
  const pass =
    facts.legacyAlive && facts.socketInodeBefore === facts.socketInodeAfter && facts.legacyHostReported &&
    warnings.length === 1 && warnings[0] === "host_unavailable:capability" &&
    records.length > 0 && records.every((record) => record.status === "completed") &&
    facts.childExecutionModes.join() === "process"
  // Subscribed BEFORE the signal and awaited with a bound: a killed-but-unreaped child still answers
  // `kill(pid, 0)`, so a receipt taken before the reap would report a zombie as a survivor.
  const legacyExit = new Promise((resolve) => legacy.once("exit", () => resolve(true)))
  try {
    process.kill(legacy.pid, "SIGKILL")
  } catch {
    // already gone
  }
  await Promise.race([legacyExit, new Promise((resolve) => setTimeout(() => resolve(false), 15_000))])
  const receipt = await cleanupScenario(sandbox, { hostPids: [legacy.pid] })
  return {
    scenario: "H",
    title: "legacy/fallback: a pre-wave-2 host on the sandbox socket",
    status: pass ? "pass" : "fail",
    ...(pass ? {} : { reason: `legacyAlive=${facts.legacyAlive} inode ${facts.socketInodeBefore}->${facts.socketInodeAfter} warnings=${warnings.join(",")} children=${facts.childStatuses.join(",")}` }),
    facts,
    receipt,
  }
}
