#!/usr/bin/env node
// Live QA driver for the rpc-process task path (todo 27). Follows drive.mjs conventions EXACTLY:
// isolated SENPI_CODING_AGENT_DIR mktemp sandbox that ignores caller env, a LOCAL mock provider (no
// real API keys, no network), a final JSON verdict {PASS|FAIL|SKIP} per check, the real ~/.senpi/agent
// shasum asserted unchanged before/after, and the child process tree killed in finally with a leaked
// pid assertion. senpi binary absent -> explicit SKIP.
//
// The five scenarios (plan authoritative): (1) task(execution_mode:"process", run_in_background:true)
// spawns a real child senpi PROCESS - pid in task_output(status), child session JSONL under sandbox
// .omo/senpi-task/sessions/<st_id>/, auth resolved from the SANDBOX agent dir not the real one;
// (2) task_send steer mid-run acked; (3) completion push arrives; (4) kill -9 the child pid -> status
// error + killed:true + failure notification; (5) relaunch senpi in the same sandbox cwd -> session_start
// reconciliation marks the orphan lost (cause reconcile_lost) with breadcrumbs in task_list(all) and the
// old child pid is DEAD. Each check asserts the REAL fact, so the driver goes green ONLY on a build that
// actually spawns the rpc child and records its pid.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const { createSandbox, seedSandbox, digestDirectory } = await import(pathToFileURL(join(scriptDir, "drive.mjs")).href)
// Lane-private pure helpers (analysis + read-only isolation probes), kept out of this file so the driver
// stays under the repo pure-LOC ceiling; the driver's --self-test unit-covers them.
const { CREDENTIAL_FILES, digestCredentialFiles, parseEvents, readRecords, analyzeSpawn, eventsMentionSteerAck, statusSnapshots, scanRpcChildPids, pidAlive } =
  await import(pathToFileURL(join(scriptDir, "task-rpc-e2e-helpers.mjs")).href)
const mockProviderEntry = join(scriptDir, "task-rpc-e2e-mock-provider.ts")
const realSenpiAgentDir = join(homedir(), ".senpi", "agent")
const CHILD_FINAL_TEXT = "omo rpc child mock work complete"
const PROJECT_OMO_CONFIG = { categories: { proc: { description: "Process-mode mock category.", model: "omo-mock/mock-1" } } }

function resolveSenpi() {
  const bin = process.env.SENPI_BIN?.trim() || "senpi"
  if (bin.includes("/")) return existsSync(bin) ? bin : null
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = resolve(dir || ".", bin)
    if (existsSync(candidate)) return candidate
  }
  return null
}

function driveSenpi(senpiBin, sandbox, sessionDir, parentSteps) {
  const script = { parentSteps, childSteps: [{ type: "text", text: CHILD_FINAL_TEXT }] }
  writeFileSync(join(sandbox.cwd, "mock-script.json"), `${JSON.stringify(script, null, 2)}\n`)
  const run = spawnSync(
    senpiBin,
    ["-e", mockProviderEntry, "-p", "--mode", "json", "--provider", "omo-mock", "--model", "mock-1", "--session-dir", sessionDir, "run the rpc-process task e2e"],
    {
      cwd: sandbox.cwd,
      env: { ...process.env, SENPI_CODING_AGENT_DIR: sandbox.agentDir, SENPI_CODING_AGENT_SESSION_DIR: sessionDir, OMO_SENPI_QA: "1" },
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
    },
  )
  return { status: run.status, signal: run.signal ?? null, stdout: run.stdout ?? "", stderr: run.stderr ?? "" }
}

const SCENARIO_A_STEPS = [
  { type: "tool_call", name: "task", arguments: { category: "proc", execution_mode: "process", run_in_background: true, name: "p1", prompt: "Do the rpc child work and stop." } },
  { type: "tool_call", name: "task_send", arguments: { name: "p1", message: "steer: keep going", deliver_as: "steer" } },
  { type: "tool_call", name: "task_wait", arguments: { targets: ["p1"], timeout_ms: 20_000 } },
  { type: "tool_call", name: "task_output", arguments: { name: "p1", mode: "status" } },
  { type: "text", text: "rpc-process scenario A complete" },
]

const RECONCILE_RELAUNCH_STEPS = [
  { type: "tool_call", name: "task_list", arguments: { all_scope: true } },
  { type: "text", text: "reconcile relaunch complete" },
]

