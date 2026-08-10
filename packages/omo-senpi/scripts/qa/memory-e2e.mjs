#!/usr/bin/env node
// Live end-to-end QA for the omo-senpi memory component (plan todo 37).
// Drives the REAL senpi binary in an isolated agent dir + OMO_MEMORY_HOME, then asserts:
//   S1 memory tool commit -> git repo created + commit, next-run system prompt carries the sentinel block
//   S2 step-count reflection spawns a quick-category child (shimmed SENPI_BIN) and merges a reflection commit
//   S3 /search finds a prior message across sessions
//   S4 /palace generates a self-contained 0600 HTML with machine-checkable payload
//   S5 memory.enabled=false leaves the host byte-identical (no tools, no sentinel, no dirs)
// Real ~/.senpi/agent and ~/.omo/memory are hashed before/after as the isolation proof.
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { createHash } from "node:crypto"
import { homedir, tmpdir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createSandbox, seedSandbox } from "./drive.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const mockProviderEntry = join(scriptDir, "task-e2e-mock-provider.ts")
const results = []
const failures = []

function record(name, ok, detail) {
  results.push({ name, ok, detail })
  if (!ok) failures.push({ name, detail })
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` :: ${detail}` : ""}`)
}

function fail(message) {
  throw new Error(message)
}

function findOnPath(bin) {
  if (bin.includes("/")) return existsSync(bin) ? bin : null
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = resolve(dir || ".", bin)
    if (existsSync(candidate)) return candidate
  }
  return null
}

const senpiBin = process.env.SENPI_BIN ?? findOnPath("senpi")
if (senpiBin === null) fail("senpi binary not found (set SENPI_BIN)")

const ISOLATION_EXCLUDE = new Set(["sessions", "senpi-debug.log", "mcp-cache.json", "mcp-auth", "settings.json", "telemetry.log", "goals"])

function hashDir(root, exclude = undefined) {
  if (!existsSync(root)) return "absent"
  const hash = createHash("sha256")
  const walk = (dir) => {
    for (const name of readdirSync(dir).toSorted()) {
      if (exclude !== undefined && exclude(name)) continue
      const full = join(dir, name)
      const st = statSync(full)
      if (st.isDirectory()) { walk(full); continue }
      hash.update(name); hash.update(readFileSync(full))
    }
  }
  walk(root)
  return hash.digest("hex")
}

const isolationExclude = (name) => ISOLATION_EXCLUDE.has(name)

const realSenpiBefore = hashDir(join(homedir(), ".senpi", "agent"), isolationExclude)
const realOmoMemoryBefore = hashDir(join(homedir(), ".omo", "memory"))

function baseEnv(sandbox, extra = {}) {
  return {
    ...process.env,
    SENPI_CODING_AGENT_DIR: sandbox.agentDir,
    XDG_CONFIG_HOME: sandbox.xdgConfigHome,
    OMO_MEMORY_HOME: join(sandbox.root, "memory"),
    PATH: process.env.PATH ?? "",
    ...extra,
  }
}

function runSenpi(sandbox, { prompt, env = {}, args = [], cwd }) {
  const fullArgs = ["-e", mockProviderEntry, "-p", "--mode", "json", "--provider", "omo-mock", "--model", "mock-1", "--session-dir", join(sandbox.agentDir, "sessions"), ...args, prompt]
  const run = spawnSync(senpiBin, fullArgs, {
    cwd: cwd ?? sandbox.cwd,
    env: baseEnv(sandbox, env),
    encoding: "utf8",
    timeout: 120_000,
  })
  return { status: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "" }
}

function waitFor(predicate, { timeoutMs = 90_000, intervalMs = 500, description } = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const start = Date.now()
    const poll = () => {
      try {
        const value = predicate()
        if (value) { resolvePromise(value); return }
      } catch {}
      if (Date.now() - start > timeoutMs) {
        rejectPromise(new Error(`timeout waiting for ${description}`))
        return
      }
      setTimeout(poll, intervalMs)
    }
    poll()
  })
}

function scenarioSandbox() {
  const sandbox = createSandbox()
  seedSandbox(sandbox)
  mkdirSync(join(sandbox.agentDir, "sessions"), { recursive: true })
  mkdirSync(join(sandbox.cwd, ".omo"), { recursive: true })
  // The category resolver gates on registry.getAvailable(), which drops providers without
  // configured auth; the scripted mock provider therefore needs an auth entry to be selectable.
  writeFileSync(join(sandbox.agentDir, "auth.json"), `${JSON.stringify({ "omo-mock": { type: "api_key", key: "mock" } }, null, 2)}\n`)
  return sandbox
}

function writeOmoConfig(sandbox, memoryOverrides = {}) {
  const config = {
    categories: { quick: { description: "QA mock quick category", model: "omo-mock/mock-1" } },
    memory: {
      enabled: true,
      reflection: { trigger: { step_count: 0, on_compaction: false }, ...memoryOverrides },
    },
  }
  writeFileSync(join(sandbox.cwd, ".omo", "omo.json"), `${JSON.stringify(config, null, 2)}\n`)
}

function writeMockScript(sandbox, script, name = "mock-script.json") {
  const path = join(sandbox.cwd, name)
  writeFileSync(path, `${JSON.stringify(script, null, 2)}\n`)
  return path
}

function memoryRepos(memoryHome) {
  const agentsDir = join(memoryHome, "agents")
  if (!existsSync(agentsDir)) return []
  return readdirSync(agentsDir).map((name) => join(agentsDir, name, "repo")).filter(existsSync)
}

function gitLog(repo) {
  const run = spawnSync("git", ["log", "--format=%s | %ae", "HEAD"], { cwd: repo, encoding: "utf8" })
  return run.status === 0 ? run.stdout.trim() : ""
}

async function scenario1() {
  const sandbox = scenarioSandbox()
  writeOmoConfig(sandbox)
  writeMockScript(sandbox, {
    parentSteps: [
      { type: "tool_call", name: "memory", arguments: { command: "create", file_path: "system/facts.md", description: "harness facts", file_text: "senpi is a pi harness", reason: "seed harness fact for QA" } },
      { type: "text", text: "memory seeded" },
    ],
    childSteps: [{ type: "text", text: "unused" }],
  })
  const dumpLog = join(sandbox.root, "sysdump.log")
  const first = runSenpi(sandbox, { prompt: "remember that senpi is a pi harness", env: { MOCK_DUMP_SYSTEM: dumpLog } })
  if (first.status !== 0) return record("S1 first senpi run", false, first.stderr.slice(-400))

  const repos = memoryRepos(join(sandbox.root, "memory"))
  if (repos.length === 0) return record("S1 repo created", false, "no identity repo under OMO_MEMORY_HOME")
  const log = gitLog(repos[0])
  record("S1 commit landed", log.includes("seed harness fact for QA"), log || "<empty git log>")
  record("S1 author is identity", log.includes("@omo.local"), log.split("\n")[0] ?? "")

  writeMockScript(sandbox, {
    parentSteps: [{ type: "text", text: "answer" }],
    childSteps: [{ type: "text", text: "unused" }],
  })
  const second = runSenpi(sandbox, { prompt: "what do you remember", env: { MOCK_DUMP_SYSTEM: dumpLog } })
  if (second.status !== 0) return record("S1 second senpi run", false, second.stderr.slice(-400))
  const dump = readFileSync(dumpLog, "utf8")
  record("S1 sentinel in next-run prompt", dump.includes("<!-- senpi-memory:"), dumpLog)
  record("S1 memory body in next-run prompt", dump.includes("senpi is a pi harness"), dumpLog)
  return { sandbox }
}

async function scenario2() {
  const sandbox = scenarioSandbox()
  writeOmoConfig(sandbox, { trigger: { step_count: 1, on_compaction: false } })
  const shimPath = join(sandbox.root, "senpi-shim")
  writeFileSync(shimPath, `#!/bin/sh\nexec ${JSON.stringify(senpiBin)} -e ${JSON.stringify(mockProviderEntry)} "$@"\n`)
  spawnSync("chmod", ["+x", shimPath])

  writeMockScript(sandbox, {
    parentSteps: [
      { type: "tool_call", name: "memory", arguments: { command: "create", file_path: "system/facts.md", description: "seed", file_text: "seed for dreaming", reason: "seed memory before reflection" } },
      { type: "text", text: "first answer" },
    ],
    childSteps: [],
  })
  const first = runSenpi(sandbox, { prompt: "seed then settle" })
  if (first.status !== 0) return record("S2 seeding run", false, first.stderr.slice(-400))

  const memoryHome = join(sandbox.root, "memory")
  const repos = memoryRepos(memoryHome)
  if (repos.length === 0) return record("S2 repo exists", false, "no repo")
  const repo = repos[0]

  const childScript = {
    parentSteps: [
      { type: "tool_call", name: "edit", arguments: { path: "system/facts.md", edits: [{ oldText: "seed for dreaming", newText: "seed for dreaming\ndreamed fact" }] } },
      { type: "tool_call", name: "bash", arguments: { command: "git add system/facts.md && git commit -m 'feat(reflection): dreamed a memory'" } },
      { type: "text", text: "reflection written" },
    ],
    childSteps: [],
  }
  writeFileSync(join(repo, "mock-script.json"), `${JSON.stringify(childScript, null, 2)}\n`)
  const scriptCommit = spawnSync("git", ["add", "mock-script.json"], { cwd: repo })
  if (scriptCommit.status !== 0) return record("S2 child script staging", false, scriptCommit.stderr?.toString() ?? "")
  const scriptCommitResult = spawnSync("git", ["commit", "-m", "qa: child script"], { cwd: repo })
  if (scriptCommitResult.status !== 0) return record("S2 child script commit", false, scriptCommitResult.stderr?.toString() ?? "")

  writeMockScript(sandbox, { parentSteps: [{ type: "text", text: "triggering turn" }], childSteps: [] })
  const run = runSenpi(sandbox, { prompt: "trigger one reflection", env: { SENPI_BIN: shimPath } })
  if (run.status !== 0) {
    console.error("S2 parent stderr:", run.stderr.slice(-1200))
    return record("S2 parent senpi run", false, run.stderr.slice(-400))
  }
  console.error("S2 parent stderr (rc0):", run.stderr.slice(-600))

  const completion = await waitFor(
    () => {
      const agentsDir = join(memoryHome, "agents")
      for (const agent of readdirSync(agentsDir)) {
        const completionsDir = join(agentsDir, agent, "runtime", "reflection", "completions")
        if (!existsSync(completionsDir)) continue
        const files = readdirSync(completionsDir).filter((name) => name.endsWith(".json"))
        if (files.length === 0) continue
        const record_ = JSON.parse(readFileSync(join(completionsDir, files[0]), "utf8"))
        return { record: record_, completionsDir }
      }
      return undefined
    },
    { timeoutMs: 90_000, description: "reflection completion record" },
  ).catch((error) => error)

  if (completion instanceof Error) {
    console.error("S2 completion wait failed. reflection dirs:", existsSync(join(memoryHome, "agents")) ? readdirSync(join(memoryHome, "agents")).map((a) => readdirSync(join(memoryHome, "agents", a, "runtime"), { withFileTypes: true }).map((d) => d.name).join(",")) : "none")
    return record("S2 completion record", false, completion.message)
  }
  record("S2 completion record", true, String(completion.record.outcome))
  record("S2 outcome merged", completion.record.outcome === "merged", JSON.stringify(completion.record))
  record("S2 quick category recorded", completion.record.category === "quick", completion.record.category)
  const log = gitLog(repo)
  record("S2 merge commit landed", /merge\(reflection\)/.test(log), log.split("\n").slice(0, 3).join(" || "))
  record("S2 dreamed fact merged into parent repo", existsSync(join(repo, "system", "facts.md")) && readFileSync(join(repo, "system", "facts.md"), "utf8").includes("dreamed fact"), "system/facts.md")
}

