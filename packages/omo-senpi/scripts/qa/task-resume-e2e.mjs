#!/usr/bin/env node
// Live quit->resume revival proof for in-process task children (plan todo 22), imported by
// task-e2e.mjs. Every run exits NATURALLY (print mode dispose = session_shutdown reason "quit"),
// so suspension - never crash recovery - is the path under test. Lanes: happy quit->resume,
// task_cancel, external kill (killed:true written to the record, exactly what an external killer
// persists), cap-1 LRU evict, and ttl_ms:1 expiry. Deliberate-stop lanes pair each doomed child
// with a finished witness so "not revived" is measured against a sibling that DID revive.
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"

import { createSandbox } from "./drive.mjs"
import {
  childSessionHasAssistant,
  childSessionText,
  findTaskByName,
  pollUntil,
  revivedAfterSuspend,
  seedResumeProject,
  sessionIdFromEvents,
  startResumeRun,
  taskEventText,
  taskStateDir,
} from "./resume-e2e-runtime.mjs"
import {
  CONTINUATION_MARKER,
  MIDTURN_CONTINUED_TOKEN,
  PING_TOKEN,
  PONG_TOKEN,
  UNRELATED_SESSION_SCRIPT,
  happyRun1Script,
  happyRun2Script,
  resumeOmoConfig,
} from "./task-resume-e2e-scenarios.mjs"
import { runTaskResumeFailureScenarios } from "./task-resume-failure-e2e.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const mockProviderEntry = join(scriptDir, "task-resume-e2e-mock-provider.ts")
const POLL_MS = 60_000

export const verdict = (ok) => (ok === true ? "PASS" : "FAIL")

export async function runTaskResumeScenarios({ senpiBin, checks, capture, pids, outDir }) {
  const ctx = { senpiBin, checks, capture, pids, outDir, sandboxes: [] }
  await runHappyLane(ctx)
  await runTaskResumeFailureScenarios(ctx)
  return ctx.sandboxes
}

export function startRun(ctx, sandbox, script, sessionId) {
  return startResumeRun({ senpiBin: ctx.senpiBin, sandbox, mockProviderEntry, script, sessionId, onPid: (pid) => ctx.pids.push(pid) })
}

export function writeLaneLog(ctx, name, result) {
  if (ctx.outDir === undefined) return
  mkdirSync(ctx.outDir, { recursive: true })
  writeFileSync(join(ctx.outDir, `${name}.stdout.json.log`), result.stdout)
  writeFileSync(join(ctx.outDir, `${name}.stderr.log`), result.stderr)
}

// The task_send result reports the revival of exactly the finished child's task id.
export function taskSendRevived(events, taskId) {
  return events.some(
    (event) => event?.type === "tool_execution_end"
      && event?.toolName === "task_send"
      && event?.result?.details?.kind === "revived"
      && event?.result?.details?.task_id === taskId,
  )
}

// Steerability is proven by the child's own persisted session carrying the unique probe AND its
// response text, never by residency alone (misleading_success_output probe).

export function witnessRevived(cwd, name) {
  const witness = findTaskByName(cwd, name)
  return witness !== undefined && revivedAfterSuspend(taskEventText(cwd, witness.task_id))
}

async function runHappyLane(ctx) {
  const sandbox = createSandbox()
  ctx.sandboxes.push(sandbox)
  seedResumeProject(sandbox, resumeOmoConfig())
  const sentinel1 = join(sandbox.root, "happy-release-1")
  const run1 = startRun(ctx, sandbox, happyRun1Script(sentinel1))
  const seeded = await pollUntil(
    () => ({
      midAssistant: childSessionHasAssistant(sandbox.cwd, findTaskByName(sandbox.cwd, "midchild")?.task_id ?? ""),
      finCompleted: findTaskByName(sandbox.cwd, "finchild")?.status === "completed",
    }),
    (v) => v.midAssistant && v.finCompleted,
    POLL_MS,
  )
  writeFileSync(sentinel1, "go\n")
  const result1 = await run1.completion
  writeLaneLog(ctx, "resume-happy-run1", result1)
  const mid = findTaskByName(sandbox.cwd, "midchild")
  const fin = findTaskByName(sandbox.cwd, "finchild")
  ctx.checks.resume_spawn_children = verdict(result1.status === 0 && seeded.midAssistant && seeded.finCompleted && mid !== undefined && fin !== undefined)
  ctx.checks.resume_quit_suspends_both = verdict(
    mid?.status === "running" && mid?.residency_state === "persisted_only" && mid?.host_pid === undefined
    && fin?.status === "completed" && fin?.residency_state === "persisted_only",
  )
  const sessionId = sessionIdFromEvents(result1.events)
  const sentinel2 = join(sandbox.root, "happy-release-2")
  const run2 = startRun(ctx, sandbox, happyRun2Script(sentinel2), sessionId)
  const revived = await pollUntil(
    () => ({
      midResident: findTaskByName(sandbox.cwd, "midchild")?.residency_state === "resident",
      finResident: findTaskByName(sandbox.cwd, "finchild")?.residency_state === "resident",
      midContinued: childSessionText(sandbox.cwd, mid?.task_id ?? "").includes(MIDTURN_CONTINUED_TOKEN),
      finPong: childSessionText(sandbox.cwd, fin?.task_id ?? "").includes(PONG_TOKEN),
    }),
    (v) => v.midResident && v.finResident && v.midContinued && v.finPong,
    POLL_MS,
  )
  writeFileSync(sentinel2, "go\n")
  const result2 = await run2.completion
  writeLaneLog(ctx, "resume-happy-run2", result2)
  const midSession = childSessionText(sandbox.cwd, mid?.task_id ?? "")
  const finSession = childSessionText(sandbox.cwd, fin?.task_id ?? "")
  ctx.checks.resume_revived_resident = verdict(revived.midResident && revived.finResident)
  ctx.checks.resume_midturn_continuation = verdict(midSession.includes(CONTINUATION_MARKER) && midSession.includes(MIDTURN_CONTINUED_TOKEN))
  ctx.checks.resume_finished_no_nudge = verdict(finSession.length > 0 && !finSession.includes(CONTINUATION_MARKER))
  ctx.checks.resume_finished_steerable = verdict(
    revived.finPong
    && finSession.includes(PING_TOKEN)
    && finSession.includes(PONG_TOKEN)
    && taskSendRevived(result2.events, fin?.task_id ?? ""),
  )
  const logsBefore = { mid: taskEventText(sandbox.cwd, mid?.task_id ?? ""), fin: taskEventText(sandbox.cwd, fin?.task_id ?? "") }
  const run3 = startRun(ctx, sandbox, UNRELATED_SESSION_SCRIPT)
  const result3 = await run3.completion
  writeLaneLog(ctx, "resume-happy-run3", result3)
  ctx.checks.resume_unrelated_no_revive = verdict(
    result3.status === 0
    && taskEventText(sandbox.cwd, mid?.task_id ?? "") === logsBefore.mid
    && taskEventText(sandbox.cwd, fin?.task_id ?? "") === logsBefore.fin
    && findTaskByName(sandbox.cwd, "midchild")?.residency_state === "persisted_only"
    && findTaskByName(sandbox.cwd, "finchild")?.residency_state === "persisted_only",
  )
  ctx.capture.resumeHappy = { sessionId, midTask: mid?.task_id, finTask: fin?.task_id }
}
