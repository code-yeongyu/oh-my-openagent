// `--self-test` for task-host-e2e.mjs (todo 41): proves the harness's own decisions WITHOUT a binary -
// the sandbox's env scrubbing, the process-table scoping that must never count a foreign session's host,
// the JSON line reader, the fixtures, and the shape every scenario result and skip must have.
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs"
import { join } from "node:path"

import { AGENT_DIR_ENV_NAMES, DELETED_CHILD_ENV, credentialDigest, sandboxEnv } from "./task-host-e2e-sandbox.mjs"
import { lastJsonLine, perChildRpcProcesses, sandboxProcesses } from "./task-host-e2e-process.mjs"
import { CHILD_BUSY, childSessionFiles, childStartDiagnosis, failureTokens, hostConfig, jsonlLines, spawnScript } from "./task-host-e2e-support.mjs"
import { scenarioD, scenarioE4, scenarioH2, scenarioHandoffSuite } from "./task-host-e2e-gated.mjs"
import { singleParentPass, resumePass, teamPass, reopenPass, stormPass } from "./task-host-e2e-gates.mjs"
import { observeState } from "./task-host-e2e-events.mjs"
import { completedStormCalls } from "./task-host-e2e-storm.mjs"
import { terminalChildSnapshots } from "./task-host-e2e-stranded.mjs"
import { checkMockSessionIsolation } from "./task-host-e2e-mock-selftest.mjs"
import { checkResumeReadbacks } from "./task-host-e2e-resume-selftest.mjs"

function assert(condition, message) {
  if (!condition) throw new Error(`self-test: ${message}`)
}

