import { spawn } from "node:child_process"
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

const repoRoot = resolve(import.meta.dirname, "../../..")
const senpiBin = join(repoRoot, "node_modules", ".bin", "senpi")
const pluginExtension = join(repoRoot, "packages", "omo-senpi", "plugin", "extensions", "omo.js")
const requests = []

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    if (request.method === "POST") {
      requests.push({
        path: new URL(request.url).pathname,
        bytes: (await request.arrayBuffer()).byteLength,
      })
    }
    return Response.json({ status: "ok" })
  },
})

const sandboxes = []

function providerSource() {
  return `const model = { id: "gpt-5.6-sol", name: "QA", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200000, maxTokens: 4096 }
export default function register(pi) {
  pi.registerProvider("openai", {
    name: "Local telemetry QA",
    baseUrl: "file://telemetry-qa",
    apiKey: "mock",
    api: "openai-completions",
    models: [model],
    streamSimple(_model, _context, options) {
      const final = { role: "assistant", content: [{ type: "text", text: "Telemetry QA complete." }], api: "openai-completions", provider: "openai", model: "gpt-5.6-sol", usage: { input: 4, output: 4, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 8, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: "stop", timestamp: Date.now() }
      let done = false
      return {
        result: async () => final,
        [Symbol.asyncIterator]() {
          return {
            async next() {
              if (done || options?.signal?.aborted) return { value: undefined, done: true }
              done = true
              return { value: { type: "done", reason: "stop", message: final }, done: false }
            },
          }
        },
      }
    },
  })
}
`
}

function createSandbox(label, telemetryEnabled) {
  const root = mkdtempSync(join(tmpdir(), `omo-telemetry-removal-${label}-`))
  const agentDir = join(root, "agent")
  const cwd = join(root, "project")
  const home = join(root, "home")
  const sessions = join(root, "sessions")
  mkdirSync(agentDir, { recursive: true })
  mkdirSync(join(cwd, ".omo"), { recursive: true })
  mkdirSync(home, { recursive: true })
  mkdirSync(sessions, { recursive: true })
  writeFileSync(join(cwd, ".omo", "omo.json"), `${JSON.stringify({
    telemetry: { enabled: telemetryEnabled },
  })}\n`)
  const provider = join(root, "provider.mjs")
  writeFileSync(provider, providerSource())
  sandboxes.push(root)
  return { root, agentDir, cwd, home, sessions, provider }
}

function hasPayloadHistory(root) {
  const pending = [root]
  while (pending.length > 0) {
    const current = pending.pop()
    if (current === undefined || !existsSync(current)) continue
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name)
      if (entry.isDirectory()) pending.push(path)
      else if (entry.name === "last-payloads.json") return true
    }
  }
  return false
}

async function runScenario(label, extraEnv, telemetryEnabled = true) {
  const sandbox = createSandbox(label, telemetryEnabled)
  const before = requests.length
  const env = {
    PATH: process.env.PATH,
    HOME: sandbox.home,
    OMO_CODING_AGENT_DIR: sandbox.agentDir,
    SENPI_CODING_AGENT_DIR: sandbox.agentDir,
    SENPI_CODING_AGENT_SESSION_DIR: sandbox.sessions,
    PI_OFFLINE: "1",
    PI_TELEMETRY: "0",
    POSTHOG_API_KEY: "phc_test",
    POSTHOG_HOST: `http://127.0.0.1:${server.port}`,
    ...extraEnv,
  }
  const child = spawn(senpiBin, [
    "--print",
    "--offline",
    "--no-session",
    "--no-extensions",
    "--no-skills",
    "--no-context-files",
    "--no-approve",
    "-e",
    sandbox.provider,
    "-e",
    pluginExtension,
    "--provider",
    "openai",
    "--model",
    "gpt-5.6-sol",
    "Telemetry QA prompt",
  ], { cwd: sandbox.cwd, env, stdio: ["ignore", "pipe", "pipe"] })
  let stdout = ""
  let stderr = ""
  child.stdout.on("data", (chunk) => { stdout += chunk.toString("utf8") })
  child.stderr.on("data", (chunk) => { stderr += chunk.toString("utf8") })
  const exit = await Promise.race([
    new Promise((resolveExit) => child.once("close", (code, signal) => resolveExit({ code, signal }))),
    new Promise((_, reject) => {
      const timeout = setTimeout(() => {
        child.kill("SIGTERM")
        reject(new Error(`${label} timed out`))
      }, 30_000)
      child.once("close", () => clearTimeout(timeout))
    }),
  ])
  if (exit.code !== 0) throw new Error(`${label} failed code=${exit.code} signal=${exit.signal}\n${stderr}`)
  return {
    label,
    requestCount: requests.length - before,
    payloadHistoryExists: hasPayloadHistory(sandbox.root),
    stdoutIncludesCompletion: stdout.includes("Telemetry QA complete."),
    stderrTail: stderr.slice(-500),
  }
}

let result
try {
  const enabled = await runScenario("enabled", {})
  const optedOut = await runScenario("opted-out", { OMO_DISABLE_POSTHOG: "1" })
  result = {
    enabled,
    optedOut,
    pass: enabled.requestCount > 0
      && optedOut.requestCount === 0
      && !enabled.payloadHistoryExists
      && !optedOut.payloadHistoryExists
      && enabled.stdoutIncludesCompletion
      && optedOut.stdoutIncludesCompletion,
  }
  if (!result.pass) throw new Error(`runtime assertions failed: ${JSON.stringify(result)}`)
  writeFileSync(join(import.meta.dirname, "runtime-result.json"), `${JSON.stringify(result, null, 2)}\n`)
  console.log(JSON.stringify(result, null, 2))
} finally {
  server.stop(true)
  const cleanup = sandboxes.map((root) => {
    rmSync(root, { recursive: true, force: true })
    return { root: root.replace(/omo-telemetry-removal-[^/]+-[^/]+$/, "<temp-sandbox>"), removed: !existsSync(root) }
  })
  writeFileSync(join(import.meta.dirname, "runtime-cleanup.json"), `${JSON.stringify({
    serverStopped: true,
    port: server.port,
    sandboxes: cleanup,
  }, null, 2)}\n`)
}
