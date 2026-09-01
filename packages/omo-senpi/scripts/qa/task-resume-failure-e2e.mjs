#!/usr/bin/env node
// Deliberate-stop lanes of the quit->resume proof (plan todo 22), split from task-resume-e2e.mjs
// under the 250 pure-LOC ceiling. Each lane pairs its doomed child with a finished witness so
// "not revived" is measured against a sibling that DID revive in the same resumed process.
import { readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { createSandbox } from "./drive.mjs"
import {
  childSessionHasAssistant,
  childSessionText,
  findTaskByName,
  pollUntil,
  recordFileExists,
  seedResumeProject,
  sessionIdFromEvents,
  taskEventText,
  taskStateDir,
} from "./resume-e2e-runtime.mjs"
import {
  MIDTURN_CONTINUED_TOKEN,
  UNRELATED_SESSION_SCRIPT,
  cancelRun1Script,
  killRun1Script,
  lruRun1Script,
  resumeOmoConfig,
  resumeProbeScript,
  ttlRun1Script,
} from "./task-resume-e2e-scenarios.mjs"
import { startRun, verdict, witnessRevived, writeLaneLog } from "./task-resume-e2e.mjs"

const POLL_MS = 60_000

export async function runTaskResumeFailureScenarios(ctx) {
  await runCancelLane(ctx)
  await runKillLane(ctx)
  await runLruLane(ctx)
  await runTtlLane(ctx)
}

async function runCancelLane(ctx) {
  const sandbox = createSandbox()
  ctx.sandboxes.push(sandbox)
  seedResumeProject(sandbox, resumeOmoConfig())
  const sentinel1 = join(sandbox.root, "cancel-release-1")
  const run1 = startRun(ctx, sandbox, cancelRun1Script(sentinel1))
  const seeded = await pollUntil(
    () => ({
      cancelled: findTaskByName(sandbox.cwd, "cancelchild")?.status === "cancelled",
      witnessDone: findTaskByName(sandbox.cwd, "cancelwitness")?.status === "completed",
    }),
    (v) => v.cancelled && v.witnessDone,
    POLL_MS,
  )
  writeFileSync(sentinel1, "go\n")
  const result1 = await run1.completion
  writeLaneLog(ctx, "resume-cancel-run1", result1)
  ctx.checks.resume_cancel_setup = verdict(result1.status === 0 && seeded.cancelled && seeded.witnessDone)
  const cancelTask = findTaskByName(sandbox.cwd, "cancelchild")
  const logBefore = taskEventText(sandbox.cwd, cancelTask?.task_id ?? "")
  const sentinel2 = join(sandbox.root, "cancel-release-2")
  const run2 = startRun(ctx, sandbox, resumeProbeScript(sentinel2), sessionIdFromEvents(result1.events))
  const witnessUp = await pollUntil(() => witnessRevived(sandbox.cwd, "cancelwitness"), (v) => v === true, POLL_MS)
  writeFileSync(sentinel2, "go\n")
  const result2 = await run2.completion
  writeLaneLog(ctx, "resume-cancel-run2", result2)
  const cancelAfter = findTaskByName(sandbox.cwd, "cancelchild")
  ctx.checks.resume_cancel_not_revived = verdict(
    result2.status === 0
    && cancelTask !== undefined
    && cancelAfter?.status === "cancelled"
    && cancelAfter?.residency_state !== "resident"
    && taskEventText(sandbox.cwd, cancelTask.task_id) === logBefore
    && witnessUp === true,
  )
}

async function runKillLane(ctx) {
  const sandbox = createSandbox()
  ctx.sandboxes.push(sandbox)
  seedResumeProject(sandbox, resumeOmoConfig())
  const sentinel1 = join(sandbox.root, "kill-release-1")
  const run1 = startRun(ctx, sandbox, killRun1Script(sentinel1))
  const seeded = await pollUntil(
    () => ({
      targetDone: findTaskByName(sandbox.cwd, "killchild")?.status === "completed",
      witnessDone: findTaskByName(sandbox.cwd, "killwitness")?.status === "completed",
    }),
    (v) => v.targetDone && v.witnessDone,
    POLL_MS,
  )
  writeFileSync(sentinel1, "go\n")
  const result1 = await run1.completion
  writeLaneLog(ctx, "resume-kill-run1", result1)
  const killTask = findTaskByName(sandbox.cwd, "killchild")
  ctx.checks.resume_kill_setup = verdict(result1.status === 0 && seeded.targetDone && seeded.witnessDone && killTask !== undefined)
  const logBefore = taskEventText(sandbox.cwd, killTask?.task_id ?? "")
  if (killTask !== undefined) {
    const recordPath = join(taskStateDir(sandbox.cwd), "tasks", `${killTask.task_id}.json`)
    const record = JSON.parse(readFileSync(recordPath, "utf8"))
    record.killed = true
    writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`)
  }
  const sentinel2 = join(sandbox.root, "kill-release-2")
  const run2 = startRun(ctx, sandbox, resumeProbeScript(sentinel2), sessionIdFromEvents(result1.events))
  const witnessUp = await pollUntil(() => witnessRevived(sandbox.cwd, "killwitness"), (v) => v === true, POLL_MS)
  writeFileSync(sentinel2, "go\n")
  const result2 = await run2.completion
  writeLaneLog(ctx, "resume-kill-run2", result2)
  const killAfter = findTaskByName(sandbox.cwd, "killchild")
  ctx.checks.resume_killed_not_revived = verdict(
    result2.status === 0
    && killAfter?.killed === true
    && killAfter?.residency_state === "persisted_only"
    && taskEventText(sandbox.cwd, killTask?.task_id ?? "") === logBefore
    && witnessUp === true,
  )
}

async function runLruLane(ctx) {
  const sandbox = createSandbox()
  ctx.sandboxes.push(sandbox)
  seedResumeProject(sandbox, resumeOmoConfig({ residency_max_children: 1 }))
  const sentinel1 = join(sandbox.root, "lru-release-1")
  const run1 = startRun(ctx, sandbox, lruRun1Script(sandbox.cwd, sentinel1))
  const seeded = await pollUntil(
    () => ({
      evicted: findTaskByName(sandbox.cwd, "lruone")?.residency_state === "evicted",
      newestDone: findTaskByName(sandbox.cwd, "lrutwo")?.status === "completed",
    }),
    (v) => v.evicted && v.newestDone,
    POLL_MS,
  )
  writeFileSync(sentinel1, "go\n")
  const result1 = await run1.completion
  writeLaneLog(ctx, "resume-lru-run1", result1)
  const lruOne = findTaskByName(sandbox.cwd, "lruone")
  ctx.checks.resume_lru_setup = verdict(result1.status === 0 && seeded.evicted && seeded.newestDone && lruOne !== undefined)
  const logBefore = taskEventText(sandbox.cwd, lruOne?.task_id ?? "")
  const sentinel2 = join(sandbox.root, "lru-release-2")
  const run2 = startRun(ctx, sandbox, resumeProbeScript(sentinel2), sessionIdFromEvents(result1.events))
  const newestUp = await pollUntil(() => witnessRevived(sandbox.cwd, "lrutwo"), (v) => v === true, POLL_MS)
  writeFileSync(sentinel2, "go\n")
  const result2 = await run2.completion
  writeLaneLog(ctx, "resume-lru-run2", result2)
  ctx.checks.resume_lru_evict_not_revived = verdict(
    result2.status === 0
    && findTaskByName(sandbox.cwd, "lruone")?.residency_state === "evicted"
    && taskEventText(sandbox.cwd, lruOne?.task_id ?? "") === logBefore
    && newestUp === true,
  )
}

async function runTtlLane(ctx) {
  const sandbox = createSandbox()
  ctx.sandboxes.push(sandbox)
  seedResumeProject(sandbox, resumeOmoConfig({ ttl_ms: 1 }))
  const sentinel1 = join(sandbox.root, "ttl-release-1")
  const run1 = startRun(ctx, sandbox, ttlRun1Script(sandbox.cwd, sentinel1))
  const seeded = await pollUntil(
    () => ({
      targetDone: findTaskByName(sandbox.cwd, "ttlchild")?.status === "completed",
      witnessAssistant: childSessionHasAssistant(sandbox.cwd, findTaskByName(sandbox.cwd, "ttlwitness")?.task_id ?? ""),
    }),
    (v) => v.targetDone && v.witnessAssistant,
    POLL_MS,
  )
  writeFileSync(sentinel1, "go\n")
  const result1 = await run1.completion
  writeLaneLog(ctx, "resume-ttl-run1", result1)
  const ttlTask = findTaskByName(sandbox.cwd, "ttlchild")
  ctx.checks.resume_ttl_setup = verdict(result1.status === 0 && seeded.targetDone && seeded.witnessAssistant && ttlTask !== undefined)
  const run2 = startRun(ctx, sandbox, UNRELATED_SESSION_SCRIPT)
  const result2 = await run2.completion
  writeLaneLog(ctx, "resume-ttl-run2", result2)
  const expunged = ttlTask !== undefined && !recordFileExists(sandbox.cwd, ttlTask.task_id) && taskEventText(sandbox.cwd, ttlTask.task_id) === ""
  ctx.checks.resume_ttl_expunged = verdict(result2.status === 0 && expunged && findTaskByName(sandbox.cwd, "ttlwitness") !== undefined)
  const sentinel3 = join(sandbox.root, "ttl-release-3")
  const run3 = startRun(ctx, sandbox, resumeProbeScript(sentinel3), sessionIdFromEvents(result1.events))
  const continued = await pollUntil(
    () => childSessionText(sandbox.cwd, findTaskByName(sandbox.cwd, "ttlwitness")?.task_id ?? "").includes(MIDTURN_CONTINUED_TOKEN),
    (v) => v === true,
    POLL_MS,
  )
  writeFileSync(sentinel3, "go\n")
  const result3 = await run3.completion
  writeLaneLog(ctx, "resume-ttl-run3", result3)
  ctx.checks.resume_ttl_not_revived = verdict(
    result3.status === 0
    && ttlTask !== undefined
    && !recordFileExists(sandbox.cwd, ttlTask.task_id)
    && continued === true,
  )
}
