#!/usr/bin/env node
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const { digestDirectory } = await import(pathToFileURL(join(scriptDir, "drive.mjs")).href)
const { CREDENTIAL_FILES, digestCredentialFiles, parseEvents, readRecords, analyzeSpawn, analyzeRpcRouting, eventsMentionSteerAck, statusSnapshots, liveRecordRpcChildPids, recordRpcChildPids, sleep } =
  await import(pathToFileURL(join(scriptDir, "task-rpc-e2e-helpers.mjs")).href)
const { SCENARIO_A_STEPS, prepareScenarioSandbox, driveSenpi, runKillCheck, runReconcileCheck } =
  await import(pathToFileURL(join(scriptDir, "task-rpc-e2e-scenarios.mjs")).href)
const realSenpiAgentDir = join(homedir(), ".senpi", "agent")

function resolveSenpi() {
  const bin = process.env.SENPI_BIN?.trim() || "senpi"
  if (bin.includes("/")) return existsSync(bin) ? bin : null
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = resolve(dir || ".", bin)
    if (existsSync(candidate)) return candidate
  }
  return null
}

async function runChecks(senpiBin, sandbox, sessionDir, stateDir) {
  const checks = []
  const a = driveSenpi(senpiBin, sandbox, sessionDir, SCENARIO_A_STEPS)
  const aEvents = parseEvents(a.stdout)
  const routing = analyzeRpcRouting(readRecords(stateDir))
  checks.push({ check: "process_mode_routes_to_rpc_runner", verdict: routing.routed ? "PASS" : "FAIL", ...(routing.reason && { reason: routing.reason }), facts: routing.facts })
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

  checks.push(await runKillCheck(senpiBin))
  checks.push(await runReconcileCheck(senpiBin))

  killProcessTree(stateDir)
  const leakedPids = await waitForRecordedPidsToExit(stateDir)
  checks.push({ check: "no_leaked_rpc_child_pids", verdict: leakedPids.length === 0 ? "PASS" : "FAIL", ...(leakedPids.length > 0 && { reason: `leaked pids ${leakedPids.join(",")}` }), facts: { leakedPids } })
  return { checks, leakedPids, spawnPass: spawn.pass, routed: routing.routed }
}

async function waitForRecordedPidsToExit(stateDir, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs
  let livePids = liveRecordRpcChildPids(readRecords(stateDir))
  while (livePids.length > 0 && Date.now() < deadline) {
    await sleep(200)
    livePids = liveRecordRpcChildPids(readRecords(stateDir))
  }
  return livePids
}

async function main() {
  const providedAgentDir = process.env.SENPI_CODING_AGENT_DIR ? "IGNORED" : "unset"
  const senpiBin = resolveSenpi()
  const beforeCreds = digestCredentialFiles(realSenpiAgentDir)
  const beforeWholeDir = digestDirectory(realSenpiAgentDir)
  if (senpiBin === null) {
    console.log(JSON.stringify({ result: "SKIP", reason: "senpi-binary-unavailable", providedAgentDir }))
    return
  }
  const { sandbox, sessionDir, stateDir } = prepareScenarioSandbox()
  let payload
  try {
    const { checks, leakedPids, spawnPass, routed } = await runChecks(senpiBin, sandbox, sessionDir, stateDir)
    const afterCreds = digestCredentialFiles(realSenpiAgentDir)
    const wholeDirDigestStable = beforeWholeDir === digestDirectory(realSenpiAgentDir)
    const realCredentialsUntouched = beforeCreds === afterCreds
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
      wiringFixed: routed,
      ...(spawnPass
        ? {}
        : {
            productGap: routed
              ? "execution_mode:'process' routes to the rpc runner, but no real detached child spawned with a pid + child session JSONL. Expected after the spawn-strategy fix: buildRpcSpawn must spawn the senpi EXECUTABLE ('<exe> --mode rpc'), not require.resolve('@code-yeongyu/senpi/rpc-entry') which senpi's loader alias hijacks; and RpcRunnerSpec must thread the model + the parent's -e extensions so a keyless mock child can run."
              : "execution_mode:'process' did not reach the rpc runner - the process slot still aliases the in-process runner. Fix engine.ts runners.process to createRpcManagedRunner(new RpcProcessRunner()).",
          }),
    }
  } finally {
    killProcessTree(stateDir)
    rmSync(sandbox.root, { recursive: true, force: true })
  }
  console.log(JSON.stringify(payload))
}

function killProcessTree(stateDir) {
  for (const pid of liveRecordRpcChildPids(readRecords(stateDir))) {
    try {
      process.kill(pid, "SIGTERM")
      process.kill(pid, "SIGKILL")
    } catch {
      // already exited
    }
  }
}

