import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { createServer } from "node:http"
import { homedir, tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import {
  sendSse,
  textEvents,
  toolCallEvents,
} from "../../../.agents/skills/opencode-qa/scripts/lib/fake-openai-events.mjs"
import { hasToolResult } from "../../../.agents/skills/opencode-qa/scripts/lib/fake-openai-branches.mjs"

const evidenceDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(evidenceDir, "../../..")
const runtimeRoot = mkdtempSync(join(tmpdir(), "omo-xquik-skill-qa-"))
const projectDir = join(runtimeRoot, "project")
const sandboxDir = join(runtimeRoot, "sandbox")
const isolatedHome = join(runtimeRoot, "home")
const configDir = join(sandboxDir, "config", "opencode")
const opencodeBin = join(
  homedir(),
  ".bun/install/cache/opencode-darwin-arm64@1.17.7@@@1/bin/opencode",
)

if (!existsSync(opencodeBin)) {
  throw new Error(`OpenCode 1.17.7 QA binary is missing: ${opencodeBin}`)
}

function countRealSessions() {
  const database = join(homedir(), ".local", "share", "opencode", "opencode.db")
  if (!existsSync(database)) return null
  const result = spawnSync("sqlite3", [database, "select count(*) from session;"], {
    encoding: "utf8",
  })
  if (result.status !== 0) return null
  const count = Number.parseInt(result.stdout.trim(), 10)
  return Number.isFinite(count) ? count : null
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        reject(new Error("QA server did not expose a TCP address."))
        return
      }
      resolve(address.port)
    })
  })
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve())
  })
}

function collectProcess(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options)
    let stdout = ""
    let stderr = ""
    const timer = setTimeout(() => child.kill("SIGTERM"), 60_000)

    child.stdout.on("data", (chunk) => { stdout += chunk.toString() })
    child.stderr.on("data", (chunk) => { stderr += chunk.toString() })
    child.once("error", reject)
    child.once("exit", (code, signal) => {
      clearTimeout(timer)
      resolve({ code, signal, stdout, stderr })
    })
  })
}

function sanitize(value) {
  return value
    .replaceAll(repoRoot, "<repo-root>")
    .replaceAll(runtimeRoot, "<qa-root>")
    .replaceAll(homedir(), "<home>")
}

let modelCalls = 0
let mainStage = 0
let docsToolResultObserved = false

const modelHttp = createServer(async (request, response) => {
  if (request.method !== "POST" || !request.url?.includes("/responses")) {
    response.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "not found" }))
    return
  }

  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"))
  const input = JSON.stringify(payload.input ?? payload.messages ?? payload)
  modelCalls += 1

  if (input.includes("Generate a title")) {
    sendSse(response, textEvents(modelCalls, "Xquik shared Skill QA"))
    return
  }
  if (!input.includes("XQUIK_SKILL_QA")) {
    sendSse(response, textEvents(modelCalls, "QA request marker missing"))
    return
  }
  if (mainStage === 2 && hasToolResult(input)) {
    docsToolResultObserved = input.includes("https://docs.xquik.com/")
    sendSse(response, textEvents(
      modelCalls,
      docsToolResultObserved ? "XQUIK_DOCS_MCP_OK" : "XQUIK_DOCS_MCP_RESULT_MISSING",
    ))
    return
  }
  if (mainStage === 1 && hasToolResult(input)) {
    mainStage = 2
    sendSse(response, toolCallEvents(modelCalls, "skill_mcp", `call_skill_mcp_${modelCalls}`, {
      mcp_name: "xquik-docs",
      tool_name: "search_xquik",
      arguments: { query: "MCP authentication" },
    }))
    return
  }
  mainStage = 1
  sendSse(response, toolCallEvents(modelCalls, "skill", `call_skill_${modelCalls}`, {
    name: "xquik",
  }))
})
const modelPort = await listen(modelHttp)

