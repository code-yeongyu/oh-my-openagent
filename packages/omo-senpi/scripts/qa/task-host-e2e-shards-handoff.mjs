import { dirname, join } from "node:path"
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  writeFileSync,
} from "node:fs"

import { HostClient } from "./task-host-e2e-shards-rpc.mjs"
import { startMockCompletionsServer } from "./mock-completions-server.mjs"
import { lastJsonLine, runBin, waitFor } from "./task-host-e2e-process.mjs"
import {
  endpointSockets,
  hostStatus,
  mainProject,
  newSandbox,
  statusAll,
  taskConfig,
  taskRecords,
  teardownSandbox,
} from "./task-host-e2e-shard-cost-support.mjs"
import { pass } from "./task-host-e2e-shards-support.mjs"

function config() {
  const value = taskConfig({
    default_execution_mode: "process",
    process_runner: "host",
    max_depth: 4,
  })
  value.categories.proc.model = "omo-http/mock-1"
  return value
}

function script() {
  return {
    parentSteps: [{ type: "text", text: "unused" }],
    childSteps: [
      {
        type: "tool_call",
        name: "task",
        arguments: {
          category: "proc",
          run_in_background: true,
          name: "desk-child",
          prompt: "desk child",
        },
      },
      { type: "text", text: "desk interactive turn complete" },
    ],
  }
}

function workerEndpoint(sandbox, desk) {
  return statusAll(sandbox).endpoints.find((row) => row.socket !== desk && row.sessions?.worker === 1)
}

function hostLogs(sandbox) {
  const root = join(sandbox.agentDir, "rpc-host-daemon")
  return Object.fromEntries(
    readdirSync(root, { recursive: true })
      .filter((entry) => String(entry).endsWith("stderr.log"))
      .map((entry) => {
        const path = join(root, String(entry))
        return [String(entry), readFileSync(path, "utf8")]
      }),
  )
}

function replaceRuntimeBinary(source, destination) {
  const staged = `${destination}.swap-${process.pid}`
  copyFileSync(source, staged)
  chmodSync(staged, 0o755)
  renameSync(staged, destination)
}

