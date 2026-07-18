#!/usr/bin/env node
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
  seedCrashReservation,
} from "./team-e2e-support.mjs"
import { analyzeMain, teamMessageEnqueues, verdict } from "./team-e2e-analysis.mjs"
import { evaluateCrashRecovery, runCrashRestartScenario } from "./team-e2e-crash.mjs"
import { cleanupProcessGroups, pollUntil, startSenpiRun } from "./team-e2e-runtime.mjs"
import { LEAD_SCRIPT, DURA_REVIVE_SCRIPT, DURA_SEED_SCRIPT, NOOP_SCRIPT } from "./team-e2e-scripts.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const mockProviderEntry = join(scriptDir, "team-e2e-mock-provider.ts")
const realSenpiAgentDir = join(homedir(), ".senpi", "agent")
const STALE_TTL_MS = 10 * 60 * 1000
const DURA_DRAIN_TIMEOUT_MS = 30_000
const DURA_EXPECTED_PROCESSED = 3

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

function startRun(input) {
  return startSenpiRun({
    ...input,
    mockProviderEntry,
    parseEvents,
    onPid: (pid) => spawnedGroups.add(pid),
  })
}

function runSenpi(input) {
  return startRun(input).completion
}

function killGroups() {
  return cleanupProcessGroups(spawnedGroups)
}

async function runMain(senpiBin, outDir) {
  const sandbox = createSandbox()
  const obsDir = resolve(outDir, "main-obs")
  seedProject(sandbox)
  const run = await runSenpi({ senpiBin, sandbox, prompt: "drive the full team e2e lifecycle", script: LEAD_SCRIPT, obsDir })
  writeFileSync(join(outDir, "main-stdout.json.log"), run.stdout)
  writeFileSync(join(outDir, "main-stderr.log"), run.stderr)
  return { checks: await analyzeMain(run, sandbox, obsDir), exit: run.status }
}

async function runDuraRevive(senpiBin, outDir) {
  const sandbox = createSandbox()
  const obsDir = resolve(outDir, "dura-obs")
  seedProject(sandbox)
  const active = startRun({ senpiBin, sandbox, prompt: "durability revive drain drive", script: DURA_REVIVE_SCRIPT, obsDir })
  let state
  try {
    state = await pollUntil(
      () => Promise.resolve(readDuraInboxState(sandbox.cwd)),
      (value) => value.counts.unread === 0
        && value.counts.reserved === 0
        && value.counts.processed >= DURA_EXPECTED_PROCESSED,
      DURA_DRAIN_TIMEOUT_MS,
    )
  } finally {
    active.kill()
  }
  const run = await active.completion
  writeFileSync(join(outDir, "dura-stdout.json.log"), run.stdout)
  writeFileSync(join(outDir, "dura-stderr.log"), run.stderr)
  const send = findResults(run.events, "task_send")
  writeFileSync(join(outDir, "dura-inbox.json"), `${JSON.stringify(state, null, 2)}\n`)
  return {
    duraBacklogSeeded: readText(join(obsDir, "dura-seeded.txt")) !== undefined,
    duraMessagesEnqueued: teamMessageEnqueues(send).length >= 2,
    duraUnreadDrainedToZero:
      state.counts.unread === 0
      && state.counts.reserved === 0
      && state.counts.processed >= DURA_EXPECTED_PROCESSED,
  }
}

function readDuraInboxState(cwd) {
  const runId = discoverRunIds(cwd)[0]
  const counts = runId === undefined
    ? { unread: -1, reserved: -1, processed: -1 }
    : inboxCounts(memberInboxDir(cwd, runId, "dura"))
  return { runId, counts }
}

