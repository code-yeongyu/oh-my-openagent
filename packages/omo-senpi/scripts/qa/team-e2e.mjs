#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

import { createSandbox, digestDirectory, seedSandbox } from "./drive.mjs"
import {
  credentialDigest,
  discoverRunIds,
  findResults,
  inboxCounts,
  memberInboxDir,
  parseEvents,
  readText,
  runtimeDir,
  seedCrashReservation,
} from "./team-e2e-support.mjs"
import { LEAD_SCRIPT, DURA_REVIVE_SCRIPT, DURA_SEED_SCRIPT, NOOP_SCRIPT } from "./team-e2e-scripts.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const mockProviderEntry = join(scriptDir, "team-e2e-mock-provider.ts")
const realSenpiAgentDir = join(homedir(), ".senpi", "agent")
const STALE_TTL_MS = 10 * 60 * 1000

const OMO_CONFIG = {
  categories: {
    quick: { model: "omo-mock/mock-1" },
    fixture: { model: "omo-mock/mock-1" },
    dura: { model: "omo-mock/mock-1" },
  },
  agents: { fixture: { model: "omo-mock/mock-1", description: "team fixture agent", prompt: "You are the fixture agent." } },
}

const spawnedGroups = new Set()

function resolveSenpi() {
  const bin = process.env.SENPI_BIN?.trim() || "senpi"
  if (bin.includes("/")) return existsSync(bin) ? bin : null
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = resolve(dir || ".", bin)
    if (existsSync(candidate)) return candidate
  }
  return null
}

function seedProject(sandbox) {
  seedSandbox(sandbox)
  const omoDir = join(sandbox.cwd, ".omo")
  mkdirSync(omoDir, { recursive: true })
  writeFileSync(join(omoDir, "omo.json"), `${JSON.stringify(OMO_CONFIG, null, 2)}\n`)
}

function runSenpi(senpiBin, sandbox, prompt, script, obsDir) {
  writeFileSync(join(sandbox.cwd, "mock-script.json"), `${JSON.stringify(script, null, 2)}\n`)
  const sessionDir = join(sandbox.root, "sessions")
  mkdirSync(sessionDir, { recursive: true })
  const args = ["-e", mockProviderEntry, "-p", "--mode", "json", "--provider", "omo-mock", "--model", "mock-1", "--session-dir", sessionDir, prompt]
  return new Promise((resolveRun) => {
    const child = spawn(senpiBin, args, {
      cwd: sandbox.cwd,
      env: { ...process.env, SENPI_CODING_AGENT_DIR: sandbox.agentDir, SENPI_CODING_AGENT_SESSION_DIR: sessionDir, OMO_SENPI_QA: "1", ...(obsDir !== undefined ? { OMO_TEAM_E2E_OBS: obsDir } : {}) },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    })
    if (typeof child.pid === "number") spawnedGroups.add(child.pid)
    let stdout = ""
    let stderr = ""
    let settled = false
    let drainTimer
    const finish = (status, extraStderr) => {
      if (settled) return
      settled = true
      clearTimeout(hardTimer)
      clearTimeout(drainTimer)
      resolveRun({ status, stdout, stderr: extraStderr === undefined ? stderr : `${stderr}\n${extraStderr}`, events: parseEvents(stdout) })
    }
    const hardTimer = setTimeout(() => {
      try { process.kill(-child.pid, "SIGKILL") } catch { /* group already gone */ }
      finish(null)
    }, 120_000)
    child.stdout.on("data", (chunk) => { stdout += chunk })
    child.stderr.on("data", (chunk) => { stderr += chunk })
    child.on("close", (status) => finish(status))
    child.on("exit", (status) => { drainTimer = setTimeout(() => finish(status), 750) })
    child.on("error", (error) => finish(null, error.message))
  })
}

function killGroups() {
  let leaked = 0
  for (const pid of spawnedGroups) {
    try { process.kill(-pid, "SIGKILL") } catch { /* group already reaped */ }
    const probe = spawnSync("pgrep", ["-g", String(pid)], { encoding: "utf8" })
    const survivors = (probe.stdout ?? "").split(/\r?\n/).filter((line) => line.trim().length > 0 && Number(line.trim()) !== pid)
    leaked += survivors.length
  }
  return leaked
}

async function runMain(senpiBin, outDir) {
  const sandbox = createSandbox()
  const obsDir = join(outDir, "main-obs")
  seedProject(sandbox)
  const run = await runSenpi(senpiBin, sandbox, "drive the full team e2e lifecycle", LEAD_SCRIPT, obsDir)
  writeFileSync(join(outDir, "main-stdout.json.log"), run.stdout)
  writeFileSync(join(outDir, "main-stderr.log"), run.stderr)
  return { checks: analyzeMain(run, sandbox, obsDir), exit: run.status }
}

