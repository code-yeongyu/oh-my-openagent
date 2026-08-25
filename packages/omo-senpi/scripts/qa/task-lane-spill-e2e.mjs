#!/usr/bin/env node
// allow: SIZE_OK - one live lane-admission QA driver keeps both scenarios, isolation accounting, and
// the cleanup receipt in one executable, exactly as the sibling task/lsp/ast-grep drivers do.
// Live driver for spawn-time lane spill (S1) and the global permit cap (S2).
//
// Both scenarios need a child that is provably still occupying its lane when the next task is
// admitted, so the lane-private mock provider parks children on a release file the driver controls.
// That makes the admission decision - spill to the fallback lane, or queue as pending - observable
// in the real task records instead of inferred from timing.
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { createSandbox, seedSandbox } from "./drive.mjs"
import { changedRealPaths, classifyRealSenpiChanges, parseJsonEvents, snapshotDir } from "./task-e2e-analysis.mjs"
import { isAlive, killTree } from "./task-e2e-process.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const providerEntry = join(scriptDir, "task-lane-spill-mock-provider.ts")
// BOTH real agent-dir layouts are watched. This machine's omo distribution keeps engine state in
// ~/.omo/agent, so snapshotting only ~/.senpi/agent would report "untouched" for a run that in fact
// wrote all over the developer's real agent dir - a false clean bill of health.
const realAgentDirs = [join(homedir(), ".senpi", "agent"), join(homedir(), ".omo", "agent")]

// Snapshots stay PER DIRECTORY so changedRealPaths keeps seeing plain relative paths: its
// shared-diagnostic filter matches on "logs/..." and friends, which a combined prefixed key would
// defeat and turn every concurrent debug-log write into a false pollution report.
function snapshotRealAgentDirs() {
  return realAgentDirs.map((dir) => ({ dir, snapshot: snapshotDir(dir) }))
}

// Classification also runs PER DIRECTORY on relative paths, because classifyRealSenpiChanges keys
// its concurrent-session rule on a leading "sessions/": handing it absolute paths silently disables
// that rule and blames this run for a host session it never touched. Absolute paths are restored
// only afterwards, for the report.
// The omo-branded twin of senpi-debug.log. task-e2e-analysis's shared-diagnostic set only knows the
// senpi-* names, but this file is the same thing: a machine-global append-only journal every
// concurrent omo process on the host writes (17MB and growing during any live TUI session), so it
// can no more identify QA pollution than senpi-debug.log can.
const SHARED_OMO_DIAGNOSTICS = new Set([
  "omo-debug.log",
  "omo-crash.log",
  "OmO-debug.log",
  "OmO-crash.log",
])

function classifyRealAgentChanges(before, after, sandboxTokens) {
  const qaAttributedPaths = []
  const concurrentSessionPaths = []
  const allChangedPaths = []
  for (const [index, entry] of after.entries()) {
    const previous = before[index]?.snapshot ?? new Map()
    const changed = changedRealPaths(previous, entry.snapshot).filter((rel) => !SHARED_OMO_DIAGNOSTICS.has(rel))
    for (const rel of changed) allChangedPaths.push(join(entry.dir, rel))
    const classified = classifyRealSenpiChanges(changed, sandboxTokens)
    for (const rel of classified.qaAttributedPaths) qaAttributedPaths.push(join(entry.dir, rel))
    for (const rel of classified.concurrentSessionPaths) concurrentSessionPaths.push(join(entry.dir, rel))
  }
  return { qaAttributedPaths, concurrentSessionPaths, allChangedPaths }
}

const PRIMARY = "vendor-a/primary"
const FALLBACK = "vendor-b/fallback"
const LANE_C = "vendor-c/third"

