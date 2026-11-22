#!/usr/bin/env bun
// The eval-only surface of the thread tools on a REAL rpc host with the built omo extension and
// codemode loaded (#12903): the fake model first calls `thread_list` and `generate_image` directly
// and must get the eval redirect for each, then calls `thread_list` from a js cell and a py cell and
// gets the listing, then calls `generate_image` from a cell and reaches the tool body (senpi#6269;
// the mock provider serves no images endpoint, so the body answers a provider failure), then calls
// `thread_read` without arguments from a cell and gets an eval error naming the tool. The system
// prompt the host sent must carry the cell form of every withheld tool.
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
  pgrepPids,
  stopOwnedShardHosts,
  verifyCleanup,
} from "./lib/harness.mjs"
const report = createReport("plugin-surface")
installCleanupHooks()
const scratch = makeScratch("plugin-surface")
const evalCall = (language, summary, code) => ({ name: "eval", args: { language, summary, code } })
const fake = await startFakeModelServer([
  { toolCalls: [{ name: "thread_list", args: { all_scope: true } }] },
  { toolCalls: [{ name: "generate_image", args: { prompt: "qa" } }] },
  // The cells print a summary of the listing: the eval tool truncates a long result, and a full listing
  // with session paths is one.
  {
    toolCalls: [
      evalCall(
        "js",
        "QA: thread_list from a js cell",
        "const v = JSON.parse((await tool.thread_list({ all_scope: true })).text); print(JSON.stringify({ kind: v.kind, scope: v.scope, threads: v.threads.length }))",
      ),
    ],
  },
  {
    toolCalls: [
      evalCall(
        "py",
        "QA: thread_list from a py cell",
        'import json\nv = json.loads(tool.thread_list(all_scope=True)["text"])\nprint(json.dumps({"kind": v["kind"], "scope": v["scope"], "threads": len(v["threads"])}, separators=(",", ":")))',
      ),
    ],
  },
  {
    toolCalls: [
      evalCall(
        "js",
        "QA: generate_image from a js cell",
        'const r = await tool.generate_image({ prompt: "qa" }); print(JSON.stringify(r.details))',
      ),
    ],
  },
  // A failing call inside a cell is an eval error that names the tool: thread_read without its
  // required `thread` argument.
  {
    toolCalls: [
      evalCall(
        "js",
        "QA: thread_read without arguments",
        "try { await tool.thread_read({}); print('NO_ERROR') } catch (e) { print('CELL_ERROR ' + String(e.message)) }",
      ),
    ],
  },
  { text: "plugin-ready" },
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
report.log(
  `host-stderr=${host
    .stderrText()
    .split("\\n")
    .filter((line) => line.includes("thread") || line.includes("extension"))
    .join("\\n")}`,
)
const client = await HostClient.connect(host.socket, "plugin")
const caller = await client.openSession({ cwd: scratch.cwd })
const surfaces = await client.request({ type: "get_loaded_surfaces", sessionId: caller.routingId })
// No settle delay before the first prompt: the engine orders it itself. `bindExtensions` holds the
// session-work barrier while session_start runs, and `prompt()` waits for that barrier to settle.
await client.promptAndSettle(
  caller.routingId,
  "List the threads directly, generate an image directly, then list the threads from a js cell and a py cell, then generate an image from a cell.",
  { streamingBehavior: "followUp" },
)
const messages = await client.messages(caller.routingId)
const transcript = JSON.stringify(messages)
// The fake model numbers tool calls per RESPONSE, so every call is `call_1`. Pair each result with
// the call that produced it in transcript order: the assistant tool call that preceded it.
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
const direct = calls.find((call) => call.name === "thread_list")
const directImage = calls.find((call) => call.name === "generate_image")
const evalCalls = calls.filter((call) => call.name === "eval")
const cellFor = (language, needle) =>
  evalCalls.find((call) => call.args?.language === language && String(call.args?.code ?? "").includes(needle))
const jsList = cellFor("js", "thread_list")
const pyList = cellFor("py", "thread_list")
const jsImage = cellFor("js", "generate_image")
const jsBadRead = cellFor("js", "thread_read({})")
// The system prompt the host sent the model on its first request: the eval-only paragraph must name
// every withheld tool's cell form, so the names stay discoverable.
const systemPrompt = (() => {
  const first = fake.requests.find((request) => Array.isArray(request.messages))
  const system = first?.messages.find((message) => message.role === "system")
  return typeof system?.content === "string"
    ? system.content
    : Array.isArray(system?.content)
      ? system.content.map((part) => part?.text ?? "").join("")
      : ""
})()
// A cell prints one JSON object; take the first balanced object that starts at the expected key.
const jsonObjectAt = (text, start) => {
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
    else if (char === "}" && (depth -= 1) === 0) return text.slice(start, index + 1)
  }
  return undefined
}
const listingOf = (text) => {
  const start = (text ?? "").indexOf('{"kind":"ok"')
  const object = start < 0 ? undefined : jsonObjectAt(text, start)
  try {
    return object === undefined ? undefined : JSON.parse(object)
  } catch {
    return undefined
  }
}
const isListing = (parsed) =>
  parsed?.kind === "ok" && parsed.scope === "all" && typeof parsed.threads === "number" && parsed.threads >= 1
// generate_image has no image provider here (the mock serves chat completions only), so its body answers a
// failure that only it produces: the request context plus a reason and zero generated images.
const imageDetails = (text) => {
  const start = (text ?? "").indexOf('{"model":')
  const object = start < 0 ? undefined : jsonObjectAt(text, start)
  try {
    return object === undefined ? undefined : JSON.parse(object)
  } catch {
    return undefined
  }
}
const reachedImageTool = (details) =>
  typeof details?.model === "string" &&
  details.model.startsWith("gpt-image-") &&
  typeof details.reason === "string" &&
  details.generated === 0
report.assert(
  "spawn-with-built-extension",
  JSON.stringify(surfaces).includes("omo.js"),
  `spawn=senpi --mode rpc --multi-session --listen unix://${host.socket} --extension ${extension}`,
)
report.assert(
  "direct-thread-list-refused-with-eval-hint",
  direct !== undefined && /Tool thread_list not found/.test(direct.text) && direct.text.includes("tool.thread_list("),
  `direct=${JSON.stringify(direct?.text ?? null).slice(0, 400)} transcript=${transcript.slice(0, 600)}`,
)
const jsListing = listingOf(jsList?.text)
const pyListing = listingOf(pyList?.text)
const image = imageDetails(jsImage?.text)
// generate_image is eval-only from senpi#6272 on; an engine before it (the omo pin until it carries that
// release) still exposes it for search, so the generate_image rows are skipped there and the thread rows
// stand on their own.
const engineHidesGenerateImage = systemPrompt.includes("tool.generate_image(")
const evalParagraph = systemPrompt.slice(systemPrompt.indexOf("Eval-only tools"))
const namedForms = ["tool.thread_list(", "tool.thread_send(", "tool.thread_report(", "tool.generate_image("].filter(
  (form) => evalParagraph.includes(form),
)
report.assert(
  "system-prompt-names-thread-eval-forms",
  namedForms.includes("tool.thread_list(") &&
    namedForms.includes("tool.thread_send(") &&
    namedForms.includes("tool.thread_report("),
  `named=${JSON.stringify(namedForms)} paragraph_head=${JSON.stringify(evalParagraph.slice(0, 200))}`,
)
if (engineHidesGenerateImage) {
  report.assert(
    "direct-generate-image-refused-with-eval-hint",
    directImage !== undefined &&
      /Tool generate_image not found/.test(directImage.text) &&
      directImage.text.includes('tool.generate_image({ prompt: "..." })'),
    `direct=${JSON.stringify(directImage?.text ?? null).slice(0, 400)}`,
  )
} else {
  report.skip(
    "direct-generate-image-refused-with-eval-hint",
    "this engine exposes generate_image for search (before senpi#6272); the direct call ran the tool",
  )
}
report.assert(
  "js-cell-failure-names-the-tool",
  jsBadRead !== undefined && /CELL_ERROR .*Validation failed for tool "thread_read"/.test(jsBadRead.text),
  `bad_read_cell=${JSON.stringify(jsBadRead?.text ?? null).slice(0, 300)}`,
)
report.assert(
  "js-cell-thread-list-result",
  isListing(jsListing),
  `threads=${jsListing?.threads ?? "none"} scope=${jsListing?.scope ?? "none"} js_cell=${JSON.stringify(jsList?.text ?? null).slice(0, 400)}`,
)
report.assert(
  "py-cell-thread-list-result",
  isListing(pyListing),
  `threads=${pyListing?.threads ?? "none"} scope=${pyListing?.scope ?? "none"} py_cell=${JSON.stringify(pyList?.text ?? null).slice(0, 400)}`,
)
report.assert(
  "js-cell-generate-image-reaches-tool",
  reachedImageTool(image),
  `model=${image?.model ?? "none"} reason=${image?.reason ?? "none"} generated=${image?.generated ?? "none"} image_cell=${JSON.stringify(jsImage?.text ?? null).slice(0, 400)}`,
)
// The plugin's task component pre-warms a detached `p-*` shard for this session; stop it and prove
// it gone, so a green run leaves nothing behind for the engine's idle window. It runs before the
// scratch removal in cleanupAllAndWait: the shard's agent dir is inside scratch and it writes there on exit.
const shardSockets = stopOwnedShardHosts(scratch.dir)
await cleanupAllAndWait()
// The main host ran until cleanup; a shard it re-ensured after the first stop would escape `shardSockets`.
const lateShards = stopOwnedShardHosts(scratch.dir)
const shardSurvivors = [...shardSockets, ...lateShards].flatMap((socket) => pgrepPids(socket))
report.assert(
  "shard-hosts-stopped",
  shardSurvivors.length === 0 && lateShards.length === 0,
  `shards=${JSON.stringify(shardSockets)} late_shards=${JSON.stringify(lateShards)} survivor_pids=${JSON.stringify(shardSurvivors)}`,
)
verifyCleanup(report, { scratchDir: scratch.dir, socketPaths: [socketPath, ...shardSockets] })
// Match the other lanes: run-all passes the out path as `--out <file>`, and it parses that file
// for SKIP lines to build the summary's skipped count. Reading process.env.OUT instead left the
// file unwritten under run-all, so a real SKIP read as skipped=0.
report.write(flag("--out") ?? process.env.OUT)
if (report.failures) process.exit(1)
