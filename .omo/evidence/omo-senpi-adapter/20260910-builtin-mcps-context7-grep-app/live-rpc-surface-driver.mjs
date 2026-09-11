#!/usr/bin/env node
// Throwaway live QA: boots the REAL senpi runtime in RPC mode inside an isolated agent dir with the
// built omo extension and asks the host which MCP servers it loaded.
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { homedir, tmpdir } from "node:os"
import { join, resolve } from "node:path"

const repoRoot = resolve(process.argv[2] ?? ".")
const bundle = join(repoRoot, "packages", "omo-senpi", "plugin", "extensions", "omo.js")
const senpiCli = join(repoRoot, "node_modules", "@code-yeongyu", "senpi", "dist", "cli.js")
const scenario = process.argv[3] ?? "anonymous"
const context7Key = scenario === "placeholder" ? "<YOUR_API_KEY>" : undefined

function digestDir(dir) {
  if (!existsSync(dir)) return "absent"
  const hash = createHash("sha256")
  const walk = (current, depth) => {
    if (depth > 4) return
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) {
        hash.update(`D:${path}\0`)
        walk(path, depth + 1)
        continue
      }
      if (!entry.isFile()) continue
      hash.update(`F:${path}:${statSync(path).size}\0`)
    }
  }
  walk(dir, 0)
  return hash.digest("hex")
}

const realSenpiAgentDir = join(homedir(), ".senpi", "agent")
const realOmoAgentDir = join(homedir(), ".omo", "agent")
const before = { senpi: digestDir(realSenpiAgentDir), omo: digestDir(realOmoAgentDir) }

const sandbox = mkdtempSync(join(tmpdir(), "omo-senpi-mcp-surface-"))
const home = join(sandbox, "home")
const agentDir = join(sandbox, "agent")
const workspace = join(sandbox, "workspace")
for (const dir of [home, agentDir, workspace, join(sandbox, "xdg")]) mkdirSync(dir, { recursive: true })

const env = {
  PATH: "/Users/yeongyu/.bun/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin",
  HOME: home,
  TERM: "dumb",
  XDG_DATA_HOME: join(sandbox, "xdg", "data"),
  XDG_CONFIG_HOME: join(sandbox, "xdg", "config"),
  XDG_STATE_HOME: join(sandbox, "xdg", "state"),
  XDG_CACHE_HOME: join(sandbox, "xdg", "cache"),
  SENPI_CODING_AGENT_DIR: agentDir,
  ...(context7Key === undefined ? {} : { CONTEXT7_API_KEY: context7Key }),
}

if (scenario === "disabled-by-mcp-json") {
  writeFileSync(join(agentDir, "mcp.json"), `${JSON.stringify({ mcpServers: { context7: { enabled: false } } }, null, 2)}\n`)
}

const child = spawn("bun", [senpiCli, "--mode", "rpc", "-ne", "-e", bundle, "--no-session"], {
  cwd: workspace,
  env,
  stdio: ["pipe", "pipe", "pipe"],
})

let stdout = ""
let stderr = ""
const responses = []
child.stdout.setEncoding("utf8")
child.stdout.on("data", (chunk) => {
  stdout += chunk
  let index = stdout.indexOf("\n")
  while (index >= 0) {
    const line = stdout.slice(0, index).trim()
    stdout = stdout.slice(index + 1)
    index = stdout.indexOf("\n")
    if (line.length === 0) continue
    try {
      responses.push(JSON.parse(line))
    } catch {
      responses.push({ unparsed: line })
    }
  }
})
child.stderr.setEncoding("utf8")
child.stderr.on("data", (chunk) => {
  stderr += chunk
})

const deadline = Date.now() + 60_000
const surfaces = await new Promise((resolvePromise, rejectPromise) => {
  const timer = setInterval(() => {
    const answer = responses.find((entry) => entry.command === "get_loaded_surfaces")
    if (answer !== undefined) {
      clearInterval(timer)
      resolvePromise(answer)
      return
    }
    if (Date.now() > deadline) {
      clearInterval(timer)
      rejectPromise(new Error(`timed out; stderr=${stderr.slice(0, 2000)}`))
    }
  }, 200)
  setTimeout(() => {
    child.stdin.write(`${JSON.stringify({ id: "surfaces-1", type: "get_loaded_surfaces" })}\n`)
  }, 3000)
})

child.kill("SIGKILL")
await new Promise((done) => child.once("exit", done))

const after = { senpi: digestDir(realSenpiAgentDir), omo: digestDir(realOmoAgentDir) }

console.log(JSON.stringify({
  scenario,
  sandbox,
  agentDir,
  context7KeyProvided: context7Key !== undefined,
  mcpServers: surfaces.data?.mcpServers ?? null,
  omoExtensionLoaded: (surfaces.data?.extensions ?? []).some((extension) => String(extension.path ?? extension.name ?? "").includes("omo.js")),
  realSenpiAgentDirUnchanged: before.senpi === after.senpi,
  realOmoAgentDirUnchanged: before.omo === after.omo,
  stderrTail: stderr.slice(-600),
}, null, 1))
