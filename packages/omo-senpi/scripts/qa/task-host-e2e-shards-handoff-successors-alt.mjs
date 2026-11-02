import { basename, dirname, join } from "node:path"
import { existsSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"

import { observeState, stopParent } from "./task-host-e2e-events.mjs"
import { HostClient } from "./task-host-e2e-shards-rpc.mjs"
import { lastJsonLine, runBin } from "./task-host-e2e-process.mjs"
import {
  stopEndpoint,
  taskRecords,
  teardownSandbox,
} from "./task-host-e2e-shard-cost-support.mjs"
import { generationNames } from "./task-host-e2e-shards-support.mjs"
import {
  createHttpScenario,
  endpoint,
  requestSeen,
  runtimeBin,
  scenarioResult,
  startCommand,
  startHttpParent,
  swapBinary,
  taskStep,
  textStep,
} from "./task-host-e2e-shards-handoff-successors-support.mjs"

const ALT_ROOT = "T14_ALT_ROOT_START"
const ALT_PARENT = "T14_ALT_PARENT_HOLD"
const ALT_THREAD = "T14_ALT_THREAD_HOLD"

// The endpoint's alt root when it is a `/tmp/omo-rpc-*` directory. Both sides are realpathed: the
// engine records `/private/tmp/...` on darwin, where `/tmp` is a symlink.
export function altRootOf(socket, tmp = realpathSync("/tmp")) {
  const dir = dirname(socket)
  if (!existsSync(dir)) return undefined
  const real = realpathSync(dir)
  return dirname(real) === tmp && basename(real).startsWith("omo-rpc-") ? real : undefined
}

export async function runAltRootSuccessorScenario(current, olderBin, artifacts) {
  const rootRelease = join(current.root, `alt-root-${process.pid}`)
  const parentRelease = join(current.root, `alt-parent-${process.pid}`)
  const threadRelease = join(current.root, `alt-thread-${process.pid}`)
  const route = (request) => {
    if (request.user.includes(ALT_ROOT)) {
      return request.count("task") === 0
        ? taskStep("alt-parent-child", ALT_PARENT)
        : textStep("alt root held", rootRelease)
    }
    if (request.user.includes(ALT_PARENT)) return textStep("alt parent held", parentRelease)
    if (request.user.includes(ALT_THREAD)) return textStep("alt thread held", threadRelease)
    return textStep("unexpected request")
  }
  const scenario = await createHttpScenario(current, "alt", route, true)
  const { sandbox, project, requestLog } = scenario
  const binary = runtimeBin(current)
  let parent
  let client
  let sockets = []
  try {
    swapBinary(olderBin, binary)
    const old = { ...sandbox, bin: binary }
    parent = startHttpParent(old, ALT_ROOT)
    const parentRecord = await observeState(sandbox.root, () => {
      const record = taskRecords(project).find((entry) => entry.name === "alt-parent-child")
      return record?.host_session?.socket && requestSeen(requestLog, ALT_PARENT)
        ? record
        : undefined
    })
    if (parentRecord === undefined) throw new Error("alternate-root parent child did not start")
    const named = runBin(old, [
      "host", "shard-path", "--kind", "i", "--owner", "alt-thread",
      "--root", dirname(parentRecord.host_session.socket), "--json",
    ])
    const threadSocket = lastJsonLine(named.stdout)?.socket
    if (named.status !== 0 || typeof threadSocket !== "string") {
      throw new Error(`alternate i shard-path failed: ${named.stderr || named.stdout}`)
    }
    const ensured = runBin(old, [
      "host", "ensure", "--socket", threadSocket, "--launch-spec", current.specPath,
      "--policy", "never", "--json",
    ], { timeoutMs: 120_000 })
    if (ensured.status !== 0) throw new Error(`alternate i ensure failed: ${ensured.stderr || ensured.stdout}`)
    client = await HostClient.connect(threadSocket, "alt-i")
    const opened = await client.openSession({
      cwd: sandbox.cwd,
      sessionPath: join(sandbox.sessionDir, "alt-thread.jsonl"),
      kind: "interactive",
      context: { role: "interactive" },
      provider: "omo-http",
      modelId: "mock-1",
    })
    const prompt = client.request({ type: "prompt", sessionId: opened.routingId, message: ALT_THREAD })
    await observeState(sandbox.root, () => requestSeen(requestLog, ALT_THREAD) ? true : undefined)
    sockets = [parentRecord.host_session.socket, threadSocket]
    const before = Object.fromEntries(sockets.map((socket) => [
      socket,
      endpoint(sandbox, socket === threadSocket ? "i" : "p")?.instanceId,
    ]))
    swapBinary(current.bin, binary)
    const handoffRun = startCommand(
      { ...sandbox, bin: binary },
      ["daemon", "handoff", "--json"],
    )
    const after = await observeState(sandbox.root, () => {
      const rows = ["p", "i"].map((kind) => endpoint(sandbox, kind))
      return rows.every((row) => row && row.instanceId !== before[row.socket])
        ? rows
        : undefined
    })
    const notices = sockets.map((socket) => {
      const path = socket.replace(/\.sock$/, ".meta.json")
      return existsSync(path) ? JSON.parse(readFileSync(path, "utf8")).notice ?? null : null
    })
    const noticeTokens = notices.map((notice) =>
      notice?.startsWith("host_notice:") ? notice : `host_notice:${notice}`)
    const generations = Object.fromEntries(sockets.map((socket) => [
      socket,
      generationNames(sandbox, socket),
    ]))
    const facts = {
      sockets,
      all_under_fixed_alt_root: sockets.every((socket) =>
        /^\/(?:private\/)?tmp\/omo-rpc-/.test(socket)),
      raw_meta_notices: notices,
      notice_tokens: noticeTokens,
      successor_instances: after?.map((row) => row.instanceId) ?? [],
      generations,
    }
    writeFileSync(parentRelease, "go\n")
    writeFileSync(threadRelease, "go\n")
    await prompt
    const handoffOutcome = await handoffRun.closed
    facts.handoff_exit = handoffOutcome.status
    return scenarioResult(
      after?.length === 2 &&
        facts.all_under_fixed_alt_root &&
        noticeTokens[0] === "host_notice:shard_alt_root" &&
        Object.values(generations).every((names) => names.length === 2) &&
        handoffOutcome.status === 0,
      join(artifacts, "alt-root-handoff.json"),
      facts,
      "real alt-root metadata or two-generation handoff evidence did not match",
    )
  } finally {
    swapBinary(current.bin, binary)
    writeFileSync(rootRelease, "go\n")
    writeFileSync(parentRelease, "go\n")
    writeFileSync(threadRelease, "go\n")
    client?.close()
    await stopParent(parent)
    for (const socket of sockets) await stopEndpoint(sandbox, socket)
    const altRoots = [...new Set(sockets.map((socket) => altRootOf(socket)).filter(Boolean))]
    for (const root of altRoots) rmSync(root, { recursive: true, force: true })
    scenario.close()
    const cleanup = await teardownSandbox(sandbox, [parent].filter(Boolean))
    const altRootReceipt = { removed: altRoots, still_present: altRoots.filter((root) => existsSync(root)) }
    writeFileSync(
      join(artifacts, "alt-root-handoff-cleanup.json"),
      `${JSON.stringify({ ...cleanup, alt_roots: altRootReceipt }, null, 2)}\n`,
    )
  }
}
