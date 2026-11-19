#!/usr/bin/env bun
// free-plan-cross-workspace (omo same-device cross-project messaging): one real rpc host, one agent
// dir, two sessions in two different project folders - the Desktop topology. From the alpha-project
// session, through the eval-only thread tools on the REAL engine: the scoped thread_list hides the
// beta session, a scoped name send to it answers scope_denied naming all_scope (never a cross-device
// refusal), the all_scope listing shows it, and the all_scope name send delivers to it on this device.
import { mkdirSync } from "node:fs"
import { join } from "node:path"

import {
  HostClient,
  cleanupAllAndWait,
  createReport,
  flag,
  installCleanupHooks,
  makeScratch,
  pgrepPids,
  startFakeModelServer,
  startRealHost,
  stopOwnedShardHosts,
  verifyCleanup,
  writeMockModelsJson,
} from "./lib/harness.mjs"

const report = createReport("free-plan-cross-workspace")
installCleanupHooks()
const scratch = makeScratch("free-plan-cross-workspace")
const evalCall = (code) => ({
  toolCalls: [{ name: "eval", args: { language: "js", summary: "QA: thread cell", code } }],
})
const fake = await startFakeModelServer([
  evalCall(
    "const v = JSON.parse((await tool.thread_list({})).text); print(JSON.stringify({kind: v.kind, scope: v.scope, ids: (v.threads ?? []).map(t => t.thread)}))",
  ),
  evalCall(
    'const r = JSON.parse((await tool.thread_send({ thread: "site build", message: "cross-project hello (scoped)" })).text); print(JSON.stringify({kind: r.kind, code: r.error?.code, next_action: r.error?.next_action}))',
  ),
  evalCall(
    "const v = JSON.parse((await tool.thread_list({ all_scope: true })).text); print(JSON.stringify({kind: v.kind, ids: (v.threads ?? []).map(t => t.thread)}))",
  ),
  evalCall(
    'const r = JSON.parse((await tool.thread_send({ thread: "site build", message: "cross-project hello", all_scope: true })).text); print(JSON.stringify({kind: r.kind, thread: r.thread, delivery: r.delivery?.kind}))',
  ),
  { text: "sender done" },
  { text: "beta woken" },
  { text: "spare" },
])
writeMockModelsJson(scratch.agentDir, fake)
const alphaProject = join(scratch.dir, "alpha-project")
const betaProject = join(scratch.dir, "beta-project")
mkdirSync(alphaProject, { recursive: true })
mkdirSync(betaProject, { recursive: true })
const extension = join(process.cwd(), "packages/omo-senpi/plugin/extensions/omo.js")
const configAgent = join(scratch.dir, ".omo", "agent")
mkdirSync(configAgent, { recursive: true })
await Bun.write(join(configAgent, "settings.json"), "{}")
await Bun.write(join(configAgent, "models.json"), await Bun.file(join(scratch.agentDir, "models.json")).text())
const socketPath = join(configAgent, "rpc", "rpc.sock")
scratch.env.SENPI_RPC_SOCKET = socketPath
delete scratch.env.OMO_CODING_AGENT_DIR
delete scratch.env.CODING_AGENT_DIR
scratch.env.HOME = scratch.dir
const host = await startRealHost(scratch, {
  socketPath,
  extraArgs: ["--provider", "mock", "--model", "mock-model", "--extension", extension],
})
const client = await HostClient.connect(host.socket, "fpcw")
const beta = await client.openSession({ cwd: betaProject })
await client.request({ type: "set_session_name", sessionId: beta.routingId, name: "site build" })
const alpha = await client.openSession({ cwd: alphaProject })
const settled = client.waitFor(
  (record) => record.type === "agent_settled" && record.sessionId === beta.routingId,
  client.mark(),
  120_000,
)
await client.promptAndSettle(
  alpha.routingId,
  "List your workspace threads, message the site build session by name, list all threads, then message it by name with all_scope.",
  { streamingBehavior: "followUp" },
)
await settled
const messages = await client.messages(alpha.routingId)
const betaMessages = await client.messages(beta.routingId)
const calls = []
let pending = []
for (const message of messages) {
  if (message.role === "assistant" && Array.isArray(message.content)) {
    pending = message.content.filter((part) => part?.type === "toolCall")
    continue
  }
  if (message.role !== "tool" && message.role !== "toolResult") continue
  const call = pending.shift()
  const text =
    typeof message.content === "string"
      ? message.content
      : Array.isArray(message.content)
        ? message.content.map((part) => part?.text ?? "").join("")
        : JSON.stringify(message.content ?? {})
  calls.push({ name: message.toolName ?? call?.name, args: call?.arguments ?? call?.args ?? {}, text })
}
const cell = (needle) => calls.find((call) => call.name === "eval" && String(call.args?.code ?? "").includes(needle))
const parsed = (text) => {
  const start = (text ?? "").indexOf("{")
  if (start < 0) return undefined
  let depth = 0
  let quoted = false
  for (let index = start; index < text.length; index += 1) {
    const char = text[index]
    if (quoted) {
      if (char === "\\") index += 1
      else if (char === '"') quoted = false
      continue
    }
    if (char === '"') quoted = true
    else if (char === "{") depth += 1
    else if (char === "}" && (depth -= 1) === 0) {
      try {
        return JSON.parse(text.slice(start, index + 1))
      } catch {
        return undefined
      }
    }
  }
  return undefined
}
const scopedList = parsed(cell("thread_list({})")?.text)
const scopedSend = parsed(cell('thread_send({ thread: "site build", message: "cross-project hello (scoped)" })')?.text)
const wideList = parsed(cell("thread_list({ all_scope: true })")?.text)
const wideSend = parsed(
  cell('thread_send({ thread: "site build", message: "cross-project hello", all_scope: true })')?.text,
)
const betaId = beta.state.durableSessionId
const alphaId = alpha.state.durableSessionId
report.assert(
  "spawn-with-built-extension",
  typeof betaId === "string" && typeof alphaId === "string" && betaId !== alphaId,
  `beta=${JSON.stringify(beta.state)} alpha=${JSON.stringify(alpha.state)}`,
)
report.assert(
  "scoped-list-hides-other-project",
  scopedList?.kind === "ok" &&
    scopedList.scope === "workspace" &&
    scopedList.ids.includes(alphaId) &&
    !scopedList.ids.includes(betaId),
  `scoped_list=${JSON.stringify(scopedList)} alpha=${alphaId} beta=${betaId}`,
)
report.assert(
  "scoped-name-send-answers-scope-hint",
  scopedSend?.kind === "error" &&
    scopedSend.code === "scope_denied" &&
    String(scopedSend.next_action ?? "").includes("all_scope"),
  `scoped_send=${JSON.stringify(scopedSend)}`,
)
report.assert(
  "all-scope-list-shows-other-project",
  wideList?.kind === "ok" && wideList.ids.includes(betaId),
  `wide_list=${JSON.stringify(wideList)} beta=${betaId}`,
)
report.assert(
  "all-scope-name-send-delivers-on-this-device",
  wideSend?.kind === "ok" && wideSend.thread === betaId,
  `wide_send=${JSON.stringify(wideSend)} beta=${betaId}`,
)
report.assert(
  "beta-received-the-message",
  betaMessages.some((message) => JSON.stringify(message?.content ?? "").includes("cross-project hello")),
  `beta_messages=${JSON.stringify(betaMessages).slice(0, 600)}`,
)
const shardSockets = stopOwnedShardHosts(scratch.dir)
await cleanupAllAndWait()
const lateShards = stopOwnedShardHosts(scratch.dir)
const shardSurvivors = [...shardSockets, ...lateShards].flatMap((socket) => pgrepPids(socket))
report.assert(
  "shard-hosts-stopped",
  shardSurvivors.length === 0 && lateShards.length === 0,
  `shards=${JSON.stringify(shardSockets)} late_shards=${JSON.stringify(lateShards)} survivor_pids=${JSON.stringify(shardSurvivors)}`,
)
verifyCleanup(report, { scratchDir: scratch.dir, socketPaths: [socketPath, ...shardSockets] })
report.write(flag("--out") ?? process.env.OUT)
if (report.failures) process.exit(1)
