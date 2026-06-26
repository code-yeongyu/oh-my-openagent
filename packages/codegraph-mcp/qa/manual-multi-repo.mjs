import { spawn, spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { createInterface } from "node:readline"

const codegraph = process.env.CODEGRAPH_BIN
if (codegraph === undefined || codegraph.length === 0) {
  throw new Error("Set CODEGRAPH_BIN to the CodeGraph executable under test")
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

const child = spawn(process.execPath, [resolve("dist/cli.js")], {
  cwd: repoA,
  env,
  stdio: ["pipe", "pipe", "pipe"],
})
const pending = new Map()
const stderr = []
let nextId = 1

createInterface({ input: child.stdout }).on("line", (line) => {
  if (line.trim().length === 0) return
  const message = JSON.parse(line)
  const complete = pending.get(message.id)
  if (complete !== undefined) {
    pending.delete(message.id)
    complete(message)
  }
})
child.stderr.on("data", (chunk) => stderr.push(String(chunk)))

function request(method, params = {}) {
  const id = nextId++
  return new Promise((resolveRequest, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${method}`)), 30_000)
    pending.set(id, (message) => {
      clearTimeout(timer)
      resolveRequest(message)
    })
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`)
  })
}

try {
  await request("initialize", {
    capabilities: {},
    clientInfo: { name: "omo-codegraph-multi-repo-qa", version: "1" },
    protocolVersion: "2025-06-18",
  })
  child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized", params: {} })}\n`)
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

  process.stdout.write(`${JSON.stringify({
    afterChangeFound: true,
    beforeChangeFound: true,
    codegraphVersion: versionResult.stdout.trim(),
    finalChangeFound: true,
    stderr: stderr.join(""),
    toolNames: tools.result?.tools?.map((tool) => tool.name),
  }, null, 2)}\n`)
} finally {
  child.stdin.end()
  if (child.exitCode === null) child.kill("SIGTERM")
  if (child.exitCode === null) await new Promise((resolveExit) => child.once("exit", resolveExit))
  rmSync(sandbox, { recursive: true, force: true })
  process.stderr.write(`cleanup: terminated MCP pid ${child.pid}; deleted ${sandbox}; CODEGRAPH_NO_DAEMON=1\n`)
}