// S1: the primary lane holds exactly one child, and the test category's 2-entry models chain gives
// the second task somewhere to spill to. Task 2 must RUN on the fallback, never sit pending.
const SPILL = {
  name: "s1-spill",
  omoConfig: {
    task: { model_concurrency: { [PRIMARY]: 1 }, global_concurrency: 0, max_depth: 1 },
    categories: { lanecat: { description: "Lane spill test category.", models: [PRIMARY, FALLBACK] } },
  },
  script: {
    models: [PRIMARY, FALLBACK],
    parkModels: [PRIMARY, FALLBACK],
    parentSteps: [
      {
        type: "tool_call",
        name: "task",
        arguments: {
          category: "lanecat",
          tasks: [
            { prompt: "hold the primary lane", name: "lane-one" },
            { prompt: "must spill to the fallback lane", name: "lane-two" },
          ],
          run_in_background: true,
        },
      },
      { type: "text", text: "spawned both lane tasks" },
    ],
  },
  // Task 1 takes the primary lane; task 2 must be admitted to the fallback lane and be running.
  check: (items) => {
    const [one, two] = items
    return {
      two_tasks_spawned: items.length === 2 ? "PASS" : "FAIL",
      first_on_primary: laneOf(one?.resolved_model) === PRIMARY ? "PASS" : "FAIL",
      first_running: one?.status === "running" ? "PASS" : "FAIL",
      // The behavior under test: a full primary lane spills instead of queueing.
      second_spilled_to_fallback: laneOf(two?.resolved_model) === FALLBACK ? "PASS" : "FAIL",
      second_running_not_pending: two?.status === "running" ? "PASS" : "FAIL",
      second_not_queued: two?.queue_position === undefined ? "PASS" : "FAIL",
    }
  },
}

// S2: three distinct single-model lanes, each locally free, under a global cap of 2. The third must
// be pending purely because the global permit pool is exhausted.
const GLOBAL_CAP = {
  name: "s2-global-cap",
  omoConfig: {
    task: {
      global_concurrency: 2,
      model_concurrency: { [PRIMARY]: 1, [FALLBACK]: 1, [LANE_C]: 1 },
      max_depth: 1,
    },
    categories: {
      lane1: { description: "Lane one.", models: [PRIMARY] },
      lane2: { description: "Lane two.", models: [FALLBACK] },
      lane3: { description: "Lane three.", models: [LANE_C] },
    },
  },
  script: {
    models: [PRIMARY, FALLBACK, LANE_C],
    parkModels: [PRIMARY, FALLBACK, LANE_C],
    parentSteps: [
      {
        type: "tool_call",
        name: "task",
        arguments: {
          tasks: [
            { category: "lane1", prompt: "occupy lane one", name: "cap-one" },
            { category: "lane2", prompt: "occupy lane two", name: "cap-two" },
            { category: "lane3", prompt: "must wait for a global permit", name: "cap-three" },
          ],
          run_in_background: true,
        },
      },
      { type: "text", text: "spawned three capped tasks" },
    ],
  },
  check: (items) => {
    const [one, two, three] = items
    return {
      three_tasks_spawned: items.length === 3 ? "PASS" : "FAIL",
      first_running: one?.status === "running" ? "PASS" : "FAIL",
      second_running: two?.status === "running" ? "PASS" : "FAIL",
      distinct_lanes: new Set([one, two, three].map((item) => laneOf(item?.resolved_model))).size === 3 ? "PASS" : "FAIL",
      // The behavior under test: a locally free third lane still waits on the global pool.
      third_pending: three?.status === "pending" ? "PASS" : "FAIL",
      third_queued: typeof three?.queue_position === "number" ? "PASS" : "FAIL",
    }
  },
}

// createSandbox() nests cwd and agent under ONE root, which is exactly the layout senpi's
// config-watch rejects (see runScenario). This keeps the same sandbox contract - same fields, same
// tmp prefix so isolation accounting still attributes by token - but puts the project tree and the
// agent/home tree on sibling branches.
function splitSandbox() {
  const base = createSandbox()
  const cwd = join(base.root, "w", "project")
  const agentRoot = join(base.root, "a")
  const agentDir = join(agentRoot, "agent")
  const homeDir = join(agentRoot, "home")
  const xdgConfigHome = join(agentRoot, "xdg")
  mkdirSync(cwd, { recursive: true })
  mkdirSync(agentDir, { recursive: true })
  return { root: base.root, cwd, canonicalCwd: cwd, agentDir, agentRoot, homeDir, xdgConfigHome }
}

// resolved_model.display is not a stable lane identity: the primary comes back as a bare model id
// ("primary") while a spilled fallback carries the qualified form ("vendor-b/fallback"). provider +
// model_id always reconstructs the lane the task actually landed on.
function laneOf(resolved) {
  if (resolved === undefined || resolved === null) return undefined
  const { provider, model_id: modelId, display } = resolved
  if (typeof provider === "string" && typeof modelId === "string") return `${provider}/${modelId}`
  return display
}