mkdirSync(projectDir, { recursive: true })
mkdirSync(configDir, { recursive: true })
mkdirSync(join(sandboxDir, "data"), { recursive: true })
mkdirSync(join(sandboxDir, "cache"), { recursive: true })
mkdirSync(join(sandboxDir, "state"), { recursive: true })
mkdirSync(join(runtimeRoot, "tmp"), { recursive: true })
mkdirSync(join(isolatedHome, ".omo"), { recursive: true })

writeFileSync(join(configDir, "opencode.jsonc"), `${JSON.stringify({
  plugin: [pathToFileURL(join(repoRoot, "packages/omo-opencode/src/index.ts")).href],
  model: "openai/gpt-fake",
  provider: {
    openai: {
      options: { apiKey: "fake-key", baseURL: `http://127.0.0.1:${modelPort}/v1`, timeout: 30_000 },
      models: { "gpt-fake": { tool_call: true, limit: { context: 200_000, output: 8_192 } } },
    },
  },
  permission: { skill: "allow", skill_mcp: "allow" },
}, null, 2)}\n`)
writeFileSync(join(isolatedHome, ".omo", "omo.jsonc"), `${JSON.stringify({
  "[opencode]": {
    disabled_mcps: ["websearch", "context7", "grep_app", "codegraph"],
    disabled_hooks: ["auto-update-checker"],
  },
}, null, 2)}\n`)

const realSessionsBefore = countRealSessions()
let result
try {
  result = await collectProcess(
    opencodeBin,
    ["run", "--dir", projectDir, "--format", "json", "--model", "openai/gpt-fake", "XQUIK_SKILL_QA: load xquik and search its docs MCP for authentication."],
    {
      cwd: projectDir,
      env: {
        HOME: isolatedHome,
        LANG: "en_US.UTF-8",
        OMO_DISABLE_POSTHOG: "1",
        OPENCODE_DISABLE_AUTOCOMPACT: "1",
        OPENCODE_DISABLE_AUTOUPDATE: "1",
        OPENCODE_DISABLE_MODELS_FETCH: "1",
        OPENCODE_TEST_HOME: isolatedHome,
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        TMPDIR: join(runtimeRoot, "tmp"),
        XDG_CACHE_HOME: join(sandboxDir, "cache"),
        XDG_CONFIG_HOME: join(sandboxDir, "config"),
        XDG_DATA_HOME: join(sandboxDir, "data"),
        XDG_STATE_HOME: join(sandboxDir, "state"),
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
} finally {
  await close(modelHttp)
}
const realSessionsAfter = countRealSessions()

writeFileSync(join(evidenceDir, "opencode.ndjson"), sanitize(result.stdout))
writeFileSync(join(evidenceDir, "opencode.stderr.txt"), sanitize(result.stderr))

const toolEvents = result.stdout
  .split("\n")
  .filter(Boolean)
  .flatMap((line) => {
    try {
      const event = JSON.parse(line)
      return event.type === "tool_use" ? [event] : []
    } catch {
      return []
    }
  })
const completedTools = new Set(
  toolEvents
    .filter((event) => event.part?.state?.status === "completed")
    .map((event) => event.part.tool),
)
const proof = {
  docsToolResultObserved,
  markerObserved: result.stdout.includes("XQUIK_DOCS_MCP_OK"),
  modelCalls,
  opencodeExitCode: result.code,
  opencodeSignal: result.signal,
  realSessionsAfter,
  realSessionsBefore,
  realSessionsUnchanged: realSessionsBefore === realSessionsAfter,
  skillMcpToolCompleted: completedTools.has("skill_mcp"),
  skillToolCompleted: completedTools.has("skill"),
}
writeFileSync(join(evidenceDir, "qa-summary.json"), `${JSON.stringify(proof, null, 2)}\n`)
rmSync(runtimeRoot, { recursive: true, force: true })

if (
  result.code !== 0 ||
  !proof.skillToolCompleted ||
  !proof.skillMcpToolCompleted ||
  !proof.docsToolResultObserved ||
  !proof.markerObserved ||
  !proof.realSessionsUnchanged
) {
  throw new Error(`OpenCode QA failed: ${JSON.stringify(proof)}`)
}

process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`)