function analyzeMain(run, sandbox, obsDir) {
  const create = findResults(run.events, "team_create")[0]
  const send = findResults(run.events, "task_send")
  const taskCreate = findResults(run.events, "task_create")[0]
  const taskUpdates = findResults(run.events, "task_update")
  const outputSnapshots = taskOutputSnapshots(run.events)
  const del = findResults(run.events, "team_delete")[0]
  const runId = create?.details?.team_run_id
  const runtimeGone = runId !== undefined && !existsSync(runtimeDir(sandbox.cwd, runId))
  const memberNames = (create?.details?.members ?? []).map((m) => m.name).sort()
  const claimed = taskUpdates.some((r) => r.details?.kind === "claimed" || (r.details?.task?.status === "claimed"))
  const completedUpdate = taskUpdates.some((r) => r.details?.task?.status === "completed" || r.details?.kind === "updated")
  const teamDeliveries = teamMessageDeliveries(send)
  const shutdownRequests = shutdownDetails(send, "shutdown_requested")
  const shutdownResponses = shutdownDetails(send, "shutdown_responded")
  const approvedQuick = shutdownResponses.some((details) => details.member === "quick" && details.approved === true)
  const rejectedFixture = shutdownResponses.some((details) => details.member === "fixture" && details.approved === false)
  const quickCancelled = outputSnapshots.some((snapshot) => snapshot.name === `team:${runId}:quick` && snapshot.status === "cancelled")
  return {
    createTwoMembersActive: create?.details?.kind === "created" && (create.details.members?.length ?? 0) === 2,
    createListsActiveMembers: JSON.stringify(memberNames) === JSON.stringify(["fixture", "quick"]),
    leadToMemberDelivered: teamDeliveries.some((d) => ["revived", "steered"].includes(d.outcome)),
    memberEnvelopeEchoed: (readText(join(obsDir, "quick-received.txt")) ?? "").includes("LEAD2QUICK"),
    memberToLeadCustomMessage: (readText(join(obsDir, "lead-received.txt")) ?? "").startsWith("custom-message"),
    taskCreateClaimUpdate: taskCreate?.details?.kind === "created" && claimed && completedUpdate,
    shutdownApproved: approvedQuick,
    shutdown_via_task_send: shutdownRequests.some((details) => details.member === "quick") && approvedQuick && quickCancelled,
    rejectRestoredMember: rejectedFixture,
    teamDeletedAndRuntimeGone: del?.details?.kind === "deleted" && runtimeGone,
    leadExitClean: run.status === 0,
  }
}

async function runDuraRevive(senpiBin, outDir) {
  const sandbox = createSandbox()
  const obsDir = join(outDir, "dura-obs")
  seedProject(sandbox)
  const run = await runSenpi(senpiBin, sandbox, "durability revive drain drive", DURA_REVIVE_SCRIPT, obsDir)
  writeFileSync(join(outDir, "dura-stdout.json.log"), run.stdout)
  writeFileSync(join(outDir, "dura-stderr.log"), run.stderr)
  const runId = discoverRunIds(sandbox.cwd)[0]
  const counts = runId === undefined ? { unread: -1, reserved: -1, processed: -1 } : inboxCounts(memberInboxDir(sandbox.cwd, runId, "dura"))
  const send = findResults(run.events, "task_send")
  writeFileSync(join(outDir, "dura-inbox.json"), `${JSON.stringify({ runId, counts }, null, 2)}\n`)
  return {
    duraBacklogSeeded: readText(join(obsDir, "dura-seeded.txt")) !== undefined,
    duraReviveAccepted: teamMessageDeliveries(send).some((d) => ["revived", "steered"].includes(d.outcome)),
    duraUnreadDrainedToZero: counts.unread === 0 && counts.reserved === 0 && counts.processed >= 2,
  }
}

async function runReclaim(senpiBin, outDir) {
  const sandbox = createSandbox()
  seedProject(sandbox)
  const seed = await runSenpi(senpiBin, sandbox, "seed an active team for reclaim", DURA_SEED_SCRIPT, undefined)
  writeFileSync(join(outDir, "reclaim-seed-stdout.json.log"), seed.stdout)
  const runId = discoverRunIds(sandbox.cwd)[0]
  if (runId === undefined) return { reclaimReservationRestored: false, reclaimNoLeak: false }
  const inbox = memberInboxDir(sandbox.cwd, runId, "rcl")
  const reservation = seedCrashReservation(inbox, STALE_TTL_MS * 2, "rcl")
  const before = inboxCounts(inbox)
  const reclaim = await runSenpi(senpiBin, sandbox, "boot a fresh session so session_start reclaims", NOOP_SCRIPT, undefined)
  writeFileSync(join(outDir, "reclaim-boot-stdout.json.log"), reclaim.stdout)
  const after = inboxCounts(inbox)
  writeFileSync(join(outDir, "reclaim-inbox.json"), `${JSON.stringify({ runId, reservation: reservation.messageId, before, after, restored: existsSync(reservation.restoredPath) }, null, 2)}\n`)
  return {
    reclaimReservationRestored: before.reserved === 1 && after.unread === 1 && existsSync(reservation.restoredPath),
    reclaimNoLeak: after.reserved === 0,
  }
}