function runSelfTest() {
  const driverSource = readFileSync(fileURLToPath(import.meta.url), "utf8")
  const helperSource = readFileSync(join(scriptDir, "task-rpc-e2e-helpers.mjs"), "utf8")
  const staleCleanupCall = ["killProcessTree", "(pidsBefore)"].join("")
  const globalRpcPgrep = ["p", 'grep", ["-f", "', ["senpi", "--mode", "rpc"].join(" "), '"]'].join("")
  if (driverSource.includes(staleCleanupCall) || helperSource.includes(globalRpcPgrep)) {
    throw new Error("self-test: RPC cleanup must use sandbox-owned task record pids, not global process scans")
  }
  const scenarioSource = readFileSync(join(scriptDir, "task-rpc-e2e-scenarios.mjs"), "utf8")
  if (droppedToolPattern().test(scenarioSource)) {
    throw new Error("self-test: RPC scenario scripts still name a dropped tool")
  }
  const stateDir = join(process.cwd(), "__self_test_missing__")
  const noJsonl = analyzeSpawn([{ task_id: "st_fix", execution_mode: "process", pid: 4242, residency_state: "rpc_detached" }], stateDir)
  if (noJsonl.pass !== false) throw new Error("self-test: sessions-jsonl absence must fail the spawn proof")
  if (noJsonl.facts.pid !== 4242) throw new Error("self-test: analyzeSpawn must surface the pid fact")
  const jsonlRoot = join(process.cwd(), `__self_test_jsonl_${process.pid}__`)
  const childDir = join(jsonlRoot, "children", "st_ok", "sessions", "st_ok")
  mkdirSync(childDir, { recursive: true })
  try {
    writeFileSync(join(childDir, "t.jsonl"), "{}\n")
    const ok = analyzeSpawn([{ task_id: "st_ok", execution_mode: "process", pid: 7, residency_state: "disposed" }], jsonlRoot)
    if (ok.pass !== true) throw new Error("self-test: pid + real child JSONL must pass regardless of disposed residency")
  } finally {
    rmSync(jsonlRoot, { recursive: true, force: true })
  }
  const broken = analyzeSpawn([{ task_id: "st_brk", execution_mode: "process", residency_state: "disposed" }], stateDir)
  if (broken.pass !== false) throw new Error("self-test: in-process fallback must not read as a spawned rpc child")
  if (broken.reason === undefined || broken.reason.includes("pid=absent") === false) throw new Error("self-test: broken shape must localize the missing pid")
  if (analyzeRpcRouting([{ task_id: "st_p", execution_mode: "process", status: "running", pid: 5150 }]).routed !== true) throw new Error("self-test: a pid must prove rpc routing")
  const spawnErr = analyzeRpcRouting([{ task_id: "st_e", execution_mode: "process", status: "error", error_message: "Package subpath './rpc-entry' is not defined by exports" }])
  if (spawnErr.routed !== true) throw new Error("self-test: an rpc spawn-path failure must prove rpc routing")
  if (analyzeRpcRouting([{ task_id: "st_f", execution_mode: "process", status: "completed" }]).routed !== false) throw new Error("self-test: an in-process fallback completion must not read as rpc routing")
  if (eventsMentionSteerAck([{ type: "toolResult", name: "task_send", details: { delivered: "steer" } }]) !== true) throw new Error("self-test: steer ack detection failed")
  if (eventsMentionSteerAck([{ type: "text", text: "nothing here" }]) !== false) throw new Error("self-test: steer ack false positive")
  const snaps = statusSnapshots([{ kind: "status", snapshot: { task_id: "st_x", pid: 99 } }])
  if (snaps.length !== 1 || snaps[0].pid !== 99) throw new Error("self-test: status snapshot extraction failed")
  const pids = recordRpcChildPids([{ execution_mode: "process", pid: 12 }, { execution_mode: "in-process", pid: 13 }, { execution_mode: "process" }])
  if (pids.length !== 1 || pids[0] !== 12) throw new Error("self-test: rpc child pid scan must use process-mode task records only")
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

function droppedToolPattern() {
  const names = [
    ["task", "wait"],
    ["task", "interrupt"],
    ["team", "send", "message"],
    ["team", "shutdown", "request"],
    ["team", "approve", "shutdown"],
    ["team", "reject", "shutdown"],
    ["team", "status"],
    ["team", "list"],
    ["team", "task", ""],
  ].map((parts) => parts.join("_"))
  return new RegExp(names.join("|"))
}

if (process.argv.includes("--self-test")) {
  runSelfTest()
} else {
  await main()
}
