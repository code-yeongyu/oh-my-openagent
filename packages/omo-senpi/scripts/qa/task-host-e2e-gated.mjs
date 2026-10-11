// Scenarios that need an input this run may not have: a SECOND omob build of a newer epoch (E, E2, E3),
// a spec-less bare senpi of a newer epoch (E4), a pre-change engine CLI (H2), or a DAG-run driver (D).
// Each is implemented against its gate; without the gate it reports `skipped` with the exact command
// that would run it. Nothing here ever reports a pass it did not observe.
import { createScenarioSandbox } from "./task-host-e2e-sandbox.mjs"
import {
  cleanupScenario,
  daemonStatus,
  lastJsonLine,
  pidAlive,
  readTaskRecords,
  runBin,
  socketInode,
  spawnParent,
  waitFor,
} from "./task-host-e2e-process.mjs"
import { CHILD_BUSY, childSessionFiles, childrenSettled, hostConfig, jsonlLines, spawnScript, transcriptSizes } from "./task-host-e2e-support.mjs"
import { join } from "node:path"

const DRIVER = "node packages/omo-senpi/scripts/qa/task-host-e2e.mjs"

function skipped(scenario, title, reason, command) {
  return { scenario, title, status: "skipped", reason: `needs ${reason}`, command }
}

export function scenarioD() {
  return skipped(
    "D",
    "a DAG child has no `task` tool",
    "a DAG-run driver: a dag run is created by the plan/ULW surface, and `/dag` only lists runs, so a provider-scripted turn cannot start one",
    `${DRIVER} --bin <omob-daemon> --dag-plan <plan.json> --out <dir>`,
  )
}

export function scenarioH2(run) {
  if (run.legacyEngineCli !== undefined) return legacyClientFailClosed(run)
  return skipped(
    "H2",
    "legacy client fail-closed (E9)",
    "a pre-change engine CLI to call `host ensure` with: the mainline omob compiles its engine in and exposes no `host` subcommand",
    `${DRIVER} --bin <omob-daemon> --legacy-engine-cli <node-runnable pre-change senpi cli.js> --out <dir>`,
  )
}

export function scenarioE4(run) {
  if (run.newerSenpi !== undefined) return profileGuard(run)
  return skipped(
    "E4",
    "profile guard: a spec-less bare senpi of a NEWER epoch must reuse, never hand off",
    "a bare senpi binary whose engineOrdinal epoch is strictly newer than the build under test",
    `${DRIVER} --bin <omob-daemon> --newer-senpi <bare senpi bin> --out <dir>`,
  )
}

export async function scenarioHandoffSuite(run) {
  if (run.secondBin === undefined) {
    const reason = "a second omob build from a newer senpi ref (or the same VERSION with a newer BUILD_EPOCH)"
    const command = `${DRIVER} --bin <omob-daemon> --second-bin <newer omob> --out <dir>`
    return [
      skipped("E", "handoff: a newer build takes the socket while A's children run", reason, command),
      skipped("E2", "old-gen child mid-turn + parent resume: deferred/host_draining then attach", reason, command),
      skipped("E3", "handoff evidence: session paths, monotonic transcripts, one inode change, old pid gone", reason, command),
    ]
  }
  return await runHandoffSuite(run)
}

