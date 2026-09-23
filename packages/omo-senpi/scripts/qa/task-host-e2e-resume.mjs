import { readdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { createScenarioSandbox, writeMockScript } from "./task-host-e2e-sandbox.mjs"
import { cleanupScenario, daemonStatus, readTaskRecords, spawnParent } from "./task-host-e2e-process.mjs"
import { observeState, stopParent } from "./task-host-e2e-events.mjs"
import { resumePass } from "./task-host-e2e-gates.mjs"
import { reattachedTaskIds, resumeReleaseStep } from "./task-host-e2e-resume-evidence.mjs"
import {
  CHILD_DONE, CHILD_PROMPT, childSessionFiles, childStartDiagnosis,
  childrenSettled, hostConfig, holdParent, jsonlLines, spawnScript, transcriptSizes,
} from "./task-host-e2e-support.mjs"

export async function scenarioB(run) {
  // The child waits for an explicit release, not for enough seconds to let a loaded parent die.
  const childSteps = [{
    type: "tool_call", name: "eval", arguments: {
      language: "js", summary: "wait for the detach test release",
      code: `var fs = await import("node:fs"); await new Promise((resolve, reject) => {
        var finish = () => { if (!fs.existsSync(".omo/detach-release")) return;
          clearTimeout(timer); watcher.close(); resolve(); };
        var watcher = fs.watch(".omo", finish);
        var timer = setTimeout(() => { watcher.close(); reject(new Error("detach release missing")); }, 600000);
        finish();
      });`,
    },
  }, {
    type: "tool_call", name: "eval", arguments: {
      language: "js", summary: "remain mid-turn until the parent reattaches", timeout: 660,
      code: `await new Promise((resolve, reject) => {
        var finish = () => { if (!fs.existsSync(".omo/resume-release")) return;
          clearTimeout(timer); watcher.close(); resolve(); };
        var watcher = fs.watch(".omo", finish);
        var timer = setTimeout(() => { watcher.close(); reject(new Error("resume release missing")); }, 600000);
        finish();
      });`,
    },
  }, ...CHILD_DONE]
  const sandbox = createScenarioSandbox(run, "sB", { omoConfig: hostConfig(), script: holdParent(spawnScript(4, childSteps)) })
  let parent
  const started = await observeState(sandbox.root, () => {
    const records = readTaskRecords(sandbox)
    const sizes = transcriptSizes(sandbox, records)
    return records.length === 4 && records.every((r) => r.status === "running" && sizes[r.task_id] > 0) ||
      childrenSettled(records, 4) ? records : undefined
  }, { trigger: () => { parent = spawnParent(sandbox, run.mockEntry, "detach with four children mid turn", { capture: true }) } })
  const records = started ?? readTaskRecords(sandbox)
  const before = transcriptSizes(sandbox, records)
  await stopParent(parent)
  const grew = await observeState(sandbox.root, () => {
    const after = transcriptSizes(sandbox, records)
    return records.length === 4 && records.every((r) => after[r.task_id] > before[r.task_id]) ? after : undefined
  }, { trigger: () => writeFileSync(join(sandbox.cwd, ".omo", "detach-release"), "release\n") })
  const sessionId = records[0]?.parent_session_id
  const sessionName = sessionId && readdirSync(sandbox.sessionDir).find((file) => file.endsWith(".jsonl") && file.includes(sessionId))
  const session = sessionName && join(sandbox.sessionDir, sessionName)
  const resumeMarker = "detached children reattached"
  const linesBeforeResume = session ? jsonlLines(session).length : 0
  writeMockScript(sandbox, {
    parentSteps: [
      ...records.map((r) => ({ type: "tool_call", name: "task_output", arguments: { task_id: r.task_id, mode: "status" } })),
      resumeReleaseStep(session, records.map((record) => record.task_id), sessionId, linesBeforeResume),
      { type: "text", text: resumeMarker },
    ],
    childSteps,
  })
  let resumed
  const resumeRows = () => session ? jsonlLines(session).slice(linesBeforeResume).map(JSON.parse) : []
  const readbacks = () => reattachedTaskIds(resumeRows(), records.map((record) => record.task_id), sessionId)
  const parentAnswered = () => session && jsonlLines(session).slice(linesBeforeResume).some((line) => {
    const row = JSON.parse(line)
    return row.message?.role === "assistant" && row.message?.content?.some((part) => part.type === "text" && part.text === resumeMarker)
  })
  const acknowledged = session && await observeState(sandbox.root, () => {
    const done = readTaskRecords(sandbox).filter((r) => records.some((old) => old.task_id === r.task_id))
    return parentAnswered() && (childrenSettled(done, 4) || readbacks().length !== 4) ? done : undefined
  }, { trigger: () => { resumed = spawnParent(sandbox, run.mockEntry, "resume the detached children", { capture: true, session }) } })
  const replays = Object.fromEntries(records.map((record) => [
    record.task_id,
    childSessionFiles(sandbox, record.task_id).flatMap(jsonlLines)
      .filter((line) => {
        const row = JSON.parse(line)
        return row.message?.role === "user" && line.includes(CHILD_PROMPT)
      }).length,
  ]))
  const facts = {
    childrenStarted: records.filter((r) => r.status === "running").length,
    reattachedChildren: readbacks().length,
    reattachmentReadbacks: resumeRows().filter((row) => row.message?.toolName === "task_output").map((row) => row.message),
    childrenCompleted: (acknowledged || readTaskRecords(sandbox)).filter((r) =>
      records.some((old) => old.task_id === r.task_id) && r.status === "completed").length,
    transcriptLinesBefore: before, transcriptLinesAfter: grew ?? transcriptSizes(sandbox, records),
    grewAfterParentExit: grew !== undefined,
    resumeExit: resumed?.child.exitCode ?? null,
    resumeAcknowledged: parentAnswered() === true,
    sameParentSession: !!session && jsonlLines(session).some((line) => {
      const row = JSON.parse(line)
      return row.type === "session" && row.id === sessionId
    }),
    promptOccurrencesPerChild: replays,
    noPromptReplay: records.length === 4 && Object.values(replays).every((count) => count === 1),
    childStart: childStartDiagnosis(sandbox, readTaskRecords(sandbox)),
  }
  await stopParent(resumed)
  const receipt = await cleanupScenario(sandbox, { hostPids: [daemonStatus(sandbox).json?.pid].filter(Boolean) })
  return {
    scenario: "B", title: "detach/attach: parent quits with 4 children mid-turn",
    status: resumePass(facts) ? "pass" : "fail",
    reason: `started=${facts.childrenStarted} reattached=${facts.reattachedChildren} completed=${facts.childrenCompleted} grew=${facts.grewAfterParentExit} resumed=${facts.resumeAcknowledged} sameParent=${facts.sameParentSession} noReplay=${facts.noPromptReplay}`,
    facts, receipt,
  }
}