function readTaskRecords(stateDir) {
  const tasksDir = join(stateDir, "tasks")
  if (!existsSync(tasksDir)) return []
  return readdirSync(tasksDir)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(tasksDir, name), "utf8")))
    .sort((left, right) => String(left.task_id).localeCompare(String(right.task_id)))
}

function readTaskLogs(stateDir, records) {
  const logs = {}
  for (const record of records) {
    const path = join(stateDir, "logs", `${record.task_id}.jsonl`)
    if (existsSync(path)) logs[record.task_id] = readFileSync(path, "utf8")
  }
  return logs
}

// The spawn batch's own tool result carries the admission decision per item (model + status +
// queue_position), which is exactly what both scenarios assert.
function findSpawnItems(events) {
  for (const event of events) {
    const items = event?.result?.details?.items ?? event?.details?.items
    if (Array.isArray(items) && items.length > 0) return items
  }
  return []
}

// Releasing every parked child lets the run finish on its own; without it the children only unpark
// at their own timeout, which would make the driver slow and its timing meaningful.
function releaseAll(releaseDir, providers) {
  mkdirSync(releaseDir, { recursive: true })
  for (const provider of providers) writeFileSync(join(releaseDir, `${provider}.release`), "release\n")
}

function runScenario(scenario, senpiBin, outDir, pids, helpers) {
  const scenarioOut = join(outDir, scenario.name)
  mkdirSync(scenarioOut, { recursive: true })
  // Split layout, and it has to be this way. senpi's config-watch resolves ancestor targets from the
  // project cwd; if the agent dir sits under a shared ancestor of that cwd, every target covers the
  // agent dir's protected paths, the host rejects the registration outright, and the project config
  // never loads (categories come back empty). Keeping the agent/home tree on a sibling branch from
  // the project tree is what makes the fixture's categories actually reach the engine.
  const sandbox = splitSandbox()
  seedSandbox(sandbox)
  const sessionDir = join(sandbox.agentRoot, "sessions")
  const observeDir = join(sandbox.agentRoot, "observe")
  const releaseDir = join(sandbox.agentRoot, "release")
  const homeDir = sandbox.homeDir
  for (const dir of [sessionDir, observeDir, releaseDir, homeDir]) mkdirSync(dir, { recursive: true })
  // The user config scope resolves from HOME (~/.omo), NOT from XDG_CONFIG_HOME, so without an
  // isolated HOME the developer's real ~/.omo categories merge into the fixture and the scenario
  // stops being reproducible. The empty user config keeps that scope present but contributing nothing.
  mkdirSync(join(homeDir, ".omo"), { recursive: true })
  writeFileSync(join(homeDir, ".omo", "omo.jsonc"), "{}\n")
  const omoDir = join(sandbox.cwd, ".omo")
  mkdirSync(omoDir, { recursive: true })
  writeFileSync(join(omoDir, "omo.json"), `${JSON.stringify(scenario.omoConfig, null, 2)}\n`)
  writeFileSync(join(sandbox.cwd, "lane-script.json"), `${JSON.stringify(scenario.script, null, 2)}\n`)
  // The parent itself must never park, so it runs on a lane the scenario does not gate.
  const providers = [...new Set(scenario.script.models.map((model) => model.split("/")[0]))]

  // The children park until released, so the release must happen WHILE senpi is still running.
  // The watcher runs concurrently and keys off the task records the engine actually wrote, so the
  // release is triggered by observed state rather than by a wall-clock guess.
  const stateDir = join(sandbox.cwd, ".omo", "senpi-task")
  const expectedTasks = scenario.script.parentSteps[0]?.arguments?.tasks?.length ?? 1
  // Attached and NOT unref'd on purpose: a detached+unref'd helper is never wait()ed on, so it
  // lingers as an unreaped zombie and `kill(pid, 0)` keeps reporting it alive, which would make the
  // cleanup receipt claim a leak that does not exist. Staying attached lets Node reap it; the
  // driver blocks on senpi below, which outlives this watcher anyway.
  const releaser = spawn(
    process.execPath,
    ["-e", releaseWatcherSource(stateDir, releaseDir, providers, expectedTasks)],
    { stdio: "ignore" },
  )
  // Driver-owned helper, not a task child: tracked separately so the leak check speaks only to the
  // senpi processes under test. The child OBJECT is kept rather than a bare pid because its
  // exitCode/signalCode is authoritative - a pid probe races Node's reaping and reports a
  // long-exited helper as alive.
  helpers.push(releaser)

  const run = spawnSync(
    senpiBin,
    [
      "-e", providerEntry,
      "-p", "--mode", "json",
      "--provider", providers[0],
      "--model", scenario.script.models[0].split("/")[1],
      "--session-dir", sessionDir,
      "drive the lane scenario",
    ],
    {
      cwd: sandbox.cwd,
      env: {
        ...process.env,
        HOME: homeDir,
        // resolveAgentHome() reads OMO_CODING_AGENT_DIR, then SENPI_CODING_AGENT_DIR, then
        // PI_CODING_AGENT_DIR, and the FIRST one wins. An omo session exports OMO_CODING_AGENT_DIR
        // pointing at the real ~/.omo/agent, so overriding only SENPI_CODING_AGENT_DIR silently
        // leaves the run attached to the developer's real agent dir - the isolation this QA depends
        // on. Every name in that precedence list is pinned to the sandbox.
        OMO_CODING_AGENT_DIR: sandbox.agentDir,
        PI_CODING_AGENT_DIR: sandbox.agentDir,
        SENPI_CODING_AGENT_DIR: sandbox.agentDir,
        XDG_CONFIG_HOME: sandbox.xdgConfigHome,
        SENPI_CODING_AGENT_SESSION_DIR: sessionDir,
        OMO_SENPI_QA: "1",
        LANE_OBSERVE_DIR: observeDir,
        LANE_RELEASE_DIR: releaseDir,
      },
      encoding: "utf8",
      timeout: 180_000,
      maxBuffer: 64 * 1024 * 1024,
    },
  )
  if (typeof run.pid === "number") pids.push(run.pid)

  const events = parseJsonEvents(run.stdout ?? "")
  const items = findSpawnItems(events)
  const records = readTaskRecords(stateDir)
  const logs = readTaskLogs(stateDir, records)
  const arrivalsPath = join(observeDir, "arrivals.log")
  const arrivals = existsSync(arrivalsPath) ? readFileSync(arrivalsPath, "utf8") : ""

  const checks = { ...scenario.check(items) }
  const result = Object.values(checks).every((verdict) => verdict === "PASS") ? "PASS" : "FAIL"
  const verdict = {
    result,
    scenario: scenario.name,
    checks,
    exit: run.status,
    signal: run.signal ?? null,
    spawnItems: items,
    taskRecords: records.map((record) => ({
      task_id: record.task_id,
      name: record.name,
      status: record.status,
      model: record.model,
      requested_model: record.requested_model?.display,
      resolved_model: record.resolved_model?.display,
      fallback_models: record.fallback_models?.map((model) => model.display),
    })),
    sandboxRoot: sandbox.root,
    sandboxAgentDir: sandbox.agentDir,
  }
  writeFileSync(join(scenarioOut, "verdict.json"), `${JSON.stringify(verdict, null, 2)}\n`)
  writeFileSync(join(scenarioOut, "stdout.json.log"), run.stdout ?? "")
  writeFileSync(join(scenarioOut, "stderr.log"), run.stderr ?? "")
  writeFileSync(join(scenarioOut, "omo.json"), `${JSON.stringify(scenario.omoConfig, null, 2)}\n`)
  writeFileSync(join(scenarioOut, "task-records.json"), `${JSON.stringify(records, null, 2)}\n`)
  writeFileSync(join(scenarioOut, "arrivals.log"), arrivals)
  for (const [taskId, log] of Object.entries(logs)) {
    writeFileSync(join(scenarioOut, `${taskId}.jsonl.log`), log)
  }
  return { verdict, sandbox }
}