async function runHandoffSuite(run) {
  const sandbox = createScenarioSandbox(run, "sE", { omoConfig: hostConfig(), script: spawnScript(4, CHILD_BUSY) })
  const newer = { ...sandbox, bin: run.secondBin }
  const parent = spawnParent(sandbox, run.mockEntry, "run four children through a generation handoff")
  const started = await waitFor(() => {
    const records = readTaskRecords(sandbox)
    const running = records.filter((record) => record.status === "running")
    return running.length >= 4 || childrenSettled(records, 4) ? running : undefined
  }, { timeoutMs: 180_000, intervalMs: 500 })
  const records = started ?? readTaskRecords(sandbox)
  const socket = join(sandbox.agentDir, "rpc", "rpc.sock")
  const before = {
    status: daemonStatus(sandbox, { includeWorkers: true }).json,
    inode: socketInode(socket),
    sessionPaths: sessionPathSet(sandbox, records),
    transcripts: transcriptSizes(sandbox, records),
  }
  const handoff = runBin(newer, ["daemon", "run", "--json"], { timeoutMs: 240_000 })
  const handoffJson = lastJsonLine(handoff.stdout)
  const after = {
    status: daemonStatus(newer, { includeWorkers: true }).json,
    inode: socketInode(socket),
    sessionPaths: sessionPathSet(sandbox, records),
  }
  const grew = await waitFor(() => {
    const sizes = transcriptSizes(sandbox, records)
    return records.every((record) => sizes[record.task_id] >= before.transcripts[record.task_id]) &&
      records.some((record) => sizes[record.task_id] > before.transcripts[record.task_id])
      ? sizes
      : undefined
  }, { timeoutMs: 90_000, intervalMs: 1_000 })
  const oldPid = before.status?.pid
  const oldGone = await waitFor(() => (oldPid === undefined || !pidAlive(oldPid) ? true : undefined), { timeoutMs: 60_000, intervalMs: 1_000 })
  const reuse = runBin(sandbox, ["daemon", "run", "--json"], { timeoutMs: 240_000 })
  const resumed = runBin(sandbox, run.parentArgs(sandbox, "resume across the handoff"), { timeoutMs: 240_000 })
  const resumedRecords = readTaskRecords(sandbox)
  const writerCounts = Object.fromEntries(records.map((record) => [record.task_id, childSessionFiles(sandbox, record.task_id).length]))
  const lastLinesParse = records.every((record) =>
    childSessionFiles(sandbox, record.task_id).every((file) => {
      const lines = jsonlLines(file)
      if (lines.length === 0) return false
      try {
        JSON.parse(lines[lines.length - 1])
        return true
      } catch {
        return false
      }
    }))
  try {
    process.kill(-parent.child.pid, "SIGKILL")
  } catch {
    // already gone
  }
  const receipt = await cleanupScenario(sandbox, { hostPids: [oldPid, after.status?.pid].filter(Boolean) })
  const facts = {
    childrenBefore: records.length,
    handoffExit: handoff.status,
    handoffAction: handoffJson?.action ?? null,
    oldInstanceId: before.status?.instanceId ?? null,
    newInstanceId: after.status?.instanceId ?? null,
    socketInodeBefore: before.inode ?? null,
    socketInodeAfter: after.inode ?? null,
    sessionPathsEqual: sameSet(before.sessionPaths, after.sessionPaths),
    transcriptsMonotonic: grew !== undefined,
    lastLinesParse,
    oldPid: oldPid ?? null,
    oldPidGoneWithin60s: oldGone === true,
    olderBinaryRerunAction: lastJsonLine(reuse.stdout)?.action ?? null,
    resumeExit: resumed.status,
    resumeStatuses: resumedRecords.map((record) => record.status),
    jsonlWriterCountPerChild: writerCounts,
  }
  const handoffPass = handoffJson?.action === "handoff" && facts.newInstanceId !== facts.oldInstanceId && facts.olderBinaryRerunAction === "reuse"
  const evidencePass =
    facts.sessionPathsEqual && facts.transcriptsMonotonic && lastLinesParse &&
    facts.socketInodeBefore !== facts.socketInodeAfter && facts.oldPidGoneWithin60s
  const resumePass = resumed.status === 0 && Object.values(writerCounts).every((count) => count === 1)
  return [
    { scenario: "E", title: "handoff: a newer build takes the socket while children run", status: handoffPass ? "pass" : "fail", ...(handoffPass ? {} : { reason: `action=${facts.handoffAction} instance ${facts.oldInstanceId}->${facts.newInstanceId} rerun=${facts.olderBinaryRerunAction}` }), facts, receipt },
    { scenario: "E2", title: "old-gen child mid-turn + parent resume", status: resumePass ? "pass" : "fail", ...(resumePass ? {} : { reason: `resumeExit=${resumed.status} writers=${JSON.stringify(writerCounts)}` }), facts },
    { scenario: "E3", title: "handoff evidence", status: evidencePass ? "pass" : "fail", ...(evidencePass ? {} : { reason: `paths=${facts.sessionPathsEqual} monotonic=${facts.transcriptsMonotonic} inode ${facts.socketInodeBefore}->${facts.socketInodeAfter} oldGone=${facts.oldPidGoneWithin60s}` }), facts },
  ]
}

