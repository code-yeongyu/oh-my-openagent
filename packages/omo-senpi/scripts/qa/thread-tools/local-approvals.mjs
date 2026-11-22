#!/usr/bin/env bun
// i22 (#14079): routine LOCAL thread tool calls from an eval cell ask for no approval of their own, on a REAL rpc host
// with the built omo extension and codemode loaded, in a SIGNED-OUT scratch HOME (no account, no device service) and a
// prompting approval mode (`workspace`). The fake model runs ONE js cell that lists threads, creates a local thread and
// renames it, then one cell that closes it by its id. The client answers every permission dialog with "Allow once" and
// records its title: only the eval cells may ask (the eval preset floor), never a nested thread_* call. A third cell
// creates a thread on a named other device: that call keeps its own ask, so the answered dialog list must name it,
// which is the control that keeps the local rows from passing vacuously.
import { join } from "node:path"
import { mkdirSync } from "node:fs"
import {
  HostClient,
  makeScratch,
  startRealHost,
  startFakeModelServer,
  writeMockModelsJson,
  installCleanupHooks,
  cleanupAllAndWait,
  createReport,
  flag,
  stopOwnedShardHosts,
  verifyCleanup,
} from "./lib/harness.mjs"

const report = createReport("local-approvals")
installCleanupHooks()
const scratch = makeScratch("local-approvals")
const evalCall = (summary, code) => ({ name: "eval", args: { language: "js", summary, code } })
const fake = await startFakeModelServer([
  {
    toolCalls: [
      evalCall(
        "QA: list, create and rename a local thread",
        [
          "const listed = JSON.parse((await tool.thread_list({})).text)",
          'const created = JSON.parse((await tool.thread_create({ name: "i22-helper" })).text)',
          "const id = created.thread?.thread_id",
          'const renamed = JSON.parse((await tool.thread_rename({ thread: id, name: "i22-helper-2" })).text)',
          "print(JSON.stringify({ I22: true, list: listed.kind, create: created.kind, id, rename: renamed.kind, renameCode: renamed.error?.code ?? null }))",
        ].join("\n"),
      ),
    ],
  },
  {
    toolCalls: [
      evalCall(
        "QA: close the local thread by id",
        [
          "const ids = JSON.parse((await tool.thread_list({ all_scope: true })).text).threads.filter((t) => t.name === 'i22-helper-2').map((t) => t.thread_id)",
          "const closed = JSON.parse((await tool.thread_close({ thread: ids[0] })).text)",
          "print(JSON.stringify({ I22_CLOSE: true, id: ids[0] ?? null, close: closed.kind, closeCode: closed.error?.code ?? null }))",
        ].join("\n"),
      ),
    ],
  },
  {
    toolCalls: [
      evalCall(
        "QA: create on another device (control)",
        'const r = JSON.parse((await tool.thread_create({ device: "another-device", name: "x" })).text); print(JSON.stringify({ I22_REMOTE: true, kind: r.kind, code: r.error?.code ?? null }))',
      ),
    ],
  },
  { text: "local-approvals-done" },
])
writeMockModelsJson(scratch.agentDir, fake)
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
const client = await HostClient.connect(host.socket, "local-approvals")
const caller = await client.openSession({ cwd: scratch.cwd, permissionPreset: "workspace" })
const asked = []
client.socket.on("data", () => {
  for (const record of client.records) {
    if (record.type !== "extension_ui_request" || record.method !== "select" || record.__answered) continue
    record.__answered = true
    const title = String(record.title ?? "")
    if (!title.startsWith("Permission required:")) continue
    asked.push(title.split("\n")[0])
    client.socket.write(
      `${JSON.stringify({ type: "extension_ui_response", id: record.id, sessionId: record.sessionId, value: "Allow once" })}\n`,
    )
  }
})
await client.promptAndSettle(caller.routingId, "Use the thread tools from eval cells.", {
  streamingBehavior: "followUp",
})
const transcript = JSON.stringify(await client.messages(caller.routingId))
const cellResult = (marker) => {
  const at = transcript.indexOf(`{\\"${marker}\\":true`)
  if (at < 0) return undefined
  const end = transcript.indexOf("}", at)
  try {
    return JSON.parse(transcript.slice(at, end + 1).replaceAll('\\"', '"'))
  } catch {
    return undefined
  }
}
const local = cellResult("I22")
const closed = cellResult("I22_CLOSE")
const remote = cellResult("I22_REMOTE")
const nestedThreadAsks = asked.filter((title) => title.startsWith("Permission required: thread_"))
report.assert(
  "signed-out-scratch",
  scratch.env.HOME === scratch.dir,
  `HOME=${scratch.env.HOME} (scratch, no account or device service)`,
)
report.assert(
  "local-cell-ran-every-call",
  local?.list === "ok" && local?.create === "ok" && typeof local?.id === "string" && local?.rename === "ok",
  `local=${JSON.stringify(local ?? null)}`,
)
report.assert(
  "local-close-by-id",
  closed?.close === "ok" && typeof closed?.id === "string",
  `closed=${JSON.stringify(closed ?? null)}`,
)
report.assert(
  "only-eval-and-remote-control-asked",
  asked.filter((title) => title === "Permission required: eval").length === 3 &&
    JSON.stringify(nestedThreadAsks) === JSON.stringify(["Permission required: thread_create"]),
  `asked=${JSON.stringify(asked)} remote=${JSON.stringify(remote ?? null)}`,
)
const shardSockets = stopOwnedShardHosts(scratch.dir)
await cleanupAllAndWait()
stopOwnedShardHosts(scratch.dir)
verifyCleanup(report, { scratchDir: scratch.dir, socketPaths: [socketPath, ...shardSockets] })
report.write(flag("--out") ?? process.env.OUT)
if (report.failures) process.exit(1)
