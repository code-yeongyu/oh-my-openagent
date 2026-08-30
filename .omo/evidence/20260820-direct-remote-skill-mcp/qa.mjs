import { createServer } from "node:http"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { spawn } from "node:child_process"
import {
  sendSse,
  textEvents,
  toolCallEvents,
} from "../../../.agents/skills/opencode-qa/scripts/lib/fake-openai-events.mjs"
import { hasToolResult } from "../../../.agents/skills/opencode-qa/scripts/lib/fake-openai-branches.mjs"

const evidenceDir = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(evidenceDir, "../../..")
const runtimeRoot = mkdtempSync(join(tmpdir(), "omo-direct-remote-qa-"))
const projectDir = join(runtimeRoot, "project")
const sandboxDir = join(runtimeRoot, "sandbox")
const configDir = join(sandboxDir, "config", "opencode")
const skillDir = join(projectDir, ".agents", "skills", "direct-remote")
const opencodeBin = join(
  process.env.HOME ?? "",
  ".bun/install/cache/opencode-darwin-arm64@1.17.7@@@1/bin/opencode",
)

if (!existsSync(opencodeBin)) {
  throw new Error(`OpenCode 1.17.7 QA binary is missing: ${opencodeBin}`)
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

let pingCalls = 0
let modelCalls = 0
let mainStage = 0

const mcpHttp = createServer(async (request, response) => {
  if (request.url !== "/mcp" || request.method !== "POST") {
    response.writeHead(404).end()
    return
  }

  const chunks = []
  for await (const chunk of request) chunks.push(chunk)
  const message = JSON.parse(Buffer.concat(chunks).toString("utf8"))
  if (message.id === undefined) {
    response.writeHead(202).end()
    return
  }

  let result
  if (message.method === "initialize") {
    result = {
      protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "direct-remote-qa", version: "1.0.0" },
    }
  } else if (message.method === "tools/list") {
    result = {
      tools: [{
        name: "ping",
        description: "Return the isolated remote MCP proof.",
        inputSchema: { type: "object", properties: {}, additionalProperties: false },
      }],
    }
  } else if (message.method === "tools/call" && message.params?.name === "ping") {
    pingCalls += 1
    result = { content: [{ type: "text", text: "REMOTE_MCP_OK" }] }
  } else {
    response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
      jsonrpc: "2.0",
      id: message.id,
      error: { code: -32601, message: `Unsupported QA method: ${message.method}` },
    }))
    return
  }

  response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({
    jsonrpc: "2.0",
    id: message.id,
    result,
  }))
})
const mcpPort = await listen(mcpHttp)

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
    sendSse(response, textEvents(modelCalls, "direct remote skill MCP QA"))
    return
  }
  if (!input.includes("DIRECT_REMOTE_QA")) {
    sendSse(response, textEvents(modelCalls, "QA request marker missing"))
    return
  }
  if (mainStage === 2) {
    sendSse(response, textEvents(modelCalls, pingCalls === 1 ? "REMOTE_MCP_OK" : "REMOTE_MCP_NOT_CALLED"))
    return
  }
  if (mainStage === 1 && hasToolResult(input)) {
    mainStage = 2
    sendSse(response, toolCallEvents(modelCalls, "skill_mcp", `call_skill_mcp_${modelCalls}`, {
      mcp_name: "remote",
      tool_name: "ping",
      arguments: {},
    }))
    return
  }
  mainStage = 1
  sendSse(response, toolCallEvents(modelCalls, "skill", `call_skill_${modelCalls}`, {
    name: "direct-remote",
  }))
})
const modelPort = await listen(modelHttp)

mkdirSync(skillDir, { recursive: true })
mkdirSync(configDir, { recursive: true })
mkdirSync(join(sandboxDir, "data"), { recursive: true })
mkdirSync(join(sandboxDir, "cache"), { recursive: true })
mkdirSync(join(sandboxDir, "state"), { recursive: true })
mkdirSync(join(runtimeRoot, "home"), { recursive: true })

writeFileSync(join(skillDir, "SKILL.md"), `---\nname: direct-remote\ndescription: Isolated remote MCP compatibility proof.\n---\n\nLoad the remote MCP and call its ping tool.\n`)
writeFileSync(join(skillDir, "mcp.json"), `${JSON.stringify({
  remote: { url: `http://127.0.0.1:${mcpPort}/mcp` },
}, null, 2)}\n`)
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
writeFileSync(join(configDir, "oh-my-openagent.json"), `${JSON.stringify({
  disabled_mcps: ["websearch", "context7", "grep_app", "codegraph"],
  disabled_hooks: ["auto-update-checker"],
}, null, 2)}\n`)

let result
try {
  result = await collectProcess(
    opencodeBin,
    ["run", "--dir", projectDir, "--format", "json", "--model", "openai/gpt-fake", "DIRECT_REMOTE_QA: load direct-remote and call its ping tool."],
    {
      cwd: projectDir,
      env: {
        ...process.env,
        HOME: join(runtimeRoot, "home"),
        XDG_CONFIG_HOME: join(sandboxDir, "config"),
        XDG_DATA_HOME: join(sandboxDir, "data"),
        XDG_CACHE_HOME: join(sandboxDir, "cache"),
        XDG_STATE_HOME: join(sandboxDir, "state"),
        OPENCODE_DISABLE_AUTOUPDATE: "1",
        OPENCODE_DISABLE_MODELS_FETCH: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  )
} finally {
  await close(mcpHttp)
  await close(modelHttp)
}

writeFileSync(join(evidenceDir, "opencode.ndjson"), result.stdout)
writeFileSync(join(evidenceDir, "opencode.stderr.txt"), result.stderr)

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
  opencodeExitCode: result.code,
  opencodeSignal: result.signal,
  modelCalls,
  pingCalls,
  skillToolCompleted: completedTools.has("skill"),
  skillMcpToolCompleted: completedTools.has("skill_mcp"),
  remoteResultObserved: result.stdout.includes("REMOTE_MCP_OK"),
  isolatedConfigRoot: join(sandboxDir, "config"),
}
writeFileSync(join(evidenceDir, "qa-summary.json"), `${JSON.stringify(proof, null, 2)}\n`)
rmSync(runtimeRoot, { recursive: true, force: true })

if (result.code !== 0 || pingCalls !== 1 || !proof.skillToolCompleted || !proof.skillMcpToolCompleted || !proof.remoteResultObserved) {
  throw new Error(`OpenCode QA failed: ${JSON.stringify(proof)}`)
}

process.stdout.write(`${JSON.stringify(proof, null, 2)}\n`)
