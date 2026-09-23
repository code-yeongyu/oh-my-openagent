import { spawn, spawnSync } from "node:child_process"
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { delimiter, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import { createSandbox, credentialDigest, digestDirectory } from "./drive.mjs"
import { protectedSnapshotsUntouched, snapshotProtectedState } from "./isolation-state.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptDir, "..", "..")
const repoRoot = resolve(packageRoot, "..", "..")
const pluginRoot = join(packageRoot, "plugin")
const providerEntry = join(scriptDir, "task-e2e-mock-provider.ts")
const fixtureServerEntry = join(scriptDir, "standalone-parity-fixture-server.mjs")
const realSenpiAgentDir = join(homedir(), ".senpi", "agent")
const realBetaRoot = join(homedir(), ".local", "share", "omo-beta")

const senpiBin = resolveBinary(process.env.SENPI_BIN ?? "senpi")
if (senpiBin === null) {
  console.log(JSON.stringify({ status: "SKIP", reason: "senpi binary unavailable" }))
  process.exit(2)
}

const sandbox = createSandbox()
sandbox.agentDir = join(sandbox.homeDir, ".omo", "agent")
const serverLog = join(sandbox.root, "fixture-server.jsonl")
const portFile = join(sandbox.root, "fixture-port")
const systemDump = join(sandbox.root, "system-prompts.txt")
const toolsDump = join(sandbox.root, "tools.jsonl")
const messagesDump = join(sandbox.root, "messages.jsonl")
const sessions = join(sandbox.root, "sessions")
const sourceHome = join(sandbox.root, "source-home")
const realSenpiBefore = credentialDigest(realSenpiAgentDir)
const realBetaBefore = {
  bin: digestDirectory(join(realBetaRoot, "bin")),
  parity: digestDirectory(join(realBetaRoot, "standalone-parity")),
  protectedState: snapshotProtectedState(join(realBetaRoot, "home", ".omo", "agent")),
}
let server

try {
  mkdirSync(sandbox.cwd, { recursive: true })
  mkdirSync(sandbox.agentDir, { recursive: true })
  mkdirSync(sandbox.xdgConfigHome, { recursive: true })
  mkdirSync(sandbox.xdgDataHome, { recursive: true })
  mkdirSync(sandbox.xdgCacheHome, { recursive: true })
  mkdirSync(sandbox.homeDir, { recursive: true })
  mkdirSync(sessions, { recursive: true })
  server = spawn(process.execPath, [fixtureServerEntry, portFile, serverLog], { stdio: "ignore" })
  const port = await waitForPort(portFile)
  seedSourceHome(sourceHome, port)
  seedBeta(sandbox, pluginRoot)
  runCli("generate", sourceHome, sandbox.root)
  runCli("deploy", sourceHome, sandbox.root)

  writeScript(sandbox.cwd, [{ type: "text", text: "PARITY_DISCOVERY_OK", usage: { input: 4, output: 2, totalTokens: 6 } }])
  const discovery = runSenpi(sandbox, sessions, "inspect parity", { systemDump, toolsDump, messagesDump })
  assertRun(discovery, "discovery")
  const tools = readLastTools(toolsDump)
  const docsTool = findTool(tools, (name) => name.includes("docs") && name.endsWith("echo"))
  const openVikingTool = findTool(tools, (name) => name.includes("openviking") && name.endsWith("health"))

  writeScript(sandbox.cwd, [{ type: "text", text: "PARITY_SKILL_OK", usage: { input: 4, output: 2, totalTokens: 6 } }])
  const skillRun = runSenpi(sandbox, sessions, "/skill:fixture-skill", { systemDump, toolsDump, messagesDump })
  assertRun(skillRun, "skill")

  writeScript(sandbox.cwd, [
    { type: "tool_call", name: docsTool, arguments: { text: "http-ok" } },
    { type: "tool_call", name: openVikingTool, arguments: {} },
    { type: "text", text: "PARITY_TOOLS_OK", usage: { input: 7, output: 3, totalTokens: 10 } },
  ])
  const toolsRun = runSenpi(sandbox, sessions, "exercise parity tools", { systemDump, toolsDump, messagesDump })
  assertRun(toolsRun, "tools")

  writeScript(sandbox.cwd, [{ type: "text", text: "PARITY_COMMAND_OK", usage: { input: 3, output: 2, totalTokens: 5 } }])
  const commandRun = runSenpi(sandbox, sessions, '/hello "world value"', { systemDump, toolsDump, messagesDump })
  assertRun(commandRun, "command")

  const systems = readFileSync(systemDump, "utf8").split(/^=== model=/mu).filter((text) => text.trim().length > 0)
  const messages = readFileSync(messagesDump, "utf8")
  const requests = readJsonLines(serverLog)
  const deployedConfig = JSON.parse(readFileSync(join(sandbox.homeDir, ".omo", "omo.jsonc"), "utf8"))
  const sessionEntries = readSessionEntries(sessions)
  const result = {
    status: "PASS",
    isolatedAgentDir: sandbox.agentDir,
    skillCount: JSON.parse(readFileSync(join(sandbox.root, "standalone-parity", "current", "manifest.json"), "utf8")).skills.length,
    commandCount: JSON.parse(readFileSync(join(sandbox.root, "standalone-parity", "current", "manifest.json"), "utf8")).commands.length,
    instructionSingleCopy: systems.every((text) => occurrences(text, "<!-- omo-standalone-parity:instructions -->") === 1),
    profileInjected: systems.some((text) => text.includes("QA_PROFILE") && text.includes("QA_RESUME_CONTEXT")),
    recallInjected: systems.some((text) => text.includes("QA_RECALLED_CONTEXT")),
    skillInvoked: messages.includes("QA_SKILL_BODY"),
    commandInvoked: messages.includes("COMMAND_RENDERED:world value"),
    httpMcpCalled: hasMcpCall(requests, "/docs-mcp", "echo"),
    openVikingMcpCalled: hasMcpCall(requests, "/mcp", "health"),
    openVikingCaptured: requests.some((entry) => entry.path.includes("/messages")),
    openVikingCommitted: requests.some((entry) => entry.path.endsWith("/commit")),
    routeApplied: deployedConfig["[native]"]?.agents?.build?.model === "omo-mock/mock-1",
    normalPackageDiscovery: !/duplicate.*omo|duplicate.*extension/iu.test(`${discovery.stderr}\n${discovery.stdout}`),
    modelUsageNonzero: sessionEntries.some((entry) => Number(entry.message?.usage?.totalTokens ?? 0) > 0),
    realSenpiUntouched: credentialDigest(realSenpiAgentDir) === realSenpiBefore,
    realBetaUntouched:
      digestDirectory(join(realBetaRoot, "bin")) === realBetaBefore.bin
      && digestDirectory(join(realBetaRoot, "standalone-parity")) === realBetaBefore.parity
      && protectedSnapshotsUntouched(
        realBetaBefore.protectedState,
        snapshotProtectedState(join(realBetaRoot, "home", ".omo", "agent")),
      ),
  }
  const failed = Object.entries(result).filter(([key, value]) => key !== "status" && key !== "isolatedAgentDir" && key !== "skillCount" && key !== "commandCount" && value !== true)
  if (failed.length > 0) throw new Error(`standalone parity assertions failed: ${failed.map(([key]) => key).join(", ")}`)
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  console.error(JSON.stringify({ status: "FAIL", error: error instanceof Error ? error.message : String(error), sandbox: sandbox.root }, null, 2))
  process.exitCode = 1
} finally {
  server?.kill("SIGTERM")
  if (process.exitCode !== 1) rmSync(sandbox.root, { recursive: true, force: true })
}

function seedSourceHome(root, port) {
  const openCode = join(root, ".config", "opencode")
  const skill = join(openCode, "skills", "fixture-skill")
  const command = join(openCode, "commands")
  const packageSource = process.env.OPENVIKING_PLUGIN_ROOT ?? join(homedir(), ".cache", "opencode", "packages", "@openviking", "opencode-plugin@0.2.4", "node_modules", "@openviking", "opencode-plugin")
  const packageTarget = join(root, ".cache", "opencode", "packages", "@openviking", "opencode-plugin@0.2.4", "node_modules", "@openviking", "opencode-plugin")
  if (!existsSync(packageSource)) throw new Error("pinned OpenViking package unavailable")
  mkdirSync(skill, { recursive: true })
  mkdirSync(command, { recursive: true })
  mkdirSync(join(root, ".openviking"), { recursive: true })
  mkdirSync(join(root, ".omo"), { recursive: true })
  cpSync(packageSource, packageTarget, { recursive: true })
  writeFileSync(join(skill, "SKILL.md"), "---\nname: fixture-skill\ndescription: QA fixture\n---\nQA_SKILL_BODY\n")
  writeFileSync(join(command, "hello.md"), "---\ndescription: QA command\n---\nCOMMAND_RENDERED:$1:$ARGUMENTS\n")
  writeFileSync(join(openCode, "AGENTS.md"), "STANDALONE_PARITY_QA_INSTRUCTION\n")
  writeFileSync(join(openCode, "opencode.json"), JSON.stringify({ plugin: ["@openviking/opencode-plugin@0.2.4"] }))
  writeFileSync(join(openCode, "mcp.json"), JSON.stringify({ mcpServers: { docs: { type: "http", url: `http://127.0.0.1:${port}/docs-mcp` } } }))
  writeFileSync(join(root, ".openviking", "ovcli.conf"), JSON.stringify({ url: `http://127.0.0.1:${port}` }))
  writeFileSync(join(root, ".omo", "omo.jsonc"), JSON.stringify({ "[opencode]": { default_run_agent: "build", agents: { build: { model: "omo-mock/mock-1" } } } }))
}

function seedBeta(sandbox, bundle) {
  const settingsDir = join(sandbox.homeDir, ".omo", "agent")
  const bundledOmo = join(sandbox.root, "bundled-omo")
  cpSync(bundle, bundledOmo, { recursive: true })
  mkdirSync(settingsDir, { recursive: true })
  writeFileSync(join(settingsDir, "settings.json"), JSON.stringify({ defaultProjectTrust: "ask", packages: [bundledOmo], models: [{ provider: "omo-mock", id: "mock-1" }], recommendedModels: ["mock-1"] }))
  writeFileSync(join(settingsDir, "trust.json"), JSON.stringify({ [sandbox.canonicalCwd]: true }))
}

function runCli(action, realHome, betaRoot) {
  const run = spawnSync("bun", [join(packageRoot, "scripts", "standalone-parity", "cli.ts"), action, "--real-home", realHome, "--beta-root", betaRoot], { cwd: repoRoot, encoding: "utf8" })
  if (run.status !== 0) throw new Error(`${action} failed: ${run.stderr || run.stdout}`)
}

function runSenpi(sandbox, sessionDir, prompt, dumps) {
  return spawnSync(senpiBin, ["-e", providerEntry, "-p", "--mode", "json", "--provider", "omo-mock", "--model", "mock-1", "--session-dir", sessionDir, prompt], {
    cwd: sandbox.cwd,
    env: { ...process.env, HOME: sandbox.homeDir, USERPROFILE: sandbox.homeDir, SENPI_CODING_AGENT_DIR: sandbox.agentDir, OMO_CODING_AGENT_DIR: sandbox.agentDir, PI_CODING_AGENT_DIR: sandbox.agentDir, XDG_CONFIG_HOME: sandbox.xdgConfigHome, XDG_DATA_HOME: sandbox.xdgDataHome, XDG_CACHE_HOME: sandbox.xdgCacheHome, OMO_SENPI_QA: "1", MOCK_DUMP_SYSTEM: dumps.systemDump, MOCK_DUMP_TOOLS: dumps.toolsDump, MOCK_DUMP_MESSAGES: dumps.messagesDump },
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 64 * 1024 * 1024,
  })
}

function assertRun(run, label) {
  if (run.status !== 0) throw new Error(`${label} run failed: ${run.stderr || run.stdout}`)
}

function writeScript(cwd, parentSteps) {
  writeFileSync(join(cwd, "mock-script.json"), JSON.stringify({ models: ["mock-1"], parentSteps, childSteps: [{ type: "text", text: "unused" }] }))
}

function readLastTools(path) {
  const lines = readFileSync(path, "utf8").trim().split("\n")
  return JSON.parse(lines.at(-1) ?? "[]").map((tool) => tool.name).filter((name) => typeof name === "string")
}

function findTool(tools, predicate) {
  const name = tools.find(predicate)
  if (!name) throw new Error(`required tool missing from: ${tools.join(", ")}`)
  return name
}

function readJsonLines(path) {
  return readFileSync(path, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line))
}

function hasMcpCall(requests, path, name) {
  return requests.some((entry) => entry.path === path && entry.body?.method === "tools/call" && entry.body?.params?.name === name)
}

function readSessionEntries(root) {
  const entries = []
  const walk = (dir) => {
    if (!existsSync(dir)) return
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, item.name)
      if (item.isDirectory()) walk(path)
      else if (item.isFile() && path.endsWith(".jsonl")) {
        for (const line of readFileSync(path, "utf8").split("\n").filter(Boolean)) {
          entries.push(JSON.parse(line))
        }
      }
    }
  }
  walk(root)
  return entries
}

async function waitForPort(path) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (existsSync(path)) return Number(readFileSync(path, "utf8"))
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 25))
  }
  throw new Error("fixture server did not start")
}

function occurrences(value, needle) {
  return value.split(needle).length - 1
}

function resolveBinary(name) {
  if (name.includes("/")) return existsSync(name) ? resolve(name) : null
  for (const directory of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = resolve(directory || ".", name)
    if (existsSync(candidate)) return candidate
  }
  return null
}