function verdict(checks) {
  const failed = Object.entries(checks).filter(([, value]) => value !== true).map(([name]) => name)
  return { result: failed.length === 0 ? "PASS" : "FAIL", failed }
}

function teamMessageDeliveries(sendResults) {
  return sendResults.flatMap((result) => {
    if (result.details?.kind !== "team_message") return []
    const team = result.details.team
    return Array.isArray(team?.deliveries) ? team.deliveries : []
  })
}

function shutdownDetails(sendResults, kind) {
  return sendResults.map((result) => result.details).filter((details) => details?.kind === kind)
}

function taskOutputSnapshots(events) {
  return findResults(events, "task_output")
    .map((result) => result.details?.snapshot)
    .filter((snapshot) => snapshot !== undefined)
}

function createOutDir() {
  const configured = process.env.TEAM_E2E_OUT_DIR?.trim()
  if (configured) return { outDir: configured, cleanup: false }
  return { outDir: mkdtempSync(join(tmpdir(), "omo-senpi-team-e2e-")), cleanup: true }
}

async function main() {
  const senpiBin = resolveSenpi()
  const { outDir, cleanup } = createOutDir()
  mkdirSync(outDir, { recursive: true })
  try {
    const beforeCredential = credentialDigest(realSenpiAgentDir)
    const beforeWholeDir = digestDirectory(realSenpiAgentDir)
    if (senpiBin === null) {
      console.log(JSON.stringify({ result: "SKIP", reason: "senpi-binary-unavailable", credentialIsolationClean: true, leakedPids: 0 }))
      return
    }
    let checks = {}
    let leakedPids = 0
    try {
      const main = await runMain(senpiBin, outDir)
      const dura = await runDuraRevive(senpiBin, outDir)
      const reclaim = await runReclaim(senpiBin, outDir)
      checks = { ...main.checks, ...dura, ...reclaim }
    } finally {
      leakedPids = killGroups()
    }
    const afterCredential = credentialDigest(realSenpiAgentDir)
    const afterWholeDir = digestDirectory(realSenpiAgentDir)
    const { result, failed } = verdict(checks)
    const credentialIsolationClean = beforeCredential === afterCredential
    const wholeDirUnchanged = beforeWholeDir === afterWholeDir
    const payload = {
      result: result === "PASS" && credentialIsolationClean && leakedPids === 0 ? "PASS" : "FAIL",
      checks,
      failed,
      credentialIsolationClean,
      wholeDirUnchanged,
      leakedPids,
      outDir,
    }
    writeFileSync(join(outDir, "verdict.json"), `${JSON.stringify(payload, null, 2)}\n`)
    console.log(JSON.stringify(payload))
  } finally {
    if (cleanup) rmSync(outDir, { recursive: true, force: true })
  }
}

function selfTest() {
  const defaultOutDir = createOutDir()
  if (defaultOutDir.outDir.startsWith(scriptDir)) {
    throw new Error("self-test: team e2e default capture directory must not live under scripts/qa")
  }
  if (defaultOutDir.cleanup) rmSync(defaultOutDir.outDir, { recursive: true, force: true })
  const scriptSource = readFileSync(join(scriptDir, "team-e2e-scripts.mjs"), "utf8")
  if (droppedToolPattern().test(scriptSource)) {
    throw new Error("self-test: team e2e scripts still name a dropped tool")
  }
  const events = parseEvents(
    [
      JSON.stringify({ type: "tool_execution_end", toolName: "team_create", result: { content: [{ type: "text", text: "Created team 'e2eteam' (run-1) with 2 members." }], details: { kind: "created", team_run_id: "run-1", members: [{ name: "quick", status: "running" }, { name: "fixture", status: "running" }] } }, isError: false }),
      JSON.stringify({ type: "tool_execution_end", toolName: "task_send", result: { content: [], details: { kind: "team_message", team: { kind: "to_members", deliveries: [{ member: "quick", outcome: "revived" }] } } }, isError: false }),
    ].join("\n"),
  )
  const create = findResults(events, "team_create")[0]
  if (create?.details?.team_run_id !== "run-1") throw new Error("self-test: team_create details not parsed")
  if (create.isError !== false) throw new Error("self-test: top-level isError not read")
  const send = findResults(events, "task_send")
  if (teamMessageDeliveries(send)[0]?.outcome !== "revived") throw new Error("self-test: delivery outcome not parsed")
  const empty = inboxCounts(join(scriptDir, "does-not-exist"))
  if (empty.unread !== 0 || empty.reserved !== 0) throw new Error("self-test: missing inbox should be zeroed")
  if (verdict({ a: true, b: true }).result !== "PASS") throw new Error("self-test: all-true verdict should PASS")
  if (verdict({ a: true, b: false }).result !== "FAIL") throw new Error("self-test: any-false verdict should FAIL")
  if (resolveSenpi === undefined) throw new Error("self-test: resolveSenpi missing")
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

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.argv.includes("--self-test")) selfTest()
  else main()
}
