import { writeFileSync } from "node:fs"
import { join } from "node:path"

import { observeState } from "./task-host-e2e-events.mjs"
import { lastJsonLine, runBin } from "./task-host-e2e-process.mjs"
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
  swapBinary,
  taskStep,
  textStep,
} from "./task-host-e2e-shards-handoff-successors-support.mjs"
import { HostClient } from "./task-host-e2e-shards-rpc.mjs"
import { generationNames } from "./task-host-e2e-shards-support.mjs"

const THREAD_START = "T14_INTERACTIVE_THREAD_START"
const CHILD_HOLD = "T14_INTERACTIVE_CHILD_HOLD"
const GRANDCHILD_HOLD = "T14_INTERACTIVE_GRANDCHILD_HOLD"

function route(threadRelease, childRelease, grandchildRelease) {
  return (request) => {
    if (request.user.includes(THREAD_START)) {
      return request.count("task") === 0
        ? taskStep("successor-thread-child", CHILD_HOLD)
        : textStep("thread held", threadRelease)
    }
    if (request.user.includes(CHILD_HOLD)) {
      return request.count("task") === 0
        ? heldTaskStep(
            "child held",
            childRelease,
            "successor-thread-grandchild",
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

export async function runInteractiveSuccessorScenario(current, olderBin, artifacts) {
  const threadRelease = join(current.root, `i-thread-${process.pid}`)
  const childRelease = join(current.root, `i-child-${process.pid}`)
  const grandchildRelease = join(current.root, `i-grandchild-${process.pid}`)
  const scenario = await createHttpScenario(
    current,
    "successor-i",
    route(threadRelease, childRelease, grandchildRelease),
  )
  const { sandbox, project, requestLog } = scenario
  const binary = runtimeBin(current)
  let client
  try {
    swapBinary(olderBin, binary)
    const old = { ...sandbox, bin: binary }
    const named = runBin(old, [
      "host", "shard-path", "--kind", "i", "--owner", "thread-successor",
      "--root", join(sandbox.agentDir, "rpc", "shards"), "--json",
    ])
    const interactiveSocket = lastJsonLine(named.stdout)?.socket
    if (named.status !== 0 || typeof interactiveSocket !== "string") {
      throw new Error(`shard-path failed: ${named.stderr || named.stdout}`)
    }
    const ensured = runBin(old, [
      "host", "ensure", "--socket", interactiveSocket,
      "--launch-spec", current.specPath, "--policy", "never", "--json",
    ], { timeoutMs: 120_000 })
    if (ensured.status !== 0) {
      throw new Error(`interactive ensure failed: ${ensured.stderr || ensured.stdout}`)
    }
    client = await HostClient.connect(interactiveSocket, "successor-i-h1")
    const opened = await client.openSession({
      cwd: sandbox.cwd,
      sessionPath: join(sandbox.sessionDir, "interactive-successor.jsonl"),
      kind: "interactive",
      context: { role: "interactive" },
      provider: "omo-http",
      modelId: "mock-1",
    })
    const threadPrompt = client.request({
      type: "prompt",
      sessionId: opened.routingId,
      message: THREAD_START,
    })
    void threadPrompt.catch(() => {})
    const child = await observeState(sandbox.root, () => {
      const record = taskRecords(project).find((entry) => entry.name === "successor-thread-child")
      return record?.host_session?.socket && requestSeen(requestLog, CHILD_HOLD)
        ? record
        : undefined
    })
    if (child === undefined) throw new Error("interactive task child did not reach streamed hold")
    const childSocket = child.host_session.socket
    const before = endpoint(sandbox, "p")
    const generationsBefore = generationNames(sandbox, childSocket)
    swapBinary(current.bin, binary)
    const handoffRun = startCommand(
      { ...sandbox, bin: binary },
      ["daemon", "handoff", "--json"],
    )
    const successor = await observeState(sandbox.root, () => {
      const report = endpoint(sandbox, "p")
      return report?.instanceId !== before?.instanceId ? report : undefined
    })
    const generationsAtHandoff = generationNames(sandbox, childSocket)
    writeFileSync(childRelease, "go\n")
    const grandchild = await observeState(sandbox.root, () => {
      const record = taskRecords(project).find(
        (entry) => entry.name === "successor-thread-grandchild",
      )
      return record?.host_session?.session_path && requestSeen(requestLog, GRANDCHILD_HOLD)
        ? record
        : undefined
    })
    const after = endpoint(sandbox, "p")
    const generationsAfter = generationNames(sandbox, childSocket)
    const successorRow = rowOnInstance(after, grandchild, successor?.instanceId)
    const handoffOutcome = await handoffRun.closed
    const facts = {
      interactive_socket: interactiveSocket,
      child_socket: childSocket,
      h1: before?.instanceId ?? null,
      h2: successor?.instanceId ?? null,
      grandchild_host_instance: successorRow?.context?.host_instance ?? null,
      generations_before: generationsBefore,
      generations_at_handoff: generationsAtHandoff,
      generations_after_nested_spawn: generationsAfter,
      handoff_exit: handoffOutcome.status,
    }
    return scenarioResult(
      successorRow !== undefined &&
        generationsAtHandoff.length === generationsBefore.length + 1 &&
        generationsAfter.every((name) => generationsAtHandoff.includes(name)) &&
        handoffOutcome.status === 0,
      join(artifacts, "interactive-handoff-nested.json"),
      facts,
      "interactive task grandchild did not attach to its p-* successor",
    )
  } finally {
    swapBinary(current.bin, binary)
    for (const path of [threadRelease, childRelease, grandchildRelease]) {
      writeFileSync(path, "go\n")
    }
    client?.close()
    scenario.close()
    const cleanup = await teardownSandbox(sandbox)
    writeFileSync(
      join(artifacts, "interactive-handoff-nested-cleanup.json"),
      `${JSON.stringify(cleanup, null, 2)}\n`,
    )
  }
}
