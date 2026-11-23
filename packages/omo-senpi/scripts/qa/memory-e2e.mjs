#!/usr/bin/env bun
// Live end-to-end QA for the omo-senpi memory component (plan todo 37).
// Drives the REAL senpi binary in an isolated HOME, agent dir and OMO_MEMORY_HOME, then asserts:
//   S1 memory tool commit -> git repo created + commit; a durable fixture projects on the next run
//   S2 step-count reflection spawns a quick-category child (shimmed SENPI_BIN) and merges a reflection commit
//   S3 /search finds a prior message across sessions
//   S4 /palace generates a self-contained 0600 HTML with machine-checkable payload
//   S5 memory.enabled=false omits memory from the provider request and creates no memory dirs
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, watch, writeFileSync } from "node:fs"
import { basename, delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

if (process.versions.bun === undefined) {
  console.error("memory-e2e requires Bun: run bun packages/omo-senpi/scripts/qa/memory-e2e.mjs")
  process.exit(1)
}
const { createSandbox, seedSandbox } = await import("./drive.mjs")
const { isolatedChildEnv } = await import("./sandbox-child-env.mjs")

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

const sandboxes = []

function baseEnv(sandbox, extra = {}) {
  const env = isolatedChildEnv(process.env, sandbox.agentDir)
  for (const name of Object.keys(env)) {
    if (name.toUpperCase().startsWith("GIT_") || name.startsWith("MOCK_DUMP_") || name === "MOCK_SCRIPT_PATH")
      delete env[name]
  }
  return {
    ...env,
    HOME: sandbox.homeDir,
    USERPROFILE: sandbox.homeDir,
    XDG_CONFIG_HOME: sandbox.xdgConfigHome,
    XDG_DATA_HOME: sandbox.xdgDataHome,
    XDG_CACHE_HOME: sandbox.xdgCacheHome,
    XDG_STATE_HOME: join(sandbox.root, "xdg-state"),
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: join(sandbox.homeDir, ".gitconfig"),
    ...extra,
  }
}

function runSenpi(sandbox, { prompt, env = {}, args = [], cwd }) {
  const fullArgs = [
    "-e",
    mockProviderEntry,
    "-p",
    "--mode",
    "json",
    "--provider",
    "omo-mock",
    "--model",
    "mock-1",
    "--session-dir",
    join(sandbox.agentDir, "sessions"),
    ...args,
    prompt,
  ]
  const run = spawnSync(senpiBin, fullArgs, {
    cwd: cwd ?? sandbox.cwd,
    env: baseEnv(sandbox, env),
    encoding: "utf8",
    timeout: 120_000,
  })
  return { status: run.status, stdout: run.stdout ?? "", stderr: run.stderr ?? "" }
}

function scenarioSandbox() {
  const sandbox = createSandbox()
  sandboxes.push(sandbox)
  seedSandbox(sandbox)
  mkdirSync(join(sandbox.agentDir, "sessions"), { recursive: true })
  mkdirSync(join(sandbox.cwd, ".omo"), { recursive: true })
  // The category resolver gates on registry.getAvailable(), which drops providers without
  // configured auth; the scripted mock provider therefore needs an auth entry to be selectable.
  writeFileSync(
    join(sandbox.agentDir, "auth.json"),
    `${JSON.stringify({ "omo-mock": { type: "api_key", key: "mock" } }, null, 2)}\n`,
  )
  return sandbox
}

function writeOmoConfig(sandbox, memoryOverrides = {}) {
  const config = {
    categories: { quick: { description: "QA mock quick category", model: "omo-mock/mock-1" } },
    memory: {
      enabled: true,
      facts: { enabled: false },
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
  const repos = []
  const collect = (agentsDir) => {
    if (!existsSync(agentsDir)) return
    for (const name of readdirSync(agentsDir)) {
      const repo = join(agentsDir, name, "repo")
      if (existsSync(join(repo, ".git"))) repos.push(repo)
    }
  }
  collect(join(memoryHome, "agents"))
  // A first-write one-shot can leave its repo in the transient run until the sweep promotes it.
  const transientDir = join(memoryHome, "transient-runs")
  if (existsSync(transientDir)) {
    for (const token of readdirSync(transientDir)) collect(join(transientDir, token, "agents"))
  }
  return repos
}

function stageExistingProject(sandbox, repo) {
  // These follow-up scenarios need an existing project repo. Stage the first write at the same
  // identity's durable path instead of depending on when transient memory becomes visible (#13583).
  const identity = basename(dirname(repo))
  const target = join(sandbox.root, "memory", "agents", identity, "repo")
  if (repo !== target) {
    mkdirSync(dirname(target), { recursive: true })
    renameSync(repo, target)
  }
  return target
}

function waitForCompletion(dir, existing) {
  return new Promise((resolveCompletion, reject) => {
    function finish() {
      clearTimeout(timer)
      subscription.close()
    }
    function inspect() {
      try {
        const file = readdirSync(dir).find((name) => name.endsWith(".json") && !existing.has(name))
        if (file === undefined) return
        const completion = JSON.parse(readFileSync(join(dir, file), "utf8"))
        finish()
        resolveCompletion(completion)
      } catch (error) {
        finish()
        reject(error)
      }
    }
    const subscription = watch(dir, inspect)
    subscription.on("error", (error) => {
      finish()
      reject(error)
    })
    const timer = setTimeout(() => {
      finish()
      reject(new Error(`timeout waiting for reflection completion in ${dir}`))
    }, 90_000)
    inspect()
  })
}

function runGit(sandbox, repo, args) {
  return spawnSync("git", args, { cwd: repo, env: baseEnv(sandbox), encoding: "utf8" })
}

function gitLog(sandbox, repo) {
  const run = runGit(sandbox, repo, ["log", "--format=%s | %ae", "HEAD"])
  return run.status === 0 ? run.stdout.trim() : ""
}

async function scenario1() {
  const sandbox = scenarioSandbox()
  writeOmoConfig(sandbox)
  writeMockScript(sandbox, {
    parentSteps: [
      {
        type: "tool_call",
        name: "memory",
        arguments: {
          command: "create",
          file_path: "system/facts.md",
          description: "harness facts",
          file_text: "senpi is a pi harness",
          reason: "seed harness fact for QA",
        },
      },
      { type: "text", text: "memory seeded" },
    ],
    childSteps: [{ type: "text", text: "unused" }],
  })
  const first = runSenpi(sandbox, { prompt: "remember that senpi is a pi harness" })
  if (first.status !== 0) return record("S1 first senpi run", false, first.stderr.slice(-400))

  const repos = memoryRepos(join(sandbox.root, "memory"))
  record("S1 repo created", repos.length === 1, repos.join(", ") || "no identity repo under OMO_MEMORY_HOME")
  if (repos.length !== 1) return
  const log = gitLog(sandbox, repos[0])
  record("S1 commit landed", log.includes("seed harness fact for QA"), log || "<empty git log>")
  record("S1 author is identity", log.includes("@omo.local"), log.split("\n")[0] ?? "")

  writeMockScript(sandbox, {
    parentSteps: [{ type: "text", text: "answer" }],
    childSteps: [{ type: "text", text: "unused" }],
  })
  stageExistingProject(sandbox, repos[0])
  const readbackLog = join(sandbox.root, "sysdump-readback.log")
  const second = runSenpi(sandbox, { prompt: "what do you remember", env: { MOCK_DUMP_SYSTEM: readbackLog } })
  if (second.status !== 0) return record("S1 second senpi run", false, second.stderr.slice(-400))
  const dump = readFileSync(readbackLog, "utf8")
  const identity = basename(dirname(repos[0]))
  record("S1 sentinel in next-run prompt", dump.includes(`<!-- senpi-memory:${identity}:begin -->`), readbackLog)
  record("S1 memory body in next-run prompt", dump.includes("senpi is a pi harness"), readbackLog)
}

async function scenario2() {
  const sandbox = scenarioSandbox()
  writeOmoConfig(sandbox)
  const shimPath = join(sandbox.root, "senpi-shim")
  writeFileSync(shimPath, `#!/bin/sh\nexec ${JSON.stringify(senpiBin)} -e ${JSON.stringify(mockProviderEntry)} "$@"\n`)
  spawnSync("chmod", ["+x", shimPath])

  writeMockScript(sandbox, {
    parentSteps: [
      {
        type: "tool_call",
        name: "memory",
        arguments: {
          command: "create",
          file_path: "system/facts.md",
          description: "seed",
          file_text: "seed for dreaming",
          reason: "seed memory before reflection",
        },
      },
      { type: "text", text: "first answer" },
    ],
    childSteps: [],
  })
  const first = runSenpi(sandbox, { prompt: "seed then settle" })
  if (first.status !== 0) return record("S2 seeding run", false, first.stderr.slice(-400))

  const memoryHome = join(sandbox.root, "memory")
  const repos = memoryRepos(memoryHome)
  record("S2 repo exists", repos.length === 1, repos.join(", ") || "no repo")
  if (repos.length !== 1) return
  const repo = stageExistingProject(sandbox, repos[0])

  const childScript = {
    parentSteps: [
      {
        type: "tool_call",
        name: "edit",
        arguments: {
          path: "system/facts.md",
          edits: [{ oldText: "seed for dreaming", newText: "seed for dreaming\ndreamed fact" }],
        },
      },
      {
        type: "tool_call",
        name: "bash",
        arguments: { command: "git add system/facts.md && git commit -m 'feat(reflection): dreamed a memory'" },
      },
      { type: "text", text: "reflection written" },
    ],
    childSteps: [],
  }
  writeFileSync(join(repo, "mock-script.json"), `${JSON.stringify(childScript, null, 2)}\n`)
  const scriptCommit = runGit(sandbox, repo, ["add", "mock-script.json"])
  if (scriptCommit.status !== 0) return record("S2 child script staging", false, scriptCommit.stderr ?? "")
  const scriptCommitResult = runGit(sandbox, repo, ["commit", "-m", "qa: child script"])
  if (scriptCommitResult.status !== 0) return record("S2 child script commit", false, scriptCommitResult.stderr ?? "")

  writeMockScript(sandbox, { parentSteps: [{ type: "text", text: "triggering turn" }], childSteps: [] })
  writeOmoConfig(sandbox, { trigger: { step_count: 1, on_compaction: false } })
  const completionsDir = join(dirname(repo), "runtime", "reflection", "completions")
  mkdirSync(completionsDir, { recursive: true })
  const existing = new Set(readdirSync(completionsDir))
  const run = runSenpi(sandbox, { prompt: "trigger one reflection", env: { SENPI_BIN: shimPath } })
  if (run.status !== 0) {
    console.error("S2 parent stderr:", run.stderr.slice(-1200))
    return record("S2 parent senpi run", false, run.stderr.slice(-400))
  }
  const completion = await waitForCompletion(completionsDir, existing).catch((error) => error)
  if (completion instanceof Error) return record("S2 completion record", false, completion.message)
  record(
    "S2 completion record",
    completion.identity === basename(dirname(repo)),
    join(completionsDir, `${completion.runId}.json`),
  )
  record("S2 outcome merged", completion.outcome === "merged", JSON.stringify(completion))
  record("S2 quick category recorded", completion.category === "quick", completion.category)
  const log = gitLog(sandbox, repo)
  record("S2 merge commit landed", /merge\(reflection\)/.test(log), log.split("\n").slice(0, 3).join(" || "))
  record(
    "S2 dreamed fact merged into parent repo",
    existsSync(join(repo, "system", "facts.md")) &&
      readFileSync(join(repo, "system", "facts.md"), "utf8").includes("dreamed fact"),
    "system/facts.md",
  )
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
  const query = "zqxwvb"
  const transcriptMarker = "qa-transcript-only-k7pv39"
  writeOmoConfig(sandbox)
  writeMockScript(sandbox, {
    parentSteps: [
      {
        type: "tool_call",
        name: "memory",
        arguments: {
          command: "create",
          file_path: "system/facts.md",
          description: "qa fact",
          file_text: "seed for palace",
          reason: "seed palace memory",
        },
      },
      { type: "text", text: `${query} ${transcriptMarker}` },
    ],
    childSteps: [],
  })
  const run = runSenpi(sandbox, { prompt: "say the unique phrase" })
  if (run.status !== 0) return record("S3 seeding senpi run", false, run.stderr.slice(-400))
  const repos = memoryRepos(join(sandbox.root, "memory"))
  if (repos.length !== 1) return record("S4 seed project repo", false, repos.join(", ") || "no repo")
  stageExistingProject(sandbox, repos[0])

  const sandboxEnv = baseEnv(sandbox)
  const changedEnv = [...new Set([...Object.keys(process.env), ...Object.keys(sandboxEnv)])].filter(
    (key) => process.env[key] !== sandboxEnv[key],
  )
  const originalEnv = changedEnv.map((key) => [key, process.env[key]])
  const applyEnv = (entries) => {
    for (const [key, value] of entries) {
      if (value === undefined) delete process.env[key]
      else process.env[key] = value
    }
  }
  const originalCwd = process.cwd()
  applyEnv(changedEnv.map((key) => [key, sandboxEnv[key]]))
  process.chdir(sandbox.cwd)
  try {
    const bundleModule = await import("../../src/extension/index.ts")
    const { MemoryFakeExtensionAPI } = await import("../../src/components/memory/memory.test-support.ts")
    const pi = new MemoryFakeExtensionAPI()
    const composed = bundleModule.default
    await composed(pi, {})
    const searchCommand = pi.commands.find((command) => command.name === "search")
    if (searchCommand === undefined)
      return record("S3 search command registered", false, `commands: ${pi.commands.map((c) => c.name).join(",")}`)
    const output = await searchCommand.options.handler(query, buildCommandContext(sandbox))
    const hit =
      typeof output === "string" &&
      output
        .split("\n")
        .some(
          (line, i, lines) =>
            line === `   assistant **${query}** ${transcriptMarker}` &&
            /^\d+\. session .+ · assistant$/.test(lines[i - 1] ?? "") &&
            /^ {3}entry \S+$/.test(lines[i + 1] ?? ""),
        )
    record("S3 search finds prior message", hit, String(output).slice(0, 200))

    const palaceCommand = pi.commands.find((command) => command.name === "palace")
    if (palaceCommand === undefined) return record("S4 palace command registered", false, "not registered")
    await pi.dispatch(
      "session_start",
      {},
      buildCommandContext(sandbox, {
        sessionManager: { getSessionId: () => "palace-session", getEntries: () => [] },
      }),
    )
    let palacePath = ""
    const palaceOutput = await palaceCommand.options.handler(
      "",
      buildCommandContext(sandbox, {
        hasUI: false,
        output: (text) => {
          palacePath = text
        },
        sessionManager: { getSessionId: () => "palace-session" },
      }),
    )
    const htmlPathMatch = String(palacePath || palaceOutput).match(/(\/\S+\.html)/)
    if (htmlPathMatch === null) return record("S4 palace path returned", false, String(palaceOutput).slice(0, 200))
    const htmlPath = htmlPathMatch[1]
    if (!existsSync(htmlPath)) return record("S4 palace file exists", false, htmlPath)
    const mode = statSync(htmlPath).mode & 0o777
    const html = readFileSync(htmlPath, "utf8")
    record("S4 palace file mode 0600", mode === 0o600, String(mode.toString(8)))
    const tabValues = new Set([...html.matchAll(/data-tab="([^"]+)"/g)].map((match) => match[1]))
    record(
      "S4 palace tabs",
      ["core", "external", "history", "reflection"].every((tab) => tabValues.has(tab)),
      [...tabValues].join(","),
    )
    record("S4 palace persona entry", html.includes("system/persona.md"), htmlPath)
  } finally {
    process.chdir(originalCwd)
    applyEnv(originalEnv)
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
  const systemLog = join(sandbox.root, "sysdump-disabled.log")
  const run = runSenpi(sandbox, {
    prompt: "hello",
    // Keep a positive control without filtering out memory if it was registered.
    args: ["--tools", "read,memory"],
    env: { MOCK_DUMP_SYSTEM: systemLog },
  })
  if (run.status !== 0) return record("S5 disabled run", false, run.stderr.slice(-400))
  const requests = existsSync(systemLog)
    ? readFileSync(systemLog, "utf8")
        .split("\n")
        .filter((line) => line.startsWith("["))
    : []
  const messages = requests.length === 1 ? JSON.parse(requests[0]) : []
  // Senpi carries provider tool declarations as deltas on the request's system messages.
  const tools = new Set()
  for (const message of messages) {
    for (const { name } of message.toolsRemoved ?? []) tools.delete(name)
    for (const { name } of message.toolsAdded ?? []) tools.add(name)
  }
  const hasSystemContent = messages.some(
    ({ role, content }) =>
      role === "system" &&
      (typeof content === "string" ? content.trim().length > 0 : content.some((part) => part.text?.trim())),
  )
  record(
    "S5 nonempty provider request captured",
    hasSystemContent && tools.has("read"),
    `requests=${requests.length} tools=${[...tools].join(",")} :: ${systemLog}`,
  )
  record("S5 no memory tool when disabled", tools.size > 0 && !tools.has("memory"))
  record("S5 no sentinel when disabled", hasSystemContent && !requests[0].includes("<!-- senpi-memory:"), systemLog)
  const memoryHome = join(sandbox.root, "memory")
  record("S5 no memory dirs when disabled", !existsSync(memoryHome), memoryHome)
}

async function main() {
  console.log(`senpi: ${senpiBin}`)
  await scenario1()
  await scenario2()
  await scenario3And4()
  await scenario5()

  for (const sandbox of sandboxes) {
    const defaultAgent = join(sandbox.homeDir, ".senpi", "agent")
    const defaultMemory = join(sandbox.homeDir, ".omo", "memory")
    record(
      "isolation: sandbox HOME defaults unused",
      !existsSync(defaultAgent) && !existsSync(defaultMemory),
      sandbox.homeDir,
    )
  }

  console.log(JSON.stringify({ ok: failures.length === 0, total: results.length, failures }, null, 2))
  process.exit(failures.length === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
