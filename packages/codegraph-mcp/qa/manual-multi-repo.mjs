import { spawn, spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const codegraph = process.env.CODEGRAPH_BIN
if (codegraph === undefined || codegraph.length === 0) {
  throw new Error("Set CODEGRAPH_BIN to the CodeGraph executable under test")
}
const transport = process.env.MCP_TRANSPORT ?? "line"
if (transport !== "line" && transport !== "framed") {
  throw new Error(`MCP_TRANSPORT must be "line" or "framed", got ${transport}`)
}

const sandbox = mkdtempSync(join(tmpdir(), "omo-codegraph-multi-repo-"))
const homeDir = join(sandbox, "home")
const repoA = join(sandbox, "repo-a")
const repoB = join(sandbox, "repo-b")
mkdirSync(homeDir, { recursive: true })
mkdirSync(repoA, { recursive: true })
mkdirSync(repoB, { recursive: true })
writeFileSync(join(repoA, "a.ts"), "export function repoAEntry(): string { return 'a' }\n")
writeFileSync(join(repoB, "b.ts"), "export function beforeChange(): string { return 'before' }\n")

const env = {
  ...process.env,
  CODEGRAPH_INSTALL_DIR: join(homeDir, ".omo", "codegraph"),
  CODEGRAPH_MCP_TOOLS: "explore,node,search,callers",
  CODEGRAPH_NO_DAEMON: "1",
  CODEGRAPH_TELEMETRY: "0",
  DO_NOT_TRACK: "1",
  HOME: homeDir,
  OMO_CODEGRAPH_BIN: codegraph,
}
const versionResult = spawnSync(codegraph, ["--version"], { encoding: "utf8", env })
if (versionResult.status !== 0) throw new Error(versionResult.stderr || "CodeGraph version check failed")
const codegraphVersion = versionResult.stdout.trim()
if (codegraphVersion !== "1.1.1") {
  throw new Error(`Expected CodeGraph 1.1.1, got ${codegraphVersion}`)
}

const repoBInitResult = spawnSync(codegraph, ["init", repoB], { encoding: "utf8", env })
if (repoBInitResult.status !== 0) {
  throw new Error(repoBInitResult.stderr || "CodeGraph initialization failed for repo B")
}

const child = spawn(process.execPath, [resolve("dist/cli.js")], {
  cwd: repoA,
  env,
  stdio: ["pipe", "pipe", "pipe"],
})
const pending = new Map()
const stderr = []
let nextId = 1
let protocolErrors = 0
let framedResponses = 0
let lineResponses = 0
let stdoutBuffer = Buffer.alloc(0)

function handleMessage(message, mode) {
  if (mode === "framed") framedResponses += 1
  if (mode === "line") lineResponses += 1
  const complete = pending.get(message.id)
  if (complete !== undefined) {
    pending.delete(message.id)
    complete(message)
  }
}
function readStdout() {
  while (stdoutBuffer.length > 0) {
    if (transport === "framed") {
      const headerEnd = stdoutBuffer.indexOf("\r\n\r\n")
      if (headerEnd === -1) return
      const header = stdoutBuffer.subarray(0, headerEnd).toString("utf8")
      const match = /^Content-Length: (\d+)$/i.exec(header.trim())
      if (match === null) {
        protocolErrors += 1
        throw new Error(`Unexpected framed response header: ${header}`)
      }
      const length = Number(match[1])
      const bodyStart = headerEnd + 4
      const bodyEnd = bodyStart + length
      if (stdoutBuffer.length < bodyEnd) return
      const body = stdoutBuffer.subarray(bodyStart, bodyEnd).toString("utf8")
      stdoutBuffer = stdoutBuffer.subarray(bodyEnd)
      handleMessage(JSON.parse(body), "framed")
      continue
    }
    const lineEnd = stdoutBuffer.indexOf("\n")
    if (lineEnd === -1) return
    const line = stdoutBuffer.subarray(0, lineEnd).toString("utf8")
    stdoutBuffer = stdoutBuffer.subarray(lineEnd + 1)
    if (line.trim().length === 0) continue
    handleMessage(JSON.parse(line), "line")
  }
}
child.stdout.on("data", (chunk) => {
  stdoutBuffer = Buffer.concat([stdoutBuffer, chunk])
  readStdout()
})
child.stderr.on("data", (chunk) => stderr.push(String(chunk)))

function encode(payload) {
  const json = JSON.stringify(payload)
  if (transport === "framed") {
    return `Content-Length: ${Buffer.byteLength(json, "utf8")}\r\n\r\n${json}`
  }
  return `${json}\n`
}

function request(method, params = {}) {
  const id = nextId++
  return new Promise((resolveRequest, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 30_000)
    pending.set(id, (message) => {
      clearTimeout(timer)
      resolveRequest(message)
    })
    child.stdin.write(encode({ jsonrpc: "2.0", id, method, params }))
  })
}