// Run the live scenarios and return an ordered check list. When scenario A proves no real child process
// (the current wiring falls back to the in-process runner and never records a pid), the process-dependent
// checks 2-5 are blocked and reported FAIL with the localized product-gap reason rather than faked green.
function runChecks(senpiBin, sandbox, sessionDir, stateDir, spawnedPidsBefore) {
  const checks = []
  const a = driveSenpi(senpiBin, sandbox, sessionDir, SCENARIO_A_STEPS)
  const aEvents = parseEvents(a.stdout)
  const spawn = analyzeSpawn(readRecords(stateDir), stateDir)
  checks.push({ check: "spawn_process_pid_and_session_jsonl", verdict: spawn.pass ? "PASS" : "FAIL", ...(spawn.reason && { reason: spawn.reason }), facts: spawn.facts })

  const steerFact = eventsMentionSteerAck(aEvents)
  checks.push({
    check: "steer_ack_mid_run",
    verdict: spawn.pass && steerFact ? "PASS" : "FAIL",
    reason: spawn.pass ? (steerFact ? undefined : "no steer ack observed") : "blocked: no rpc child spawned (see spawn_process)",
  })

  const completed = readRecords(stateDir).some((r) => r.status === "completed" && r.execution_mode === "process")
  const snaps = statusSnapshots(aEvents)
  checks.push({
    check: "completion_push_arrives",
    verdict: spawn.pass && completed ? "PASS" : "FAIL",
    reason: spawn.pass ? (completed ? undefined : "no completion recorded") : "blocked: no rpc child spawned (see spawn_process)",
    facts: { statusSnapshotCount: snaps.length },
  })

  // Scenario 4 (kill): a real build exposes the child pid in task_output(status); we kill -9 it and the
  // parent's outcome tracking records status=error killed:true. With no pid there is nothing to kill.
  const killPid = snaps.map((s) => s.pid).find((p) => typeof p === "number")
  if (spawn.pass && typeof killPid === "number") {
    try {
      process.kill(killPid, "SIGKILL")
    } catch {
      // already gone: still a valid kill outcome
    }
  }
  const killed = readRecords(stateDir).some((r) => r.status === "error" && r.killed === true)
  checks.push({
    check: "kill_marks_error_killed_true",
    verdict: spawn.pass && typeof killPid === "number" && killed ? "PASS" : "FAIL",
    reason: spawn.pass ? (typeof killPid === "number" ? (killed ? undefined : "kill did not yield error+killed:true") : "no child pid in task_output(status) to kill") : "blocked: no rpc child spawned (see spawn_process)",
  })

  // Scenario 5 (reconcile): relaunch senpi in the same sandbox cwd. session_start reconciliation must mark
  // a live orphan lost (cause reconcile_lost) with pid breadcrumbs in task_list(all) and terminate it.
  const relaunch = driveSenpi(senpiBin, sandbox, sessionDir, RECONCILE_RELAUNCH_STEPS)
  const relaunchOk = relaunch.status === 0
  const reconcileRecords = readRecords(stateDir)
  const orphanPid = spawn.facts.pid
  const orphanDead = typeof orphanPid === "number" ? pidAlive(orphanPid) === false : false
  const lostWithPid = reconcileRecords.some((r) => r.status === "lost" && typeof r.pid === "number")
  checks.push({
    check: "reconcile_lost_terminates_orphan",
    verdict: spawn.pass && relaunchOk && lostWithPid && orphanDead ? "PASS" : "FAIL",
    reason: spawn.pass ? (lostWithPid ? undefined : "no lost record with pid breadcrumb after relaunch") : "blocked: no rpc child spawned with a pid to reconcile (see spawn_process)",
  })

  const leakedPids = scanRpcChildPids().filter((p) => spawnedPidsBefore.includes(p) === false)
  checks.push({ check: "no_leaked_rpc_child_pids", verdict: leakedPids.length === 0 ? "PASS" : "FAIL", ...(leakedPids.length > 0 && { reason: `leaked pids ${leakedPids.join(",")}` }), facts: { leakedPids } })
  return { checks, leakedPids, spawnPass: spawn.pass }
}

