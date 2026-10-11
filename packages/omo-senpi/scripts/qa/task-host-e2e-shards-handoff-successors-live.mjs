import { writeFileSync } from "node:fs"
import { join } from "node:path"

import { observeState, stopParent } from "./task-host-e2e-events.mjs"
import {
  taskRecords,
  teardownSandbox,
} from "./task-host-e2e-shard-cost-support.mjs"
import {
  createHttpScenario,
  endpoint,
  heldTaskStep,
  requestSeen,
  runtimeBin,
  scenarioResult,
  sessionRow,
  startCommand,
  startHttpParent,
  swapBinary,
  taskStep,
  textStep,
} from "./task-host-e2e-shards-handoff-successors-support.mjs"
import {
  crashRows,
  generationNames,
} from "./task-host-e2e-shards-support.mjs"

const ROOT_START = "T14_ROOT_START"
const CHILD_HOLD = "T14_CHILD_HOLD"
const GRANDCHILD_HOLD = "T14_GRANDCHILD_HOLD"

function route(parentRelease, childRelease, grandchildRelease) {
  return (request) => {
    if (request.user.includes(ROOT_START)) {
      return request.count("task") === 0
        ? taskStep("successor-child", CHILD_HOLD)
        : textStep("parent held", parentRelease)
    }
    if (request.user.includes(CHILD_HOLD)) {
      return request.count("task") === 0
        ? heldTaskStep(
            "child held",
            childRelease,
            "successor-grandchild",
            GRANDCHILD_HOLD,
          )
        : textStep("grandchild spawned")
    }
    if (request.user.includes(GRANDCHILD_HOLD)) {
      return textStep("grandchild held", grandchildRelease)
    }
    return textStep("unexpected request")
  }
}

function rowOnInstance(report, record, instanceId) {
  const row = sessionRow(report, record?.host_session?.session_path)
  return row?.context?.host_instance === instanceId ? row : undefined
}

export async function runParentSuccessorScenario(current, olderBin, artifacts) {
  const parentRelease = join(current.root, `p-parent-${process.pid}`)
  const childRelease = join(current.root, `p-child-${process.pid}`)
  const grandchildRelease = join(current.root, `p-grandchild-${process.pid}`)
  const scenario = await createHttpScenario(
    current,
    "successor-p",
    route(parentRelease, childRelease, grandchildRelease),
  )
  const { sandbox, project, requestLog } = scenario
  const binary = runtimeBin(current)
  let parent
  try {
    swapBinary(olderBin, binary)
    parent = startHttpParent({ ...sandbox, bin: binary }, ROOT_START)
    const child = await observeState(sandbox.root, () => {
      const record = taskRecords(project).find((entry) => entry.name === "successor-child")
      return record?.host_session?.socket && requestSeen(requestLog, CHILD_HOLD)
        ? record
        : undefined
    })
    if (child === undefined) throw new Error("child did not reach streamed text hold")
    const socket = child.host_session.socket
    const before = endpoint(sandbox, "p")
    const generationsBefore = generationNames(sandbox, socket)
    swapBinary(current.bin, binary)
    const handoffRun = startCommand(
      { ...sandbox, bin: binary },
      ["daemon", "handoff", "--json"],
    )
    const successor = await observeState(sandbox.root, () => {
      const report = endpoint(sandbox, "p")
      return report?.instanceId !== before?.instanceId ? report : undefined
    })
    const generationsAtHandoff = generationNames(sandbox, socket)
    writeFileSync(childRelease, "go\n")
    const grandchild = await observeState(sandbox.root, () => {
      const record = taskRecords(project).find((entry) => entry.name === "successor-grandchild")
      return record?.host_session?.session_path && requestSeen(requestLog, GRANDCHILD_HOLD)
        ? record
        : undefined
    })
    const after = endpoint(sandbox, "p")
    const generationsAfter = generationNames(sandbox, socket)
    const successorRow = rowOnInstance(after, grandchild, successor?.instanceId)
    const handoffOutcome = await handoffRun.closed
    const facts = {
      socket,
      h1: before?.instanceId ?? null,
      h2: successor?.instanceId ?? null,
      grandchild_host_instance: successorRow?.context?.host_instance ?? null,
      generations_before: generationsBefore,
      generations_at_handoff: generationsAtHandoff,
      generations_after_nested_spawn: generationsAfter,
      crashes: crashRows(sandbox, socket).length,
      handoff_exit: handoffOutcome.status,
    }
    return scenarioResult(
      successorRow !== undefined &&
        generationsAtHandoff.length === generationsBefore.length + 1 &&
        generationsAfter.every((name) => generationsAtHandoff.includes(name)) &&
        facts.crashes === 0 &&
        handoffOutcome.status === 0,
      join(artifacts, "handoff-nested-successor.json"),
      facts,
      "grandchild did not open on H2 or nested spawn created a third generation",
    )
  } finally {
    swapBinary(current.bin, binary)
    for (const path of [parentRelease, childRelease, grandchildRelease]) {
      writeFileSync(path, "go\n")
    }
    await stopParent(parent)
    scenario.close()
    const cleanup = await teardownSandbox(sandbox, [parent].filter(Boolean))
    writeFileSync(
      join(artifacts, "handoff-nested-successor-cleanup.json"),
      `${JSON.stringify(cleanup, null, 2)}\n`,
    )
  }
}
