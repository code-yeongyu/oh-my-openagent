import { createScenarioSandbox } from "./task-host-e2e-sandbox.mjs"
import { generationHostPid, zombieChildCount } from "./task-host-e2e-daemon-state.mjs"
import { cleanupScenario, daemonStatus, pidAlive, readTaskRecords, spawnParent, waitFor } from "./task-host-e2e-process.mjs"
import { observeState, stopParent } from "./task-host-e2e-events.mjs"
import { stormPass } from "./task-host-e2e-gates.mjs"
import { CHILD_DONE, childSessionFiles, childStartDiagnosis, childrenSettled, hostConfig, holdParent, jsonlLines, spawnScript } from "./task-host-e2e-support.mjs"

// A finite, distinct workload: the success marker is emitted only after the real bash tool returns.
const BASH_STORM = [
  ...Array.from({ length: 25 }, (_, index) => ({
    type: "tool_call", name: "eval", arguments: {
      language: "js", summary: `spawn one short-lived child process (${index})`,
      code: `var result = await tool.bash({ command: "true # storm-${index}" });
        if (result.hasError || result.isError) throw new Error("storm bash failed");
        console.log("STORM_OK:${index}");`,
    },
  })),
  ...CHILD_DONE,
]

export function completedStormCalls(lines) {
  const ordinals = new Set()
  for (const line of lines) {
    const row = JSON.parse(line)
    const message = row.message
    if (message?.role !== "toolResult" || message.toolName !== "eval" || message.isError) continue
    for (const part of message.content ?? []) {
      if (part.type !== "text") continue
      for (const match of part.text.matchAll(/\bSTORM_OK:(\d+)\b/g)) {
        const index = Number(match[1])
        if (index >= 0 && index < 25) ordinals.add(index)
      }
    }
  }
  return ordinals.size
}

export async function scenarioF(run) {
  const sandbox = createScenarioSandbox(run, "sF", {
    omoConfig: hostConfig(),
    script: holdParent(spawnScript(8, BASH_STORM, "z")),
  })
  let parent
  let calls = {}
  await observeState(sandbox.root, () => {
    const records = readTaskRecords(sandbox)
    calls = Object.fromEntries(records.map((record) => [
      record.task_id, completedStormCalls(childSessionFiles(sandbox, record.task_id).flatMap(jsonlLines)),
    ]))
    return childrenSettled(records, 8) ? records : undefined
  }, { trigger: () => { parent = spawnParent(sandbox, run.mockEntry, "run the bash storm across eight children") } })
  const records = readTaskRecords(sandbox)
  const hostPid = generationHostPid(sandbox.agentDir)
  await stopParent(parent)
  // Time is the subject of this bound: after the finite workload settles, zombies must be reaped.
  const settled = await waitFor(() => hostPid !== undefined && pidAlive(hostPid) &&
    zombieChildCount(hostPid) === 0 ? true : undefined, { timeoutMs: 30_000, intervalMs: 1_000 })
  const status = daemonStatus(sandbox, { includeWorkers: true })
  const facts = {
    hostPid: hostPid ?? null,
    daemonAlive: hostPid !== undefined && pidAlive(hostPid) && status.exitCode === 0,
    childrenStarted: records.filter((record) => record.status === "running").length,
    stormParticipants: Object.values(calls).filter((count) => count === 25).length,
    successfulBashCallsPerChild: calls,
    bashCallRecords: Object.values(calls).reduce((sum, count) => sum + count, 0),
    zombieChildCount: hostPid === undefined ? null : zombieChildCount(hostPid),
    zombiesSettledWithin30s: settled === true,
    daemonReportedZombies: status.json?.zombies ?? null,
    childStart: childStartDiagnosis(sandbox, records),
  }
  const pass = stormPass(facts)
  const receipt = await cleanupScenario(sandbox, { hostPids: [hostPid, status.json?.pid].filter(Boolean) })
  return {
    scenario: "F", title: "zombies (E1): 200 successful bash calls across 8 children",
    status: pass ? "pass" : "fail",
    reason: `participants=${facts.stormParticipants} bashCalls=${facts.bashCallRecords} alive=${facts.daemonAlive} zombies=${facts.zombieChildCount} daemonZombies=${facts.daemonReportedZombies}`,
    facts, receipt,
  }
}