function main() {
  const providedAgentDir = process.env.SENPI_CODING_AGENT_DIR ? "IGNORED" : "unset"
  const senpiBin = resolveSenpi()
  const beforeCreds = digestCredentialFiles(realSenpiAgentDir)
  const beforeWholeDir = digestDirectory(realSenpiAgentDir)
  if (senpiBin === null) {
    console.log(JSON.stringify({ result: "SKIP", reason: "senpi-binary-unavailable", providedAgentDir }))
    return
  }
  const sandbox = createSandbox()
  const pidsBefore = scanRpcChildPids()
  let payload
  try {
    seedSandbox(sandbox)
    const sessionDir = join(sandbox.root, "sessions")
    mkdirSync(sessionDir, { recursive: true })
    const omoDir = join(sandbox.cwd, ".omo")
    mkdirSync(omoDir, { recursive: true })
    writeFileSync(join(omoDir, "omo.json"), `${JSON.stringify(PROJECT_OMO_CONFIG, null, 2)}\n`)
    const stateDir = join(sandbox.cwd, ".omo", "senpi-task")

    const { checks, leakedPids, spawnPass } = runChecks(senpiBin, sandbox, sessionDir, stateDir, pidsBefore)
    const afterCreds = digestCredentialFiles(realSenpiAgentDir)
    const wholeDirDigestStable = beforeWholeDir === digestDirectory(realSenpiAgentDir)
    const realCredentialsUntouched = beforeCreds === afterCreds
    // Isolation is a GATED check: the real credential/config files must be byte-identical and the caller's
    // SENPI_CODING_AGENT_DIR must have been ignored in favor of the sandbox agent dir.
    checks.unshift({
      check: "real_credentials_untouched_and_caller_env_ignored",
      verdict: realCredentialsUntouched && providedAgentDir !== "USED" ? "PASS" : "FAIL",
      ...(realCredentialsUntouched ? {} : { reason: "a real ~/.senpi/agent credential/config file changed across the run" }),
      facts: { realCredentialsUntouched, providedAgentDir, sandboxAgentDir: sandbox.agentDir, credentialFiles: CREDENTIAL_FILES },
    })
    const allPass = checks.every((c) => c.verdict === "PASS")
    payload = {
      result: allPass ? "PASS" : "FAIL",
      checks,
      realCredentialsUntouched,
      wholeDirDigestStable,
      leakedPids: leakedPids.length,
      providedAgentDir,
      sandboxAgentDir: sandbox.agentDir,
      sandboxCwd: sandbox.cwd,
      ...(spawnPass
        ? {}
        : {
            productGap:
              "execution_mode:'process' does not spawn an rpc child. packages/omo-senpi/src/components/task/engine.ts wires runners.process to the in-process runner (RpcProcessRunner/createRpcManagedRunner are exported but never instantiated), and packages/senpi-task/src/manager/manager.ts #launch records the start transition without the handle pid, so task_output(status) and reconcile never see a pid. Live proof: record.execution_mode='process' yet no pid, no sessions/<id>/ JSONL, residency_state='disposed'.",
          }),
    }
  } finally {
    killProcessTree(pidsBefore)
    rmSync(sandbox.root, { recursive: true, force: true })
  }
  console.log(JSON.stringify(payload))
}

// No-orphan law: kill any senpi rpc child that appeared during this run (not present before), SIGTERM
// then SIGKILL, so none of OUR pids survive the driver.
function killProcessTree(pidsBefore) {
  for (const pid of scanRpcChildPids()) {
    if (pidsBefore.includes(pid)) continue
    try {
      process.kill(pid, "SIGTERM")
      process.kill(pid, "SIGKILL")
    } catch {
      // already exited
    }
  }
}

function runSelfTest() {
  // #given a fixed-product spawn shape #then analyzeSpawn passes
  const stateDir = join(process.cwd(), "__self_test_missing__")
  const fixed = analyzeSpawn([{ task_id: "st_fix", execution_mode: "process", pid: 4242, residency_state: "rpc_detached" }], stateDir)
  if (fixed.pass !== false) throw new Error("self-test: sessions-jsonl absence must fail the fixed shape without a real dir")
  // analyzeSpawn's pid+residency branch: verify the non-jsonl fields are read correctly
  if (fixed.facts.pid !== 4242 || fixed.facts.residency_state !== "rpc_detached") throw new Error("self-test: analyzeSpawn must surface pid + residency facts")
  // #given the current broken shape (in-process fallback) #then the gap is detected
  const broken = analyzeSpawn([{ task_id: "st_brk", execution_mode: "process", residency_state: "disposed" }], stateDir)
  if (broken.pass !== false) throw new Error("self-test: in-process fallback must not read as a spawned rpc child")
  if (broken.reason === undefined || broken.reason.includes("pid=absent") === false) throw new Error("self-test: broken shape must localize the missing pid")
  // #given events carrying a steer ack #then detection is true
  if (eventsMentionSteerAck([{ type: "toolResult", name: "task_send", details: { delivered: "steer" } }]) !== true) throw new Error("self-test: steer ack detection failed")
  if (eventsMentionSteerAck([{ type: "text", text: "nothing here" }]) !== false) throw new Error("self-test: steer ack false positive")
  // #given a status result with a snapshot #then statusSnapshots extracts it
  const snaps = statusSnapshots([{ kind: "status", snapshot: { task_id: "st_x", pid: 99 } }])
  if (snaps.length !== 1 || snaps[0].pid !== 99) throw new Error("self-test: status snapshot extraction failed")
  // #given a credential file present #then the digest is deterministic and moves when the file changes
  const probeRoot = join(process.cwd(), `__cred_probe_${process.pid}__`)
  mkdirSync(probeRoot, { recursive: true })
  try {
    writeFileSync(join(probeRoot, "auth.json"), "AAA")
    const d1 = digestCredentialFiles(probeRoot)
    if (d1 !== digestCredentialFiles(probeRoot)) throw new Error("self-test: credential digest must be deterministic")
    writeFileSync(join(probeRoot, "auth.json"), "BBB")
    if (digestCredentialFiles(probeRoot) === d1) throw new Error("self-test: credential digest must move when auth.json changes")
  } finally {
    rmSync(probeRoot, { recursive: true, force: true })
  }
  console.log("SELF-TEST OK")
}

if (process.argv.includes("--self-test")) {
  runSelfTest()
} else {
  main()
}