// Inline watcher: waits until EVERY expected task record exists - i.e. until all admission
// decisions have already been made - and only then drops the release files. Releasing earlier
// would free the primary lane before the later task is admitted and destroy the contention the
// scenarios exist to observe. It keys off real state, never a fixed delay.
function releaseWatcherSource(stateDir, releaseDir, providers, expected) {
  return `
const { existsSync, mkdirSync, readdirSync, writeFileSync } = require("node:fs")
const { join } = require("node:path")
const stateDir = ${JSON.stringify(stateDir)}
const releaseDir = ${JSON.stringify(releaseDir)}
const providers = ${JSON.stringify(providers)}
const deadline = Date.now() + 120000
function tasksSeen() {
  const dir = join(stateDir, "tasks")
  if (!existsSync(dir)) return 0
  return readdirSync(dir).filter((name) => name.endsWith(".json")).length
}
function release() {
  mkdirSync(releaseDir, { recursive: true })
  for (const provider of providers) writeFileSync(join(releaseDir, provider + ".release"), "release\\n")
}
function poll() {
  if (tasksSeen() >= ${expected} || Date.now() > deadline) { release(); return }
  setTimeout(poll, 50)
}
poll()
`
}

// Resolves once the helper has really exited. spawnSync() for senpi blocks the event loop for the
// whole run, so the helper's 'exit' event is still queued when the driver reaches cleanup; awaiting
// it here is what makes exitCode authoritative instead of racy.
function awaitHelperExit(helper) {
  if (helper.exitCode !== null || helper.signalCode !== null) return Promise.resolve()
  return new Promise((settle) => {
    helper.once("exit", () => settle())
    helper.once("error", () => settle())
  })
}