export async function runSelfTest(scriptDir) {
  const root = mkdtempSync("/tmp/dh41st.")
  try {
    checkSandboxEnv(root)
    checkProcessScoping()
    checkFixtures()
    checkReaders(root)
    checkGates()
    checkProductGates()
    checkTerminalStoreMismatch(root)
    await checkStateEvents(root)
    checkStormReceipts()
    await checkMockSessionIsolation(root)
    await checkResumeReadbacks(root)
    checkDriverSource(scriptDir)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

function checkTerminalStoreMismatch(root) {
  const sandbox = { stateDir: join(root, "stranded") }
  mkdirSync(join(sandbox.stateDir, "tasks"), { recursive: true })
  const sessionPath = join(sandbox.stateDir, "child.jsonl")
  writeFileSync(sessionPath, JSON.stringify({
    type: "message", timestamp: "2026-09-20T00:00:00Z",
    message: { role: "assistant", stopReason: "aborted", content: [] },
  }) + "\n")
  writeFileSync(join(sandbox.stateDir, "tasks", "st_aborted.json"), JSON.stringify({
    task_id: "st_aborted", status: "running", host_session: { session_path: sessionPath },
  }))
  const captured = terminalChildSnapshots(sandbox)
  assert(captured.length === 1 && captured[0].taskId === "st_aborted" &&
    captured[0].storeStatus === "running" && captured[0].storeStableDuringRead,
    "a terminal aborted turn must remain visible even when its store says running")
}

async function checkStateEvents(root) {
  const path = join(root, "ready")
  const value = await observeState(root, () => {
    try { return readFileSync(path, "utf8") === "ready" ? "observed" : undefined } catch { return undefined }
  }, { trigger: () => writeFileSync(path, "ready"), timeoutMs: 1_000 })
  assert(value === "observed", "state subscription must see a synchronous trigger without sleeping")
  assert(await observeState(root, () => undefined, { timeoutMs: 0 }) === undefined,
    "missing state must time out, never count as readiness")
}

function checkStormReceipts() {
  const row = (role, isError, text) => JSON.stringify({
    message: { role, toolName: "eval", isError, content: [{ type: "text", text }] },
  })
  const success = row("toolResult", false, "STORM_OK:3")
  assert(completedStormCalls([success, success]) === 1, "duplicate receipts cannot inflate the spawn budget")
  assert(completedStormCalls([row("assistant", false, "STORM_OK:4"), row("toolResult", true, "STORM_OK:4")]) === 0,
    "a prompt or failed eval is not a successful process spawn")
}

function checkProductGates() {
  const cases = [
    [singleParentPass, {
      sessionsWorker: 16, daemonIdentitiesSeen: 1, perChildRpcProcessCount: 0, failedChildren: 0, terminalChildFailures: 0,
    }, [{ sessionsWorker: 15 }, { daemonIdentitiesSeen: 2 }, { perChildRpcProcessCount: 1 },
      { failedChildren: 1 }, { terminalChildFailures: 1 }]],
    [resumePass, {
      childrenStarted: 4, reattachedChildren: 4, grewAfterParentExit: true, resumeExit: null,
      resumeAcknowledged: true, sameParentSession: true, noPromptReplay: true, childrenCompleted: 4,
    }, [{ childrenStarted: 0 }, { reattachedChildren: 0 }, { grewAfterParentExit: false }, { resumeAcknowledged: false },
      { sameParentSession: false }, { noPromptReplay: false }, { childrenCompleted: 3 }]],
    [teamPass, {
      memberRecords: 1, mailDelivered: true, memberSessionContexts: [{ role: "member" }],
      memberContextMatches: true, failedMembers: 0, perChildRpcProcessCount: 0,
    }, [{ memberRecords: 0 }, { mailDelivered: false }, { memberSessionContexts: [] },
      { memberContextMatches: false }, { failedMembers: 1 }, { perChildRpcProcessCount: 1 }]],
    [reopenPass, {
      childCompleted: "completed", parkObserved: true, reopenExit: null, reviveAccepted: true,
      transcriptLinesBeforeReopen: 10, transcriptLinesAfterReopen: 16,
      reopenedCompleted: true, reopenMessageDelivered: true, sameChildSession: true,
    }, [{ childCompleted: "error" }, { parkObserved: false }, { reviveAccepted: false }, { transcriptLinesAfterReopen: 10 },
      { reopenedCompleted: false }, { reopenMessageDelivered: false }, { sameChildSession: false }]],
    [stormPass, {
      hostPid: 123, childrenStarted: 0, bashCallRecords: 240,
      stormParticipants: 8, zombieChildCount: 0, daemonReportedZombies: 0, daemonAlive: true,
    }, [{ stormParticipants: 0 }, { bashCallRecords: 199 }, { zombieChildCount: 1 },
      { daemonReportedZombies: 1 }, { daemonAlive: false }, { hostPid: null }]],
  ]
  const failures = []
  for (const [gate, healthy, mutations] of cases) {
    if (!gate(healthy)) failures.push(`${gate.name}: rejects a healthy completed workload on a loaded host`)
    for (const mutation of mutations) {
      if (gate({ ...healthy, ...mutation })) failures.push(`${gate.name}: accepted broken product fact ${JSON.stringify(mutation)}`)
    }
  }
  assert(failures.length === 0, failures.join("\n"))
}

function checkSandboxEnv(root) {
  const polluted = {}
  for (const name of DELETED_CHILD_ENV) polluted[name] = "/real/install"
  const previous = { ...process.env }
  Object.assign(process.env, polluted, { OMO_CODING_AGENT_DIR: join(root, "real-agent") })
  try {
    const env = sandboxEnv({ home: join(root, "home"), agentDir: join(root, "agent"), xdgConfigHome: join(root, "xdg") })
    for (const name of DELETED_CHILD_ENV) assert(env[name] === undefined, `${name} must be deleted from the child env`)
    for (const name of AGENT_DIR_ENV_NAMES) {
      assert(env[name] === join(root, "agent"), `${name} must point at the sandbox agent dir, not the caller's`)
    }
    assert(env.HOME === join(root, "home"), "HOME must be the sandbox home so the runtime provisions inside it")
    assert(env.XDG_CONFIG_HOME === join(root, "xdg"), "XDG_CONFIG_HOME must be the sandbox's")
  } finally {
    for (const name of Object.keys(polluted)) delete process.env[name]
    for (const [name, value] of Object.entries(previous)) process.env[name] = value
  }
}

function checkProcessScoping() {
  const sandbox = { root: "/private/tmp/dh41.selftest/sA", home: "/private/tmp/dh41.selftest/home" }
  const table = [
    { pid: 1, args: `${sandbox.home}/.omo/binary-runtime/v/omo --internal-rpc-host-supervisor --socket ${sandbox.root}/agent/rpc/rpc.sock` },
    { pid: 2, args: `${sandbox.home}/.omo/binary-runtime/v/omo --mode rpc --multi-session --listen unix:///var/T/host.sock` },
    { pid: 3, args: `${sandbox.home}/.omo/binary-runtime/v/omo --mode rpc --no-extensions --no-ask-user` },
    { pid: 4, args: "/Users/other/.omo/binary-runtime/v/omo --mode rpc --no-extensions" },
  ]
  const owned = new Set([7])
  const perChild = table.filter((entry) =>
    entry.args.includes("--mode rpc") &&
    !entry.args.includes("--multi-session") &&
    (owned.has(entry.pid) || entry.args.includes(sandbox.home) || entry.args.includes(sandbox.root)))
  assert(perChild.length === 1 && perChild[0].pid === 3, "only this run's single-session `--mode rpc` child counts as a per-child process")
  assert(table.filter((entry) => entry.args.includes(sandbox.root)).length === 1, "scenario scoping must ignore a foreign session's processes")
  assert(typeof sandboxProcesses === "function" && typeof perChildRpcProcesses === "function", "process scoping helpers must be exported")
}

function checkFixtures() {
  const config = hostConfig()
  assert(config.task.global_concurrency === 16, "sandbox omo.json must set task.global_concurrency 16")
  assert(config.task.residency_max_children === 16, "sandbox omo.json must set task.residency_max_children 16")
  assert(config.team.max_members === 8, "sandbox omo.json must set team.max_members 8")
  assert(config.task.default_execution_mode === undefined, "the default-mode rule needs omo.json WITHOUT default_execution_mode")
  const script = spawnScript(16, CHILD_BUSY)
  assert(script.parentSteps.filter((step) => step.name === "task").length === 16, "a 16-child parent script must issue 16 task calls")
  assert(script.parentSteps.at(-1).type === "text", "a parent script must end with a text step so the turn closes")
  // The busy step must call a tool the child can COMPLETE on this engine and take TIME doing it.
  // `bash` is eval-only (a direct call is refused instantly; the mock repeats its last step; the
  // child spun at 100% of the host loop and starved every other open) and `eval` aborts at
  // startup in a mock child. `read` completes; the mock's delayMs supplies the time.
  assert(script.childSteps[0].name === "read", "a mid-turn child keeps working through a repeating tool step")
  assert(script.childSteps[0].delayMs >= 1_000, "the busy step must hold the child for real, through a delayed model call")
  // ...and it must END: the mock repeats its LAST step, so a busy script whose last step is a
  // tool call never frees its concurrency slot, and the sessions the host should accumulate
  // never open.
  assert(script.childSteps.at(-1).type === "text", "a busy child script must end with a text step so the child finishes")
  assert(failureTokens("error too_many_sessions here").join() === "too_many_sessions", "failure tokens must be detected")
  assert(failureTokens("all good").length === 0, "failure tokens must not false-positive")
}

function checkReaders(root) {
  assert(lastJsonLine('banner\n{"a":1}\n{"reachable":true,"pid":7}\n')?.pid === 7, "the last JSON line must win over a banner")
  assert(lastJsonLine("no json at all") === undefined, "a JSON-free stream must read as undefined")
  const sandbox = { cwd: root, stateDir: join(root, "state") }
  mkdirSync(join(sandbox.stateDir, "sessions", "st_a"), { recursive: true })
  writeFileSync(join(sandbox.stateDir, "sessions", "st_a", "t.jsonl"), '{"type":"x"}\n{"type":"y"}\n')
  assert(jsonlLines(join(sandbox.stateDir, "sessions", "st_a", "t.jsonl")).length === 2, "jsonl reader must count records")
  const failedRecord = { task_id: "st_a", status: "error", error_message: "Task runner failed to start.", execution_mode: "process" }
  mkdirSync(join(sandbox.stateDir, "tasks"), { recursive: true })
  writeFileSync(join(sandbox.stateDir, "tasks", "st_a.json"), JSON.stringify(failedRecord))
  const diagnosis = childStartDiagnosis(sandbox, [failedRecord])
  assert(diagnosis.errored === 1 && diagnosis.childSessionsDirExists === true, "the child-start probe must localize a start failure")
  // The engine's real layout nests a child's sessions under children/<id>/sessions/<id>/; the
  // reader must find those, or every transcript assertion runs blind against a working child.
  const nested = { stateDir: join(root, "state-nested") }
  mkdirSync(join(nested.stateDir, "children", "st_b", "sessions", "st_b"), { recursive: true })
  writeFileSync(join(nested.stateDir, "children", "st_b", "sessions", "st_b", "t.jsonl"), '{"type":"x"}\n')
  assert(childSessionFiles(nested, "st_b").length === 1, "child session files must be found under children/<id>/sessions/<id>/")
  assert(childStartDiagnosis(nested, []).childSessionsDirExists === true, "the child-start probe must see the nested layout")
  const probeDir = join(root, "creds")
  mkdirSync(probeDir, { recursive: true })
  writeFileSync(join(probeDir, "auth.json"), "AAA")
  const first = credentialDigest(probeDir)
  writeFileSync(join(probeDir, "auth.json"), "BBB")
  assert(first !== credentialDigest(probeDir), "the credential digest must move when auth.json changes")
}

function checkGates() {
  for (const result of [scenarioD(), scenarioE4({}), scenarioH2({})]) {
    assert(result.status === "skipped", `${result.scenario} without its gate must be skipped, never passed`)
    assert(result.reason.startsWith("needs "), `${result.scenario} must name what it needs`)
    assert(result.command.includes("task-host-e2e.mjs"), `${result.scenario} must carry the exact command that would run it`)
  }
  const handoff = scenarioHandoffSuite({})
  assert(handoff.then !== undefined, "the handoff suite is async")
}

function checkDriverSource(scriptDir) {
  const driver = readFileSync(join(scriptDir, "task-host-e2e.mjs"), "utf8")
  assert(driver.includes("summary.result === \"PASS\""), "the driver must gate its exit code on the summary result")
  assert(driver.includes("realSenpiUntouched"), "the driver must report whether the real agent dirs stayed untouched")
  assert(driver.includes("addressed.length === 0"), "the driver must fail when any process it started named a real agent dir")
  assert(driver.includes("BINARY-STABILITY"), "the driver must fail a run whose binary was replaced mid-suite")
  const bareRpcScan = ["p", 'grep", ["-f", "--mode rpc"'].join("")
  assert(!driver.includes(bareRpcScan), "process scans must be scoped to this sandbox, never to every `--mode rpc` on the machine")
}