async function runReclaim(senpiBin, outDir) {
  const sandbox = createSandbox()
  seedProject(sandbox)
  const seed = await runSenpi({ senpiBin, sandbox, prompt: "seed an active team for reclaim", script: DURA_SEED_SCRIPT })
  writeFileSync(join(outDir, "reclaim-seed-stdout.json.log"), seed.stdout)
  const runId = discoverRunIds(sandbox.cwd)[0]
  if (runId === undefined) return { reclaimReservationRestored: false, reclaimNoLeak: false }
  const inbox = memberInboxDir(sandbox.cwd, runId, "rcl")
  const reservation = seedCrashReservation(inbox, STALE_TTL_MS * 2, "rcl")
  const before = inboxCounts(inbox)
  const reclaim = await runSenpi({ senpiBin, sandbox, prompt: "boot a fresh session so session_start reclaims", script: NOOP_SCRIPT })
  writeFileSync(join(outDir, "reclaim-boot-stdout.json.log"), reclaim.stdout)
  const after = inboxCounts(inbox)
  writeFileSync(join(outDir, "reclaim-inbox.json"), `${JSON.stringify({ runId, reservation: reservation.messageId, before, after, restored: existsSync(reservation.restoredPath) }, null, 2)}\n`)
  return {
    reclaimReservationRestored: before.reserved === 1 && after.unread === 1 && existsSync(reservation.restoredPath),
    reclaimNoLeak: after.reserved === 0,
  }
}

export function createOutDir(configured = process.env.TEAM_E2E_OUT_DIR) {
  const requested = configured?.trim()
  if (requested) return { outDir: resolve(requested), cleanup: false }
  return { outDir: resolve(mkdtempSync(join(tmpdir(), "omo-senpi-team-e2e-"))), cleanup: true }
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
      const crash = await runCrashRestartScenario({ senpiBin, outDir, createSandbox, seedProject, startRun })
      checks = { ...main.checks, ...dura, ...reclaim, ...crash }
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
  if (DURA_REVIVE_SCRIPT.lead.at(-1)?.type !== "hang") {
    throw new Error("self-test: durability drive must remain alive while inbox drain is observed")
  }
  const events = parseEvents(
    [
      JSON.stringify({ type: "tool_execution_end", toolName: "team_create", result: { content: [{ type: "text", text: "Created team 'e2eteam' (run-1) with 2 members." }], details: { kind: "created", team_run_id: "run-1", members: [{ name: "quick", status: "running" }, { name: "fixture", status: "running" }] } }, isError: false }),
      JSON.stringify({ type: "tool_execution_end", toolName: "task_send", result: { content: [], details: { kind: "team_message", team: { kind: "to_members", message_id: "msg-1", recipients: ["quick"] } } }, isError: false }),
    ].join("\n"),
  )
  const create = findResults(events, "team_create")[0]
  if (create?.details?.team_run_id !== "run-1") throw new Error("self-test: team_create details not parsed")
  if (create.isError !== false) throw new Error("self-test: top-level isError not read")
  const send = findResults(events, "task_send")
  const enqueue = teamMessageEnqueues(send)[0]
  if (enqueue?.messageId !== "msg-1" || enqueue.recipients[0] !== "quick") {
    throw new Error("self-test: pull enqueue details not parsed")
  }
  const crashChecks = evaluateCrashRecovery({
    target: { ready: true },
    before: { processedExists: false, eventCount: 0 },
    memberKilled: true,
    parentKilled: true,
    restartStatus: 0,
    recovery: { processedExists: true, processedCount: 1, eventCount: 1, envelopeCount: 1 },
  })
  if (!Object.values(crashChecks).every((value) => value === true)) {
    throw new Error("self-test: exact-once crash recovery should pass")
  }
  const duplicateEnvelope = evaluateCrashRecovery({
    target: { ready: true },
    before: { processedExists: false, eventCount: 0 },
    memberKilled: true,
    parentKilled: true,
    restartStatus: 0,
    recovery: { processedExists: true, processedCount: 1, eventCount: 1, envelopeCount: 2 },
  })
  if (duplicateEnvelope.crashSessionEnvelopeExactlyOnce !== false) {
    throw new Error("self-test: duplicate crash envelope must fail")
  }
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