async function main() {
  const outDir = resolve(process.env.LANE_SPILL_OUT_DIR ?? join(process.cwd(), ".omo", "evidence", "task-lane-spill"))
  mkdirSync(outDir, { recursive: true })
  const senpiBin = (process.env.SENPI_BIN ?? "").trim() || "senpi"
  const beforeSnapshot = snapshotRealAgentDirs()
  const providedAgentDir = process.env.SENPI_CODING_AGENT_DIR ? "IGNORED" : "unset"

  const probe = spawnSync(senpiBin, ["--version"], { encoding: "utf8", timeout: 30_000 })
  if (probe.error !== undefined) {
    const skip = { result: "SKIP", reason: "senpi-binary-unavailable", providedAgentDir }
    writeFileSync(join(outDir, "verdict.json"), `${JSON.stringify(skip, null, 2)}\n`)
    console.log(JSON.stringify(skip))
    return
  }

  const pids = []
  const helpers = []
  const sandboxes = []
  const verdicts = []
  try {
    for (const scenario of [SPILL, GLOBAL_CAP]) {
      const outcome = runScenario(scenario, senpiBin, outDir, pids, helpers)
      verdicts.push(outcome.verdict)
      sandboxes.push(outcome.sandbox)
    }
  } finally {
    for (const helper of helpers) if (helper.exitCode === null && helper.signalCode === null) helper.kill("SIGKILL")
    await Promise.all(helpers.map(awaitHelperExit))
    for (const pid of pids) if (isAlive(pid)) killTree(pid)
  }

  const leakedPids = pids.filter(isAlive)
  const sandboxTokens = sandboxes.map((sandbox) => basename(sandbox.root))
  const { qaAttributedPaths, concurrentSessionPaths, allChangedPaths: allChanged } =
    classifyRealAgentChanges(beforeSnapshot, snapshotRealAgentDirs(), sandboxTokens)
  const realSenpiUntouched = qaAttributedPaths.length === 0

  // Cleanup is part of the contract: every task-owned sandbox goes, and the receipt records it.
  const removed = []
  for (const sandbox of sandboxes) {
    rmSync(sandbox.root, { recursive: true, force: true })
    removed.push({ root: sandbox.root, removed: !existsSync(sandbox.root) })
  }
  const cleanup = {
    sandboxesRemoved: removed,
    allSandboxesRemoved: removed.every((entry) => entry.removed),
    spawnedPids: pids,
    helperPids: helpers.map((helper) => helper.pid),
    leakedPids,
    liveHelpers: helpers
      .filter((helper) => helper.exitCode === null && helper.signalCode === null)
      .map((helper) => helper.pid),
    childPidsTerminal:
      leakedPids.length === 0 &&
      helpers.every((helper) => helper.exitCode !== null || helper.signalCode !== null),
  }

  const checks = {
    ...Object.fromEntries(verdicts.map((verdict) => [verdict.scenario, verdict.result])),
    real_senpi_untouched: realSenpiUntouched ? "PASS" : "FAIL",
    no_leaked_pids: leakedPids.length === 0 ? "PASS" : "FAIL",
    sandboxes_removed: cleanup.allSandboxesRemoved ? "PASS" : "FAIL",
    // Gated, not merely reported: the cleanup receipt must not be able to claim a terminal child
    // set while a process is still around.
    child_pids_terminal: cleanup.childPidsTerminal ? "PASS" : "FAIL",
  }
  const result = Object.values(checks).every((verdict) => verdict === "PASS") ? "PASS" : "FAIL"
  const payload = {
    result,
    checks,
    scenarios: verdicts,
    realSenpiUntouched,
    realSenpiChangedPaths: qaAttributedPaths,
    concurrentRealSenpiChangedPaths: concurrentSessionPaths,
    allRealSenpiChangedPaths: allChanged,
    providedAgentDir,
    sandboxAgentDirs: sandboxes.map((sandbox) => sandbox.agentDir),
    sandboxTokens,
    cleanup,
  }
  writeFileSync(join(outDir, "verdict.json"), `${JSON.stringify(payload, null, 2)}\n`)
  writeFileSync(join(outDir, "cleanup-receipt.json"), `${JSON.stringify(cleanup, null, 2)}\n`)
  console.log(JSON.stringify(payload))
  if (result !== "PASS") process.exitCode = 1
}