function buildCommandContext(sandbox, overrides = {}) {
  return {
    mode: "print",
    hasUI: false,
    cwd: sandbox.cwd,
    agentDir: sandbox.agentDir,
    ...overrides,
  }
}

async function scenario3And4() {
  const sandbox = scenarioSandbox()
  writeOmoConfig(sandbox)
  writeMockScript(sandbox, {
    parentSteps: [
      { type: "tool_call", name: "memory", arguments: { command: "create", file_path: "system/facts.md", description: "qa fact", file_text: "searchable unique phrase zqxwvb", reason: "seed searchable memory" } },
      { type: "text", text: "searchable unique phrase zqxwvb" },
    ],
    childSteps: [],
  })
  const run = runSenpi(sandbox, { prompt: "say the unique phrase" })
  if (run.status !== 0) return record("S3 seeding senpi run", false, run.stderr.slice(-400))

  const bundleModule = await import("../../src/extension/index.ts")
  const { MemoryFakeExtensionAPI } = await import("../../src/components/memory/memory.test-support.ts")
  const pi = new MemoryFakeExtensionAPI()
  process.env.SENPI_CODING_AGENT_DIR = sandbox.agentDir
  process.env.OMO_MEMORY_HOME = join(sandbox.root, "memory")
  process.env.XDG_CONFIG_HOME = sandbox.xdgConfigHome
  const originalCwd = process.cwd()
  process.chdir(sandbox.cwd)
  try {
    const composed = bundleModule.default
    await composed(pi, {})
    const searchCommand = pi.commands.find((command) => command.name === "search")
    if (searchCommand === undefined) return record("S3 search command registered", false, `commands: ${pi.commands.map((c) => c.name).join(",")}`)
    const output = await searchCommand.options.handler("zqxwvb", buildCommandContext(sandbox))
    record("S3 search finds prior message", typeof output === "string" && output.includes("zqxwvb"), String(output).slice(0, 200))

    const palaceCommand = pi.commands.find((command) => command.name === "palace")
    if (palaceCommand === undefined) return record("S4 palace command registered", false, "not registered")
    await pi.dispatch("session_start", {}, buildCommandContext(sandbox, {
      sessionManager: { getSessionId: () => "palace-session", getEntries: () => [] },
    }))
    let palacePath = ""
    const palaceOutput = await palaceCommand.options.handler("", buildCommandContext(sandbox, {
      hasUI: false,
      output: (text) => { palacePath = text },
      sessionManager: { getSessionId: () => "palace-session" },
    }))
    const htmlPathMatch = String(palacePath || palaceOutput).match(/(\/\S+\.html)/)
    if (htmlPathMatch === null) return record("S4 palace path returned", false, String(palaceOutput).slice(0, 200))
    const htmlPath = htmlPathMatch[1]
    if (!existsSync(htmlPath)) return record("S4 palace file exists", false, htmlPath)
    const mode = statSync(htmlPath).mode & 0o777
    const html = readFileSync(htmlPath, "utf8")
    record("S4 palace file mode 0600", mode === 0o600, String(mode.toString(8)))
    const tabValues = new Set([...html.matchAll(/data-tab="([^"]+)"/g)].map((match) => match[1]))
    record("S4 palace tabs", ["core", "external", "history", "reflection"].every((tab) => tabValues.has(tab)), [...tabValues].join(","))
    record("S4 palace persona entry", html.includes("system/persona.md"), htmlPath)
  } finally {
    process.chdir(originalCwd)
  }
}

async function scenario5() {
  const sandbox = scenarioSandbox()
  const config = {
    categories: { quick: { description: "QA mock quick category", model: "omo-mock/mock-1" } },
    memory: { enabled: false },
  }
  writeFileSync(join(sandbox.cwd, ".omo", "omo.json"), `${JSON.stringify(config, null, 2)}\n`)
  writeMockScript(sandbox, { parentSteps: [{ type: "text", text: "plain answer" }], childSteps: [] })
  const dumpLog = join(sandbox.root, "sysdump-disabled.log")
  const run = runSenpi(sandbox, { prompt: "hello", env: { MOCK_DUMP_SYSTEM: dumpLog } })
  if (run.status !== 0) return record("S5 disabled run", false, run.stderr.slice(-400))
  const dump = existsSync(dumpLog) ? readFileSync(dumpLog, "utf8") : ""
  record("S5 no sentinel when disabled", !dump.includes("<!-- senpi-memory:"), dumpLog)
  record("S5 no memory dirs when disabled", memoryRepos(join(sandbox.root, "memory")).length === 0, join(sandbox.root, "memory"))
}

async function main() {
  console.log(`senpi: ${senpiBin}`)
  await scenario1()
  await scenario2()
  await scenario3And4()
  await scenario5()

  const realSenpiAfter = hashDir(join(homedir(), ".senpi", "agent"), isolationExclude)
  const realOmoMemoryAfter = hashDir(join(homedir(), ".omo", "memory"))
  record("isolation: real ~/.senpi/agent untouched (volatile paths excluded)", realSenpiBefore === realSenpiAfter, `${realSenpiBefore.slice(0, 12)} vs ${realSenpiAfter.slice(0, 12)}`)
  record("isolation: real ~/.omo/memory untouched", realOmoMemoryBefore === realOmoMemoryAfter, `${realOmoMemoryBefore.slice(0, 12)} vs ${realOmoMemoryAfter.slice(0, 12)}`)

  console.log(JSON.stringify({ ok: failures.length === 0, total: results.length, failures }, null, 2))
  process.exit(failures.length === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