let summary
let childExit
try {
  await request("initialize", {
    capabilities: {},
    clientInfo: { name: "omo-codegraph-multi-repo-qa", version: "1" },
    protocolVersion: "2025-06-18",
  })
  child.stdin.write(encode({ jsonrpc: "2.0", method: "notifications/initialized", params: {} }))
  const tools = await request("tools/list")
  const before = await request("tools/call", {
    arguments: { projectPath: repoB, query: "beforeChange" },
    name: "codegraph_search",
  })
  writeFileSync(join(repoB, "b.ts"), "export function afterChange(): string { return 'after' }\n")
  const after = await request("tools/call", {
    arguments: { projectPath: repoB, query: "afterChange" },
    name: "codegraph_search",
  })
  writeFileSync(join(repoB, "b.ts"), "export function finalChange(): string { return 'final' }\n")
  const final = await request("tools/call", {
    arguments: { projectPath: repoB, query: "finalChange" },
    name: "codegraph_search",
  })

  const beforeText = JSON.stringify(before)
  const afterText = JSON.stringify(after)
  const finalText = JSON.stringify(final)
  if (!beforeText.includes("beforeChange")) throw new Error("initial secondary-repository symbol was not found")
  if (!afterText.includes("afterChange") || afterText.includes("No results found")) {
    throw new Error("secondary-repository result remained stale after the file change")
  }
  if (!finalText.includes("finalChange") || finalText.includes("No results found")) {
    throw new Error("rapid repeated secondary-repository refresh remained stale")
  }
  if (transport === "framed" && framedResponses === 0) {
    throw new Error("framed transport did not receive Content-Length responses")
  }
  if (transport === "line" && lineResponses === 0) {
    throw new Error("line transport did not receive newline JSON responses")
  }

  summary = {
    afterChangeFound: true,
    beforeChangeFound: true,
    codegraphVersion,
    codegraphNoDaemon: env.CODEGRAPH_NO_DAEMON,
    finalChangeFound: true,
    protocolErrors,
    repoBInitializedBeforeProxyStart: true,
    repoBInit: {
      stderr: repoBInitResult.stderr,
      stdout: repoBInitResult.stdout,
    },
    responseFrames: { framed: framedResponses, line: lineResponses },
    stderr: stderr.join(""),
    transport,
    toolNames: tools.result?.tools?.map((tool) => tool.name),
  }
} finally {
  child.stdin.end()
  if (child.exitCode === null) child.kill("SIGTERM")
  if (child.exitCode === null) childExit = await new Promise((resolveExit) => child.once("exit", (code, signal) => resolveExit({ code, signal })))
  else childExit = { code: child.exitCode, signal: child.signalCode }
  rmSync(sandbox, { recursive: true, force: true })
  if (summary !== undefined) {
    summary.childTermination = { pid: child.pid, ...childExit }
    summary.sandboxDeleted = true
    summary.sandboxPath = sandbox
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`)
  }
  process.stderr.write(`cleanup: terminated MCP pid ${child.pid}; deleted ${sandbox}; CODEGRAPH_NO_DAEMON=1\n`)
}