// Mirrors the real live payload, including the primary's bare `display` ("primary"), so the
// fixtures cannot pass under an assertion that the live shape would fail.
function resolvedFixture(lane, { bareDisplay = false } = {}) {
  const [provider, modelId] = lane.split("/")
  return { source: "category", provider, model_id: modelId, display: bareDisplay ? modelId : lane }
}

function selfTest() {
  const spillItems = [
    { name: "lane-one", status: "running", resolved_model: resolvedFixture(PRIMARY, { bareDisplay: true }) },
    { name: "lane-two", status: "running", resolved_model: resolvedFixture(FALLBACK) },
  ]
  const spilled = SPILL.check(spillItems)
  if (Object.values(spilled).some((verdict) => verdict !== "PASS")) {
    throw new Error(`self-test: a clean spill must pass, got ${JSON.stringify(spilled)}`)
  }
  const queuedInstead = SPILL.check([
    spillItems[0],
    { name: "lane-two", status: "pending", queue_position: 1, resolved_model: resolvedFixture(PRIMARY) },
  ])
  if (queuedInstead.second_spilled_to_fallback !== "FAIL" || queuedInstead.second_running_not_pending !== "FAIL") {
    throw new Error("self-test: a task that queued on the primary instead of spilling must fail")
  }

  const capItems = [
    { status: "running", resolved_model: resolvedFixture(PRIMARY, { bareDisplay: true }) },
    { status: "running", resolved_model: resolvedFixture(FALLBACK, { bareDisplay: true }) },
    { status: "pending", queue_position: 1, resolved_model: resolvedFixture(LANE_C, { bareDisplay: true }) },
  ]
  const capped = GLOBAL_CAP.check(capItems)
  if (Object.values(capped).some((verdict) => verdict !== "PASS")) {
    throw new Error(`self-test: a clean global cap must pass, got ${JSON.stringify(capped)}`)
  }
  const thirdRan = GLOBAL_CAP.check([capItems[0], capItems[1], { status: "running", resolved_model: resolvedFixture(LANE_C) }])
  if (thirdRan.third_pending !== "FAIL" || thirdRan.third_queued !== "FAIL") {
    throw new Error("self-test: a third task that ran past the global cap must fail")
  }

  const items = findSpawnItems(parseJsonEvents(JSON.stringify({
    type: "tool_execution_end",
    toolName: "task",
    result: { details: { items: [{ task_id: "st_1" }, { task_id: "st_2" }] } },
  })))
  if (items.length !== 2) throw new Error("self-test: spawn items must be extracted from the batch result")
  console.log("SELF-TEST OK")
}

if (process.argv.includes("--self-test")) selfTest()
else await main()
