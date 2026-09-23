// Scenario J (omo#8563): the daemon host dies under running children and the children finish anyway.
//
// Four children are mid-turn on the shared daemon. The host PROCESS (the supervisor's child) is
// killed with SIGSEGV - the exact way three production hosts died on 2026-09-21. The supervisor
// exits with it and the socket entry goes away. The parent's next ensure starts a new daemon; each
// child handle reattaches to it, reopens its own session path there, and re-prompts its interrupted
// turn once. The children then complete: every task record reaches `completed`, no record is
// `error`/`lost`, no `transport_gone` reaches the parent as a failure, and every child transcript
// carries exactly one continuation prompt.
import { writeFileSync } from "node:fs"
import { join } from "node:path"

import { generationHostPid, generationHostRecord } from "./task-host-e2e-daemon-state.mjs"
import { observeState, stopParent } from "./task-host-e2e-events.mjs"
import { cleanupScenario, daemonStatus, pidAlive, readTaskRecords, spawnParent, waitFor } from "./task-host-e2e-process.mjs"
import { createScenarioSandbox } from "./task-host-e2e-sandbox.mjs"
import {
  CHILD_DONE,
  childSessionFiles,
  childrenSettled,
  hostConfig,
  holdParent,
  jsonlLines,
  spawnScript,
  transcriptSizes,
} from "./task-host-e2e-support.mjs"

const REATTACH_TAG = "[host-session-reattach]"
const CHILDREN = 4

/** A child that stays mid-turn until the driver releases it, then finishes. */
function heldChildSteps() {
  return [
    {
      type: "tool_call",
      name: "eval",
      arguments: {
        language: "js",
        summary: "remain mid-turn until the host has been killed and replaced",
        timeout: 660,
        code: `var fs = await import("node:fs"); await new Promise((resolve, reject) => {
          var finish = () => { if (!fs.existsSync(".omo/reattach-release")) return;
            clearTimeout(timer); watcher.close(); resolve(); };
          var watcher = fs.watch(".omo", finish);
          var timer = setTimeout(() => { watcher.close(); reject(new Error("reattach release missing")); }, 600000);
          finish();
        });`,
      },
    },
    ...CHILD_DONE,
  ]
}

function countLines(sandbox, taskId, predicate) {
  return childSessionFiles(sandbox, taskId)
    .flatMap(jsonlLines)
    .filter((line) => {
      try {
        return predicate(JSON.parse(line), line)
      } catch {
        return false
      }
    }).length
}