export async function runMixedEngineScenario(current, olderBin, artifacts) {
  const sandbox = newSandbox(current, "mixed", {
    omoConfig: config(),
    script: { parentSteps: [], childSteps: [] },
  })
  const project = mainProject(sandbox)
  const route = join(sandbox.root, "desk-route")
  const childRelease = join(route, "release")
  mkdirSync(join(route, ".omo"), { recursive: true })
  writeFileSync(join(route, "mock-script.json"), `${JSON.stringify({ parentSteps: [], childSteps: [] }, null, 2)}\n`)
  writeFileSync(join(sandbox.cwd, "mock-script.json"), `${JSON.stringify(script(), null, 2)}\n`)
  const desk = join(sandbox.agentDir, "rpc", "desk.sock")
  const marker = "T14_FORBIDDEN_LAUNCH_MARKER"
  const provider = startMockCompletionsServer({
    steps: [{
      type: "text",
      text: "desk child complete",
      releaseWhen: () => existsSync(childRelease),
      releaseTimeoutMs: 600_000,
    }],
  })
  let client
  const runtimeBin = join(dirname(current.pluginRoot), "omo")
  try {
    const baseUrl = await provider.ready
    writeFileSync(join(sandbox.agentDir, "models.json"), `${JSON.stringify({
      providers: {
        "omo-http": {
          name: "todo 14 local http mock",
          api: "openai-completions",
          baseUrl,
          apiKey: "local-qa-only",
          models: [{
            id: "mock-1",
            name: "Todo 14 HTTP mock",
            reasoning: false,
            input: ["text"],
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
            contextWindow: 200000,
            maxTokens: 4096,
          }],
        },
      },
    }, null, 2)}\n`)
    replaceRuntimeBinary(olderBin, runtimeBin)
    const installedOlderSandbox = { ...sandbox, bin: runtimeBin }
    const ensured = runBin(
      installedOlderSandbox,
      ["host", "ensure", "--socket", desk, "--launch-spec", current.specPath, "--policy", "never", "--json"],
      { timeoutMs: 120_000, env: { [marker]: "must-not-reach-host" } },
    )
    if (ensured.status !== 0) throw new Error(`older desk ensure failed: ${ensured.stderr || ensured.stdout}`)
    const deskBefore = hostStatus(sandbox, desk).json
    client = await HostClient.connect(desk, "mixed-desk")
    const sessionPath = join(sandbox.sessionDir, "desk.jsonl")
    const opened = await client.openSession({
      cwd: sandbox.cwd,
      sessionPath,
      kind: "interactive",
      context: { role: "interactive" },
      provider: "omo-mock",
      modelId: "mock-1",
    })
    await client.promptAndSettle(opened.routingId, "spawn one task child")
    const shardBefore = await waitFor(
      () => workerEndpoint(sandbox, desk),
      { timeoutMs: 180_000, intervalMs: 500 },
    )
    if (shardBefore === undefined) {
      const debug = { records: taskRecords(project), logs: hostLogs(sandbox), status: statusAll(sandbox) }
      writeFileSync(join(artifacts, "mixed-engine-debug.json"), `${JSON.stringify(debug, null, 2)}\n`)
      throw new Error(`worker shard missing from host status --all: ${JSON.stringify(debug.records)}`)
    }
    const generationsBefore = shardBefore.generations?.map((row) => row.instanceId) ?? []
    const deskStableBefore = hostStatus(sandbox, desk).json
    replaceRuntimeBinary(current.bin, runtimeBin)
    const installedCurrentSandbox = { ...sandbox, bin: runtimeBin }
    const currentHandoff = runBin(installedCurrentSandbox, ["daemon", "handoff", "--json"], { timeoutMs: 240_000 })
    if (currentHandoff.status !== 0) throw new Error(`current handoff failed: ${currentHandoff.stderr || currentHandoff.stdout}`)
    const shardAfter = await waitFor(() => {
      const row = statusAll(sandbox).endpoints.find((entry) => entry.socket === shardBefore.socket)
      return row !== undefined && row.instanceId !== shardBefore.instanceId ? row : undefined
    }, { timeoutMs: 120_000, intervalMs: 500 })
    if (shardAfter === undefined) throw new Error("outside current build did not hand the worker shard forward")
    replaceRuntimeBinary(olderBin, runtimeBin)
    const olderHandoff = runBin(installedOlderSandbox, ["daemon", "handoff", "--json"], { timeoutMs: 240_000 })
    replaceRuntimeBinary(current.bin, runtimeBin)
    const facts = {
      desk,
      desk_before: deskBefore,
      desk_unchanged_during_in_host_spawn:
        deskBefore?.instanceId === deskStableBefore?.instanceId && deskBefore?.pid === deskStableBefore?.pid,
      shard_before: shardBefore,
      shard_after: shardAfter,
      child_socket: shardBefore.socket,
      child_streaming_or_completed: shardBefore.sessions?.worker === 1,
      inherited_engine: shardBefore.engineVersion === deskBefore?.engineVersion,
      marker_absent: !(shardBefore.env_keys ?? []).includes(marker),
      no_worker_on_desk: deskBefore?.sessions?.worker === 0,
      generation_count_before: generationsBefore.length,
      current_handoff: lastJsonLine(currentHandoff.stdout),
      older_handoff_exit: olderHandoff.status,
      older_handoff: olderHandoff.stdout.trim(),
      endpoints: endpointSockets(sandbox),
    }
    writeFileSync(join(artifacts, "mixed-engine.json"), `${JSON.stringify(facts, null, 2)}\n`)
    const ok = facts.desk_unchanged_during_in_host_spawn && facts.inherited_engine &&
      facts.marker_absent && facts.no_worker_on_desk && facts.child_streaming_or_completed &&
      shardAfter.instanceId !== shardBefore.instanceId &&
      (olderHandoff.status !== 0 || /\b(?:reuse|refuse)\b/.test(olderHandoff.stdout))
    return {
      mixed_engine_host_spawns_shard: ok
        ? pass([join(artifacts, "mixed-engine.json")], facts)
        : { status: "fail", evidence: [join(artifacts, "mixed-engine.json")], reason: "mixed-engine invariants failed", facts },
    }
  } finally {
    replaceRuntimeBinary(current.bin, runtimeBin)
    writeFileSync(childRelease, "go\n")
    provider.close()
    client?.close()
    const cleanup = await teardownSandbox(sandbox)
    writeFileSync(join(artifacts, "mixed-engine-cleanup.json"), `${JSON.stringify(cleanup, null, 2)}\n`)
  }
}
