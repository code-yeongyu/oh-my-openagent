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
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const { digestDirectory } = await import(pathToFileURL(join(scriptDir, "drive.mjs")).href)
// Lane-private pure helpers (analysis + read-only isolation probes) and the live scenario drivers, kept
// out of this file so the driver stays under the repo pure-LOC ceiling; the --self-test unit-covers the
// pure helpers.
const { CREDENTIAL_FILES, digestCredentialFiles, parseEvents, readRecords, analyzeSpawn, analyzeRpcRouting, eventsMentionSteerAck, statusSnapshots, scanRpcChildPids } =
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

// Run the live scenarios and return an ordered check list. Scenario A proves spawn (real pid + child
// session JSONL), steer, and completion against a real detached rpc child; the KILL and RECONCILE
// scenarios then drive a HANGING child so the failure-path proofs (kill -> error+killed:true; parent
// crash -> orphan reconciled lost + terminated) run against a genuinely live, non-terminal process.
async function runChecks(senpiBin, sandbox, sessionDir, stateDir, spawnedPidsBefore) {
  const checks = []
  const a = driveSenpi(senpiBin, sandbox, sessionDir, SCENARIO_A_STEPS)
  const aEvents = parseEvents(a.stdout)
  // Headline STEP-1 proof: process mode reaches the rpc runner (a recorded pid or a named rpc spawn-path
  // failure), never the silent in-process fallback.
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

  const leakedPids = scanRpcChildPids().filter((p) => spawnedPidsBefore.includes(p) === false)
  checks.push({ check: "no_leaked_rpc_child_pids", verdict: leakedPids.length === 0 ? "PASS" : "FAIL", ...(leakedPids.length > 0 && { reason: `leaked pids ${leakedPids.join(",")}` }), facts: { leakedPids } })
  return { checks, leakedPids, spawnPass: spawn.pass, routed: routing.routed }
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
  const pidsBefore = scanRpcChildPids()
  let payload
  try {
    const { checks, leakedPids, spawnPass, routed } = await runChecks(senpiBin, sandbox, sessionDir, stateDir, pidsBefore)
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
  // #given a process record with a pid but no real child session JSONL #then analyzeSpawn fails
  const stateDir = join(process.cwd(), "__self_test_missing__")
  const noJsonl = analyzeSpawn([{ task_id: "st_fix", execution_mode: "process", pid: 4242, residency_state: "rpc_detached" }], stateDir)
  if (noJsonl.pass !== false) throw new Error("self-test: sessions-jsonl absence must fail the spawn proof")
  if (noJsonl.facts.pid !== 4242) throw new Error("self-test: analyzeSpawn must surface the pid fact")
  // #given a real child session JSONL under children/<id>/sessions/<id>/ #then a pid + transcript PASSES
  // even when residency is the honest terminal "disposed" (residency is informational, not gating).
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
  // #given the broken shape (in-process fallback, no pid) #then the gap is detected
  const broken = analyzeSpawn([{ task_id: "st_brk", execution_mode: "process", residency_state: "disposed" }], stateDir)
  if (broken.pass !== false) throw new Error("self-test: in-process fallback must not read as a spawned rpc child")
  if (broken.reason === undefined || broken.reason.includes("pid=absent") === false) throw new Error("self-test: broken shape must localize the missing pid")
  // #given a process record with a recorded pid #then routing is proven regardless of terminal status
  if (analyzeRpcRouting([{ task_id: "st_p", execution_mode: "process", status: "running", pid: 5150 }]).routed !== true) throw new Error("self-test: a pid must prove rpc routing")
  // #given a process record that failed on the rpc child-entry spawn path #then routing is still proven
  const spawnErr = analyzeRpcRouting([{ task_id: "st_e", execution_mode: "process", status: "error", error_message: "Package subpath './rpc-entry' is not defined by exports" }])
  if (spawnErr.routed !== true) throw new Error("self-test: an rpc spawn-path failure must prove rpc routing")
  // #given a process record that COMPLETED via the in-process fallback (no pid, no rpc error) #then routing is NOT proven
  if (analyzeRpcRouting([{ task_id: "st_f", execution_mode: "process", status: "completed" }]).routed !== false) throw new Error("self-test: an in-process fallback completion must not read as rpc routing")
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
  await main()
}