export async function scenarioJ(run) {
  const sandbox = createScenarioSandbox(run, "sJ", {
    omoConfig: hostConfig(),
    script: holdParent(spawnScript(CHILDREN, heldChildSteps(), "j")),
  })
  let parent
  const started = await observeState(
    sandbox.root,
    () => {
      const records = readTaskRecords(sandbox)
      const sizes = transcriptSizes(sandbox, records)
      const allRunning =
        records.length === CHILDREN && records.every((record) => record.status === "running" && sizes[record.task_id] > 0)
      return allRunning || childrenSettled(records, CHILDREN) ? records : undefined
    },
    { trigger: () => { parent = spawnParent(sandbox, run.mockEntry, "run four children through a host death", { capture: true }) } },
  )
  const records = started ?? readTaskRecords(sandbox)
  const hostBefore = generationHostRecord(sandbox.agentDir)
  const hostPidBefore = generationHostPid(sandbox.agentDir)
  const statusBefore = daemonStatus(sandbox, { includeWorkers: true }).json

  // The way production hosts died: the runtime segfaults, the supervisor sees a signal exit.
  let killed = false
  if (hostPidBefore !== undefined) {
    try {
      process.kill(hostPidBefore, "SIGSEGV")
      killed = true
    } catch {
      killed = false
    }
  }
  const hostGone = killed ? await waitFor(() => (pidAlive(hostPidBefore) ? undefined : true), { timeoutMs: 30_000 }) : undefined

  // A new generation must be serving the socket before the children can be released, otherwise the
  // release lands on nothing; the handles reattach on their own (backoff up to ~15 s).
  const replaced = await waitFor(
    () => {
      const record = generationHostRecord(sandbox.agentDir)
      return record !== undefined && record.pid !== null && record.pid !== hostPidBefore && pidAlive(record.pid) ? record : undefined
    },
    { timeoutMs: 120_000, intervalMs: 500 },
  )
  // Every child must be re-prompted (its turn was in flight on the dead host) before it is released.
  const reprompted = await waitFor(
    () => {
      const counts = records.map((record) => countLines(sandbox, record.task_id, (row, line) => row.message?.role === "user" && line.includes(REATTACH_TAG)))
      return counts.every((count) => count >= 1) ? counts : undefined
    },
    { timeoutMs: 120_000, intervalMs: 500 },
  )
  writeFileSync(join(sandbox.cwd, ".omo", "reattach-release"), "release\n")

  const settled = await observeState(sandbox.root, () => {
    const now = readTaskRecords(sandbox).filter((record) => records.some((old) => old.task_id === record.task_id))
    return childrenSettled(now, CHILDREN) ? now : undefined
  })
  const finalRecords = settled ?? readTaskRecords(sandbox)
  writeFileSync(join(sandbox.cwd, ".omo", "parent-release"), "release\n")
  await stopParent(parent)

  const continuationPrompts = Object.fromEntries(
    records.map((record) => [
      record.task_id,
      countLines(sandbox, record.task_id, (row, line) => row.message?.role === "user" && line.includes(REATTACH_TAG)),
    ]),
  )
  const parentOutput = `${parent?.chunks.stdout ?? ""}\n${parent?.chunks.stderr ?? ""}`
  const facts = {
    childrenStarted: records.filter((record) => record.status === "running").length,
    hostBefore,
    hostKilled: killed,
    hostGone: hostGone === true,
    hostAfter: replaced ?? generationHostRecord(sandbox.agentDir) ?? null,
    hostReplaced: replaced !== undefined,
    sessionsBeforeKill: statusBefore?.sessions ?? null,
    repromptedBeforeRelease: reprompted !== undefined,
    continuationPromptsPerChild: continuationPrompts,
    exactlyOneContinuationEach: records.length === CHILDREN && Object.values(continuationPrompts).every((count) => count === 1),
    finalStatuses: Object.fromEntries(finalRecords.map((record) => [record.task_id, record.status])),
    childrenCompleted: finalRecords.filter((record) => record.status === "completed").length,
    childrenFailed: finalRecords.filter((record) => record.status === "error" || record.status === "lost").length,
    parentSawTransportGoneFailure: /task_error[^\n]*transport_gone|"status":"failed"[^\n]*transport_gone/.test(parentOutput),
    parentReattachLines: (parentOutput.match(/host session reattach/g) ?? []).length,
  }
  const pass =
    facts.childrenStarted === CHILDREN &&
    facts.hostKilled &&
    facts.hostGone &&
    facts.hostReplaced &&
    facts.exactlyOneContinuationEach &&
    facts.childrenCompleted === CHILDREN &&
    facts.childrenFailed === 0 &&
    !facts.parentSawTransportGoneFailure
  const receipt = await cleanupScenario(sandbox, {
    hostPids: [hostPidBefore, facts.hostAfter?.pid, daemonStatus(sandbox).json?.pid].filter((pid) => typeof pid === "number"),
  })
  return {
    scenario: "J",
    title: "host death under four mid-turn children: reattach to the new generation and finish",
    status: pass ? "pass" : "fail",
    reason: `started=${facts.childrenStarted} killed=${facts.hostKilled} gone=${facts.hostGone} replaced=${facts.hostReplaced} oneContinuationEach=${facts.exactlyOneContinuationEach} completed=${facts.childrenCompleted} failed=${facts.childrenFailed} parentTransportGone=${facts.parentSawTransportGoneFailure}`,
    facts,
    receipt,
  }
}