function sessionPathSet(sandbox, records) {
  return records.flatMap((record) => childSessionFiles(sandbox, record.task_id)).sort()
}

function sameSet(a, b) {
  return a.length === b.length && a.every((value, index) => value === b[index])
}

async function profileGuard(run) {
  const sandbox = createScenarioSandbox(run, "sE4", { omoConfig: hostConfig(), script: spawnScript(1, CHILD_BUSY, "pg") })
  const started = runBin(sandbox, ["daemon", "run", "--json"], { timeoutMs: 240_000 })
  const before = daemonStatus(sandbox).json
  const ensure = runBin({ ...sandbox, bin: run.newerSenpi }, ["host", "ensure", "--json", "--policy", "upgrade"], { timeoutMs: 240_000 })
  const json = lastJsonLine(ensure.stdout)
  const after = daemonStatus(sandbox).json
  const facts = {
    startAction: lastJsonLine(started.stdout)?.action ?? null,
    ensureExit: ensure.status,
    ensureAction: json?.action ?? null,
    ensureWarning: json?.warning ?? null,
    instanceUnchanged: before?.instanceId === after?.instanceId,
    pidUnchanged: before?.pid === after?.pid,
  }
  const pass = facts.ensureAction === "reuse" && facts.ensureWarning === "profile_mismatch_attached" && facts.instanceUnchanged && facts.pidUnchanged
  const receipt = await cleanupScenario(sandbox, { hostPids: [before?.pid].filter(Boolean) })
  return {
    scenario: "E4",
    title: "profile guard: a spec-less bare senpi of a NEWER epoch reuses, never hands off",
    status: pass ? "pass" : "fail",
    ...(pass ? {} : { reason: `action=${facts.ensureAction} warning=${facts.ensureWarning} instanceUnchanged=${facts.instanceUnchanged}` }),
    facts,
    receipt,
  }
}

async function legacyClientFailClosed(run) {
  const sandbox = createScenarioSandbox(run, "sH2", { omoConfig: hostConfig(), script: spawnScript(1, CHILD_BUSY, "fc") })
  const started = runBin(sandbox, ["daemon", "run", "--json"], { timeoutMs: 240_000 })
  const before = daemonStatus(sandbox).json
  const legacy = runBin({ ...sandbox, bin: "node" }, [run.legacyEngineCli, "host", "ensure", "--json"], { timeoutMs: 240_000 })
  const after = daemonStatus(sandbox).json
  const output = `${legacy.stdout}${legacy.stderr}`
  const facts = {
    startAction: lastJsonLine(started.stdout)?.action ?? null,
    legacyExit: legacy.status,
    incompatibleReported: /incompatible/i.test(output),
    outputExcerpt: output.trim().slice(0, 240),
    daemonPidAlive: before?.pid !== undefined && pidAlive(before.pid),
    generationUnchanged: before?.generation === after?.generation && before?.instanceId === after?.instanceId,
  }
  const pass = facts.incompatibleReported && legacy.status !== 0 && facts.daemonPidAlive && facts.generationUnchanged
  const receipt = await cleanupScenario(sandbox, { hostPids: [before?.pid].filter(Boolean) })
  return {
    scenario: "H2",
    title: "legacy client fail-closed (E9)",
    status: pass ? "pass" : "fail",
    ...(pass ? {} : { reason: `exit=${legacy.status} incompatible=${facts.incompatibleReported} pidAlive=${facts.daemonPidAlive} generationUnchanged=${facts.generationUnchanged}` }),
    facts,
    receipt,
  }
}
