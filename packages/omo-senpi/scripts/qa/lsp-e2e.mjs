#!/usr/bin/env node
// allow: SIZE_OK - one live Senpi LSP QA driver keeps pack/install/daemon/harness evidence in one executable.
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { mkdir } from "node:fs/promises"
import { homedir, tmpdir } from "node:os"
import { delimiter, dirname, join, relative, resolve } from "node:path"
import { pathToFileURL, fileURLToPath } from "node:url"
import { verifyRuntimeDist } from "../../plugin/scripts/stage-lsp-daemon-runtime.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const packageRoot = resolve(scriptDir, "..", "..")
const repoRoot = resolve(packageRoot, "..", "..")
const pluginRoot = join(packageRoot, "plugin")
const mockProviderEntry = join(scriptDir, "mock-provider", "index.ts")
const realSenpiAgentDir = join(homedir(), ".senpi", "agent")

function parseArgs(argv) {
  const args = { scenario: "runtime-package", selfTest: false, evidenceDir: undefined }
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === "--self-test") args.selfTest = true
    else if (arg === "--scenario") args.scenario = argv[++index]
    else if (arg === "--evidence-dir") args.evidenceDir = argv[++index]
    else throw new Error(`unknown argument: ${arg}`)
  }
  if (
    args.scenario !== "runtime-package" &&
    args.scenario !== "tools" &&
    args.scenario !== "post-edit" &&
    args.scenario !== "vendored-removal" &&
    args.scenario !== "all"
  ) {
    throw new Error(`unsupported scenario: ${args.scenario}`)
  }
  return args
}

function findOnPath(bin) {
  if (bin.includes("/")) return existsSync(bin) ? resolve(bin) : null
  for (const dir of (process.env.PATH ?? "").split(delimiter)) {
    const candidate = resolve(dir || ".", bin)
    if (existsSync(candidate)) return candidate
  }
  return null
}

function digestDirectory(root) {
  if (!existsSync(root)) return "absent"
  const hash = createHash("sha256")
  for (const file of listFiles(root).sort()) {
    hash.update(relative(root, file))
    hash.update("\0")
    hash.update(createHash("sha256").update(readFileSync(file)).digest("hex"))
    hash.update("\0")
  }
  return hash.digest("hex")
}

function listFiles(root) {
  const files = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) files.push(...listFiles(path))
    else if (entry.isFile()) files.push(path)
  }
  return files
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

function isolatedHomeEnv(baseEnv, homeDir) {
  return {
    ...baseEnv,
    HOME: homeDir,
    USERPROFILE: homeDir,
    HOMEDRIVE: "",
    HOMEPATH: homeDir,
    NODE_PATH: "",
  }
}

function parseJsonEvents(text) {
  const events = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed.startsWith("{")) continue
    try {
      events.push(JSON.parse(trimmed))
    } catch {}
  }
  return events
}

function findToolExecution(events, toolName) {
  return events.find((event) => event?.type === "tool_execution_end" && event.toolName === toolName)
}

function runChecked(command, args, options) {
  const result = spawnSync(command, args, {
    ...options,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed: ${result.stderr || result.stdout}`)
  }
  return result
}

function packAndExtract(workRoot) {
  const packDir = join(workRoot, "pack")
  const extractDir = join(workRoot, "extract")
  spawnSync("mkdir", ["-p", packDir, extractDir])
  const pack = runChecked("npm", ["pack", pluginRoot, "--pack-destination", packDir], { cwd: repoRoot })
  const tarball = join(packDir, pack.stdout.trim().split(/\r?\n/).at(-1))
  runChecked("tar", ["-xzf", tarball, "-C", extractDir], { cwd: repoRoot })
  return { tarball, extractedPlugin: join(extractDir, "package") }
}

async function directStatusTwice(runtimeDist, daemonDir) {
  const packageJson = JSON.parse(readFileSync(join(runtimeDist, "package.json"), "utf8"))
  const version = typeof packageJson.version === "string" ? packageJson.version : "0"
  const cliPath = join(runtimeDist, "cli.js")
  const index = await import(pathToFileURL(join(runtimeDist, "index.js")).href)
  const restoreEnv = setTemporaryDaemonEnv({ dir: daemonDir, cli: cliPath, version })
  const env = {
    ...process.env,
    OMO_LSP_DAEMON_DIR: daemonDir,
    OMO_LSP_DAEMON_CLI: cliPath,
    OMO_LSP_DAEMON_VERSION: version,
  }
  const paths = index.daemonPaths(env, { cliPath, version })
  try {
    try {
      await index.ensureDaemonRunning(paths)
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}; daemonLog=${readLogTail(paths.log)}`)
    }
    const first = readOwnerProof(paths)
    try {
      await index.ensureDaemonRunning(paths)
    } catch (error) {
      throw new Error(`${error instanceof Error ? error.message : String(error)}; daemonLog=${readLogTail(paths.log)}`)
    }
    const second = readOwnerProof(paths)
    if (first.pid !== second.pid || first.endpoint.path !== second.endpoint.path) {
      throw new Error("daemon status pings did not reuse the same owner")
    }
    return { paths, first, second, authPresent: first.authPresent && second.authPresent, overridePairUsed: true }
  } finally {
    restoreEnv()
  }
}

function setTemporaryDaemonEnv(values) {
  const previous = {
    OMO_LSP_DAEMON_DIR: process.env.OMO_LSP_DAEMON_DIR,
    OMO_LSP_DAEMON_CLI: process.env.OMO_LSP_DAEMON_CLI,
    OMO_LSP_DAEMON_VERSION: process.env.OMO_LSP_DAEMON_VERSION,
  }
  process.env.OMO_LSP_DAEMON_DIR = values.dir
  process.env.OMO_LSP_DAEMON_CLI = values.cli
  process.env.OMO_LSP_DAEMON_VERSION = values.version
  return () => {
    restoreEnvValue("OMO_LSP_DAEMON_DIR", previous.OMO_LSP_DAEMON_DIR)
    restoreEnvValue("OMO_LSP_DAEMON_CLI", previous.OMO_LSP_DAEMON_CLI)
    restoreEnvValue("OMO_LSP_DAEMON_VERSION", previous.OMO_LSP_DAEMON_VERSION)
  }
}

function restoreEnvValue(name, value) {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}

function readLogTail(path) {
  if (!existsSync(path)) return "<missing>"
  const text = readFileSync(path, "utf8")
  return text.slice(-4000).replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]")
}

function readOwnerProof(paths) {
  const owner = JSON.parse(readFileSync(paths.owner, "utf8"))
  const endpointText = readFileSync(paths.endpoint, "utf8")
  const authText = readFileSync(paths.auth, "utf8")
  if (typeof owner.pid !== "number" || typeof owner.nonce !== "string") {
    throw new Error("daemon owner metadata is malformed")
  }
  if (!owner.endpoint || typeof owner.endpoint.path !== "string") {
    throw new Error("daemon endpoint metadata is malformed")
  }
  if (endpointText.trim() !== owner.endpoint.path) {
    throw new Error("daemon endpoint file does not match owner metadata")
  }
  return {
    pid: owner.pid,
    nonce: owner.nonce,
    startedAt: owner.startedAt,
    endpoint: owner.endpoint,
    authPresent: authText.trim().length > 0,
  }
}

function terminateKnownOwner(status) {
  if (status?.first?.pid === undefined) return false
  try {
    process.kill(status.first.pid, "SIGTERM")
    return true
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return false
    throw error
  }
}

function runSenpiLoadProof(input) {
  const argv = [
    "-e",
    mockProviderEntry,
    "-p",
    "--mode",
    "json",
    "--provider",
    "omo-mock",
    "--model",
    "mock-1",
    "--tools",
    "lsp_goto_definition",
    "--session-dir",
    input.sessionDir,
    "ulw runtime package proof",
  ]
  writeFileSync(join(input.projectDir, "mock-script.json"), `${JSON.stringify({ steps: [{ type: "text", text: "runtime package loaded" }] }, null, 2)}\n`)
  const result = spawnSync(
    input.senpiBin,
    argv,
    {
      cwd: input.projectDir,
      env: {
        ...isolatedHomeEnv(process.env, input.homeDir),
        SENPI_CODING_AGENT_DIR: input.agentDir,
        SENPI_CODING_AGENT_SESSION_DIR: input.sessionDir,
        OMO_SENPI_QA: "1",
        OMO_LSP_DAEMON_DIR: input.daemonDir,
      },
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
    },
  )
  const streamText = `${result.stdout ?? ""}\n${result.stderr ?? ""}`
  return {
    exitStatus: result.status,
    argv,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    extensionLoaded:
      result.status === 0 &&
      streamText.includes("<ultrawork-mode>") &&
      streamText.includes("\"customType\":\"senpi-task.usage\""),
  }
}

function runSenpiToolProof(input) {
  const argv = [
    "-e",
    mockProviderEntry,
    "-p",
    "--mode",
    "json",
    "--provider",
    "omo-mock",
    "--model",
    "mock-1",
    "--permission",
    "edit=allow",
    "--session-dir",
    input.sessionDir,
    "call the LSP goto definition tool",
  ]
  const samplePath = join(input.projectDir, "sample.ts")
  writeFileSync(samplePath, "export function targetValue() { return 1 }\nconst result = targetValue()\n")
  writeFileSync(
    join(input.projectDir, "mock-script.json"),
    `${JSON.stringify(
      {
        steps: [
          {
            type: "tool_call",
            name: "lsp_goto_definition",
            arguments: { filePath: samplePath, line: 2, character: 15 },
          },
          { type: "text", text: "tools scenario complete" },
        ],
      },
      null,
      2,
    )}\n`,
  )
  const result = spawnSync(
    input.senpiBin,
    argv,
    {
      cwd: input.projectDir,
      env: {
        ...isolatedHomeEnv(process.env, input.homeDir),
        SENPI_CODING_AGENT_DIR: input.agentDir,
        SENPI_CODING_AGENT_SESSION_DIR: input.sessionDir,
        OMO_SENPI_QA: "1",
        OMO_LSP_DAEMON_DIR: input.daemonDir,
        OMO_LSP_DAEMON_CLI: input.cliPath,
        OMO_LSP_DAEMON_VERSION: input.version,
      },
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
    },
  )
  const events = parseJsonEvents(result.stdout ?? "")
  const toolEvent = findToolExecution(events, "lsp_goto_definition")
  const resultText = JSON.stringify(toolEvent?.result ?? {})
  return {
    exitStatus: result.status,
    argv,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    toolEvent,
    toolSucceeded: result.status === 0 && toolEvent?.result?.isError !== true && resultText.includes("sample.ts"),
    warningCount: countProjectCommandWarnings(`${result.stdout ?? ""}\n${result.stderr ?? ""}`),
  }
}

function countProjectCommandWarnings(text) {
  const marker = "omo-senpi ignored project-local LSP commands; move custom commands to the user .pi config"
  return text.split(marker).length - 1
}

const removedEngineFileNames = [
  "client-wrapper.ts",
  "client.ts",
  "connection.ts",
  "directory-diagnostics.ts",
  "errors.ts",
  "infer-extension.ts",
  "inspector.ts",
  "manager-default.ts",
  "manager-lifecycle.ts",
  "manager-types.ts",
  "manager-wait.ts",
  "manager.ts",
  "process.ts",
  "server-installation.ts",
  "server-resolution.ts",
  "transport.ts",
  "workspace-edit.ts",
]

function collectRemovedEngineHits(componentRoot) {
  return removedEngineFileNames
    .map((file) => join(componentRoot, "lsp", file))
    .filter((path) => existsSync(path))
}

function runSeededArchitectureGuardProbe(evidenceDir) {
  const workRoot = mkdtempSync(join(tmpdir(), "omo-senpi-lsp-architecture-seed-"))
  try {
    const lspDir = join(workRoot, "lsp")
    mkdirSync(lspDir, { recursive: true })
    writeFileSync(join(lspDir, "transport.ts"), "export const staleTransport = true\n")
    writeFileSync(join(lspDir, "manager.ts"), "export const staleManager = true\n")
    const hits = collectRemovedEngineHits(workRoot).map((path) => relative(workRoot, path))
    const payload = {
      seededTransportManagerFailure:
        hits.includes(["lsp", "transport.ts"].join("/")) && hits.includes(["lsp", "manager.ts"].join("/")),
      hits,
    }
    if (evidenceDir !== undefined) writeJson(join(evidenceDir, "seeded-architecture-guard.json"), payload)
    return payload
  } finally {
    rmSync(workRoot, { recursive: true, force: true })
  }
}

function allowIsolatedToolPermission(agentDir, toolName) {
  const settingsPath = join(agentDir, "settings.json")
  const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, "utf8")) : {}
  settings.permission = { ...(settings.permission ?? {}), [toolName]: "allow" }
  writeJson(settingsPath, settings)
}

async function inspectExtractedTools(input) {
  const extensionPath = join(input.extractedPlugin, "extensions", "omo.js")
  linkInspectionPeerModules(input.extractedPlugin)
  const previousHome = process.env.HOME
  const previousDaemonDir = process.env.OMO_LSP_DAEMON_DIR
  const previousDaemonCli = process.env.OMO_LSP_DAEMON_CLI
  const previousDaemonVersion = process.env.OMO_LSP_DAEMON_VERSION
  const previousCwd = process.cwd()
  const warnings = []
  const tools = []
  const handlers = []
  const flags = new Map()
  const originalWarn = console.warn
  console.warn = (message, details) => {
    warnings.push({ message, details })
  }
  try {
    process.chdir(input.projectDir)
    process.env.HOME = input.homeDir
    process.env.OMO_LSP_DAEMON_DIR = input.daemonDir
    process.env.OMO_LSP_DAEMON_CLI = input.cliPath
    process.env.OMO_LSP_DAEMON_VERSION = input.version
    const extension = await import(`${pathToFileURL(extensionPath).href}?tools=${Date.now()}`)
    const pi = {
      on(event, handler) {
        handlers.push({ event, handler })
      },
      registerTool(tool) {
        tools.push(tool)
      },
      registerCommand() {},
      registerFlag(name, options) {
        if (!flags.has(name)) flags.set(name, options.default)
      },
      getFlag(name) {
        return flags.get(name)
      },
      sendMessage() {},
      sendUserMessage() {},
      registerMessageRenderer() {},
    }
    await extension.default(pi)
    const lspTools = tools.filter((tool) => typeof tool?.name === "string" && tool.name.startsWith("lsp_"))
    const unavailablePath = join(input.projectDir, "missing.unknown")
    writeFileSync(unavailablePath, "plain text\n")
    const unavailable = await lspTools
      .find((tool) => tool.name === "lsp_goto_definition")
      ?.execute("qa-unavailable", { filePath: unavailablePath, line: 1, character: 0 })
    return {
      descriptors: lspTools.map(describeTool),
      handlers: handlers.map((handler) => handler.event),
      warningCount: warnings.filter((warning) => String(warning.message).includes("project-local LSP commands")).length,
      warnings,
      unavailable,
    }
  } finally {
    console.warn = originalWarn
    process.chdir(previousCwd)
    restoreEnvValue("HOME", previousHome)
    restoreEnvValue("OMO_LSP_DAEMON_DIR", previousDaemonDir)
    restoreEnvValue("OMO_LSP_DAEMON_CLI", previousDaemonCli)
    restoreEnvValue("OMO_LSP_DAEMON_VERSION", previousDaemonVersion)
  }
}

function linkInspectionPeerModules(extractedPlugin) {
  for (const specifier of ["@code-yeongyu/senpi", "@earendil-works/pi-tui", "typebox"]) {
    const source = join(repoRoot, "node_modules", ".bun", "node_modules", ...specifier.split("/"))
    if (!existsSync(source)) throw new Error(`QA inspection peer module is missing: ${specifier}`)
    const target = join(extractedPlugin, "node_modules", ...specifier.split("/"))
    if (existsSync(target)) continue
    mkdirSync(dirname(target), { recursive: true })
    symlinkSync(source, target, "dir")
  }
}

function describeTool(tool) {
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameterKeys: Object.keys(tool.parameters?.properties ?? {}).sort(),
    required: [...(tool.parameters?.required ?? [])].sort(),
    hasRenderCall: typeof tool.renderCall === "function",
    hasRenderResult: typeof tool.renderResult === "function",
    executionMode: tool.executionMode ?? null,
    keys: Object.keys(tool).filter((key) => key !== "execute").sort(),
  }
}

function sessionContext(sessionId, widgetCalls = [], statuses = []) {
  return {
    sessionManager: {
      getSessionId() {
        return sessionId
      },
    },
    ui: {
      setStatus() {},
      setWidget(key, content, options) {
        widgetCalls.push({ key, content, placement: options?.placement })
      },
    },
    updateToolHookStatus(message) {
      statuses.push(message)
    },
  }
}

function postEditEvent(paths) {
  return {
    type: "tool_result",
    toolCallId: `write-${paths.join("-")}`,
    toolName: "write",
    input: { filePaths: paths },
    content: [{ type: "text", text: "Wrote file successfully." }],
    isError: false,
  }
}

function summarizePostEditContent(result) {
  const content = Array.isArray(result?.content) ? result.content : []
  return content
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
}

function writePostEditUserConfig(homeDir, tsServer, failingSentinel) {
  mkdirSync(join(homeDir, ".pi"), { recursive: true })
  writeFileSync(
    join(homeDir, ".pi", "lsp-client.json"),
    `${JSON.stringify(
      {
        lsp: {
          typescript: {
            command: [tsServer, "--stdio"],
            extensions: [".ts"],
            priority: 1000,
          },
          "qa-failing": {
            command: ["sh", "-c", `printf failing-started > ${JSON.stringify(failingSentinel)}; exit 42`],
            extensions: [".boom"],
            priority: 1000,
          },
        },
      },
      null,
      2,
    )}\n`,
  )
}

function writePostEditProject(projectDir) {
  writeFileSync(join(projectDir, "tsconfig.json"), `${JSON.stringify({ compilerOptions: { strict: true, noEmit: true } }, null, 2)}\n`)
  writeFileSync(join(projectDir, "a.ts"), "export const a: string = 1\n")
  writeFileSync(join(projectDir, "b.ts"), "export const b: string = 2\n")
  writeFileSync(join(projectDir, "clean.ts"), "export const clean: string = 'ok'\n")
  writeFileSync(join(projectDir, "unsupported.foo"), "plain text\n")
  writeFileSync(join(projectDir, "throwing.boom"), "plain text\n")
}

async function inspectExtractedPostEdit(input) {
  const extensionPath = join(input.extractedPlugin, "extensions", "omo.js")
  linkInspectionPeerModules(input.extractedPlugin)
  const previousHome = process.env.HOME
  const previousDaemonDir = process.env.OMO_LSP_DAEMON_DIR
  const previousDaemonCli = process.env.OMO_LSP_DAEMON_CLI
  const previousDaemonVersion = process.env.OMO_LSP_DAEMON_VERSION
  const previousCwd = process.cwd()
  const tools = []
  const handlers = []
  const flags = new Map()
  const widgetCalls = []
  const statuses = []
  try {
    process.chdir(input.projectDir)
    process.env.HOME = input.homeDir
    process.env.OMO_LSP_DAEMON_DIR = input.daemonDir
    process.env.OMO_LSP_DAEMON_CLI = input.cliPath
    process.env.OMO_LSP_DAEMON_VERSION = input.version
    const extension = await import(`${pathToFileURL(extensionPath).href}?post-edit=${Date.now()}`)
    const pi = {
      on(event, handler) {
        handlers.push({ event, handler })
      },
      registerTool(tool) {
        tools.push(tool)
      },
      registerCommand() {},
      registerFlag(name, options) {
        if (!flags.has(name)) flags.set(name, options.default)
      },
      getFlag(name) {
        return flags.get(name)
      },
      sendMessage() {},
      sendUserMessage() {},
      registerMessageRenderer() {},
    }
    await extension.default(pi)
    const dispatch = async (event, payload, sessionId) => {
      const results = []
      for (const handler of handlers) {
        if (handler.event === event) {
          results.push(await handler.handler(payload, sessionContext(sessionId, widgetCalls, statuses)))
        }
      }
      return results
    }
    await dispatch("session_start", {}, "parent-session")
    const parentResult = (await dispatch(
      "tool_result",
      postEditEvent(["a.ts", "b.ts", "a.ts", "clean.ts", "unsupported.foo", "throwing.boom"]),
      "parent-session",
    )).find((result) => result !== undefined)
    const cleanResult = (await dispatch("tool_result", postEditEvent(["clean.ts"]), "parent-session")).find(
      (result) => result !== undefined,
    )
    await dispatch("session_shutdown", {}, "parent-session")
    const content = summarizePostEditContent(parentResult)
    return {
      handlers: handlers.map((handler) => handler.event).sort(),
      statuses,
      widgetCalls,
      content,
      cleanResult,
      blockCount: Math.max(0, content.length - 1),
      hasA: content.some((text) => text.includes("a.ts")),
      hasB: content.some((text) => text.includes("b.ts")),
      unsupportedHidden: !content.some((text) => text.includes("unsupported.foo")),
      throwingIsolated: content.some((text) => text.includes("throwing.boom") || text.includes("qa-failing")),
      noOutputCapMarker: content.join("\n").length,
    }
  } finally {
    process.chdir(previousCwd)
    restoreEnvValue("HOME", previousHome)
    restoreEnvValue("OMO_LSP_DAEMON_DIR", previousDaemonDir)
    restoreEnvValue("OMO_LSP_DAEMON_CLI", previousDaemonCli)
    restoreEnvValue("OMO_LSP_DAEMON_VERSION", previousDaemonVersion)
  }
}

function runInjectedPostEditProbe(evidenceDir) {
  const probe = spawnSync(
    "bun",
    [
      "-e",
      `
import { createLspComponent } from ${JSON.stringify(pathToFileURL(join(packageRoot, "src", "components", "lsp", "index.ts")).href)}
import { FakeExtensionAPI } from ${JSON.stringify(pathToFileURL(join(packageRoot, "test-support", "fake-extension-api.ts")).href)}
const pi = new FakeExtensionAPI()
const calls = []
const responses = new Map([
  ["parent.foo", { kind: "not_configured", extension: ".foo" }],
  ["child.foo", { kind: "not_configured", extension: ".foo" }],
  ["long.ts", "error[ts] (9999) at 1:1: " + "x".repeat(12000)],
])
const ctx = { logger: { info(){}, warn(){}, error(){} }, config: { getFlag: (name) => pi.getFlag(name) } }
createLspComponent({ postEdit: { runDiagnostics: async (filePath) => { calls.push(filePath); return responses.get(filePath) ?? "No diagnostics found" } } }).register(pi, ctx)
const sessionCtx = (id) => ({ sessionManager: { getSessionId: () => id }, ui: { setWidget() {} }, updateToolHookStatus() {} })
const event = (path) => ({ type:"tool_result", toolCallId:"write-"+path, toolName:"write", input:{ path }, content:[{ type:"text", text:"Wrote file successfully." }], isError:false })
await pi.dispatch("session_start", {}, sessionCtx("parent"))
await pi.dispatch("tool_result", event("parent.foo"), sessionCtx("parent"))
responses.set("parent.foo", "parent diagnostic after reset")
await pi.dispatch("session_start", {}, sessionCtx("parent"))
await pi.dispatch("tool_result", event("parent.foo"), sessionCtx("parent"))
await pi.dispatch("tool_result", event("child.foo"), sessionCtx("child"))
await pi.dispatch("session_compact", {}, sessionCtx("parent"))
await pi.dispatch("tool_result", event("parent.foo"), sessionCtx("parent"))
await pi.dispatch("tool_result", event("child.foo"), sessionCtx("child"))
await pi.dispatch("session_shutdown", {}, sessionCtx("parent"))
await pi.dispatch("tool_result", event("parent.foo"), sessionCtx("parent"))
const longResult = (await pi.dispatch("tool_result", event("long.ts"), sessionCtx("parent"))).find(Boolean)
const cacheCalls = calls.slice(0, 4)
console.log(JSON.stringify({
  calls,
  repeatedStartNoReprobe: cacheCalls.join("|") === "parent.foo|child.foo|parent.foo|parent.foo",
  compactRetry: cacheCalls[2] === "parent.foo",
  shutdownDelete: cacheCalls[3] === "parent.foo",
  childIsolation: cacheCalls[1] === "child.foo" && !cacheCalls.includes("child.foo", 2),
  noCap: JSON.stringify(longResult).includes("x".repeat(12000)),
}))
`,
    ],
    { cwd: repoRoot, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 },
  )
  if (probe.status !== 0) {
    throw new Error(`post-edit injected probe failed: ${probe.stderr || probe.stdout}`)
  }
  if (evidenceDir !== undefined) {
    mkdirSync(evidenceDir, { recursive: true })
    writeFileSync(join(evidenceDir, "post-edit-injected-probe.log"), probe.stdout)
  }
  const lastJson = probe.stdout.trim().split(/\r?\n/).findLast((line) => line.startsWith("{"))
  if (lastJson === undefined) throw new Error("post-edit injected probe did not print JSON")
  return JSON.parse(lastJson)
}

async function runPostEdit(evidenceDir) {
  const resolvedSenpi = findOnPath(process.env.SENPI_BIN?.trim() || "senpi")
  if (resolvedSenpi === null) throw new Error("senpi binary unavailable; post-edit scenario cannot SKIP")
  const tsServer = findOnPath("typescript-language-server")
  if (tsServer === null) throw new Error("typescript-language-server unavailable; post-edit scenario cannot SKIP")
  const workRoot = mkdtempSync(join(tmpdir(), "omo-senpi-lsp-post-edit-e2e-"))
  const beforeRealSenpiHash = digestDirectory(realSenpiAgentDir)
  const beforeRealPiHash = digestDirectory(join(homedir(), ".pi"))
  const beforeRealOmoDaemonHash = digestDirectory(join(homedir(), ".omo", "lsp-daemon"))
  let status
  let extractedPlugin
  let inspect
  let senpi
  try {
    const packed = packAndExtract(workRoot)
    extractedPlugin = packed.extractedPlugin
    const runtimeDist = join(extractedPlugin, "runtime", "lsp-daemon", "dist")
    await verifyRuntimeDist(runtimeDist)
    const packageJson = JSON.parse(readFileSync(join(runtimeDist, "package.json"), "utf8"))
    const version = typeof packageJson.version === "string" ? packageJson.version : "0"
    const cliPath = join(runtimeDist, "cli.js")
    const agentDir = join(workRoot, "agent")
    const homeDir = join(workRoot, "home")
    const projectDir = join(workRoot, "project")
    const sessionDir = join(workRoot, "sessions")
    const daemonDir = join(workRoot, "daemon")
    const failingSentinel = join(workRoot, "failing-server-started")
    spawnSync("mkdir", ["-p", agentDir, homeDir, projectDir, sessionDir, daemonDir])
    writePostEditUserConfig(homeDir, tsServer, failingSentinel)
    writePostEditProject(projectDir)
    const install = runChecked("node", [join(extractedPlugin, "scripts", "install.mjs"), "install"], {
      cwd: projectDir,
      env: { ...isolatedHomeEnv(process.env, homeDir), SENPI_CODING_AGENT_DIR: agentDir },
    })
    allowIsolatedToolPermission(agentDir, "write")
    status = await directStatusTwice(runtimeDist, daemonDir)
    inspect = await inspectExtractedPostEdit({
      extractedPlugin,
      projectDir,
      homeDir,
      daemonDir,
      cliPath,
      version,
    })
    const injected = runInjectedPostEditProbe(evidenceDir)
    senpi = runSenpiPostEditProof({
      senpiBin: resolvedSenpi,
      agentDir,
      homeDir,
      projectDir,
      sessionDir,
      daemonDir,
      cliPath,
      version,
    })
    const checks = {
      multiFileBlocks: inspect.hasA && inspect.hasB && inspect.blockCount >= 2,
      noCap: injected.noCap === true,
      statusWidget: inspect.statuses.includes("(OmO) Checking LSP Diagnostics") && inspect.widgetCalls.some((call) => call.key === "omo-senpi-lsp" && call.placement === "belowEditor"),
      unsupportedIsolation: inspect.unsupportedHidden === true,
      throwingIsolation: inspect.throwingIsolated === true && existsSync(failingSentinel),
      repeatedStartNoReprobe: injected.repeatedStartNoReprobe === true,
      compactRetry: injected.compactRetry === true,
      shutdownDelete: injected.shutdownDelete === true,
      childIsolation: injected.childIsolation === true,
      realSenpiPostEdit: senpi.postEditObserved === true,
      noDaemonStop:
        status.first.pid === status.second.pid &&
        status.first.endpoint.path === status.second.endpoint.path,
      realHomesUnchanged:
        beforeRealSenpiHash === digestDirectory(realSenpiAgentDir) &&
        beforeRealPiHash === digestDirectory(join(homedir(), ".pi")) &&
        beforeRealOmoDaemonHash === digestDirectory(join(homedir(), ".omo", "lsp-daemon")),
      noSkip: true,
    }
    const payload = {
      result: Object.values(checks).every(Boolean) ? "PASS" : "FAIL",
      scenario: "post-edit",
      checks,
      senpiBin: resolvedSenpi,
      typescriptLanguageServer: tsServer,
      extractedPlugin,
      extractedExtension: join(extractedPlugin, "extensions", "omo.js"),
      extractedRuntime: runtimeDist,
      isolatedAgentDir: agentDir,
      isolatedHomeDir: homeDir,
      isolatedProjectDir: projectDir,
      installStdout: install.stdout.trim(),
      packagedExtensionPostEdit: inspect,
      injectedSessionCacheProbe: injected,
      senpiPostEdit: {
        exitStatus: senpi.exitStatus,
        argv: senpi.argv,
        postEditObserved: senpi.postEditObserved,
        writeEvent: senpi.writeEvent,
      },
      directStatus: {
        sameOwner: status.first.pid === status.second.pid,
        sameEndpoint: status.first.endpoint.path === status.second.endpoint.path,
        firstPid: status.first.pid,
        secondPid: status.second.pid,
        endpoint: status.first.endpoint.path,
        authPresent: status.authPresent,
        overridePairUsed: status.overridePairUsed,
      },
      cleanup: "work root removed in finally; known daemon pid terminated",
    }
    writeEvidence(evidenceDir, payload, { senpi, packed })
    if (payload.result !== "PASS") process.exitCode = 1
    return payload
  } catch (error) {
    const payload = {
      result: "FAIL",
      scenario: "post-edit",
      reason: error instanceof Error ? error.message : String(error),
      extractedPlugin,
      directStatusStarted: status !== undefined,
      inspectStarted: inspect !== undefined,
      senpiExitStatus: senpi?.exitStatus,
    }
    writeEvidence(evidenceDir, payload, { senpi })
    process.exitCode = 1
    return payload
  } finally {
    if (status !== undefined) terminateKnownOwner(status)
    rmSync(workRoot, { recursive: true, force: true })
  }
}

function runSenpiPostEditProof(input) {
  const argv = [
    "-e",
    mockProviderEntry,
    "-p",
    "--mode",
    "json",
    "--provider",
    "omo-mock",
    "--model",
    "mock-1",
    "--permission",
    "edit=allow",
    "--session-dir",
    input.sessionDir,
    "write a TypeScript file so omo-senpi post-edit diagnostics run",
  ]
  const samplePath = join(input.projectDir, "senpi-write.ts")
  writeFileSync(
    join(input.projectDir, "mock-script.json"),
    `${JSON.stringify(
      {
        steps: [
          {
            type: "tool_call",
            name: "write",
            arguments: { path: samplePath, content: "export const senpiValue: string = 1\\n" },
          },
          { type: "text", text: "post-edit scenario complete" },
        ],
      },
      null,
      2,
    )}\n`,
  )
  const result = spawnSync(
    input.senpiBin,
    argv,
    {
      cwd: input.projectDir,
      env: {
        ...isolatedHomeEnv(process.env, input.homeDir),
        SENPI_CODING_AGENT_DIR: input.agentDir,
        SENPI_CODING_AGENT_SESSION_DIR: input.sessionDir,
        OMO_SENPI_QA: "1",
        OMO_LSP_DAEMON_DIR: input.daemonDir,
        OMO_LSP_DAEMON_CLI: input.cliPath,
        OMO_LSP_DAEMON_VERSION: input.version,
      },
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 64 * 1024 * 1024,
    },
  )
  const events = parseJsonEvents(result.stdout ?? "")
  const writeEvent = findToolExecution(events, "write")
  const writeText = JSON.stringify(writeEvent?.result ?? {})
  return {
    exitStatus: result.status,
    argv,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    writeEvent,
    postEditObserved:
      result.status === 0 &&
      writeText.includes("LSP errors detected") &&
      writeText.includes("senpi-write.ts") &&
      writeText.includes("error[typescript]"),
  }
}

async function runRuntimePackage(evidenceDir) {
  const resolvedSenpi = findOnPath(process.env.SENPI_BIN?.trim() || "senpi")
  if (resolvedSenpi === null) throw new Error("senpi binary unavailable; normal mode cannot SKIP")
  const workRoot = mkdtempSync(join(tmpdir(), "omo-senpi-lsp-e2e-"))
  const beforeRealHash = digestDirectory(realSenpiAgentDir)
  let status
  let extractedPlugin
  let senpi
  try {
    const packed = packAndExtract(workRoot)
    extractedPlugin = packed.extractedPlugin
    const runtimeDist = join(extractedPlugin, "runtime", "lsp-daemon", "dist")
    await verifyRuntimeDist(runtimeDist)
    const agentDir = join(workRoot, "agent")
    const homeDir = join(workRoot, "home")
    const projectDir = join(workRoot, "project")
    const sessionDir = join(workRoot, "sessions")
    const daemonDir = join(workRoot, "daemon")
    spawnSync("mkdir", ["-p", agentDir, homeDir, projectDir, sessionDir, daemonDir])
    const install = runChecked("node", [join(extractedPlugin, "scripts", "install.mjs"), "install"], {
      cwd: projectDir,
      env: { ...isolatedHomeEnv(process.env, homeDir), SENPI_CODING_AGENT_DIR: agentDir },
    })
    status = await directStatusTwice(runtimeDist, daemonDir)
    senpi = runSenpiLoadProof({ senpiBin: resolvedSenpi, agentDir, homeDir, projectDir, sessionDir, daemonDir })
    const settings = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"))
    const afterRealHash = digestDirectory(realSenpiAgentDir)
    const terminatedKnownPid = terminateKnownOwner(status)
    const payload = {
      result: senpi.extensionLoaded && beforeRealHash === afterRealHash ? "PASS" : "FAIL",
      scenario: "runtime-package",
      senpiBin: resolvedSenpi,
      extractedPlugin,
      extractedInstaller: join(extractedPlugin, "scripts", "install.mjs"),
      extractedExtension: join(extractedPlugin, "extensions", "omo.js"),
      extractedRuntime: runtimeDist,
      outsideRepo: !extractedPlugin.startsWith(repoRoot),
      isolatedAgentDir: agentDir,
      installedPackage: settings.packages?.[0],
      installStdout: install.stdout.trim(),
      extensionLoadProof: senpi.extensionLoaded,
      senpiExitStatus: senpi.exitStatus,
      senpiArgv: senpi.argv,
      directStatus: {
        sameOwner: status.first.pid === status.second.pid,
        sameEndpoint: status.first.endpoint.path === status.second.endpoint.path,
        firstPid: status.first.pid,
        secondPid: status.second.pid,
        endpoint: status.first.endpoint.path,
        authPresent: status.authPresent,
        overridePairUsed: status.overridePairUsed,
      },
      manifestValid: true,
      realSenpiHashUnchanged: beforeRealHash === afterRealHash,
      terminatedKnownPid,
      cleanup: "work root removed in finally",
    }
    writeEvidence(evidenceDir, payload, { senpi, packed })
    if (payload.result !== "PASS") process.exitCode = 1
    return payload
  } catch (error) {
    const payload = {
      result: "FAIL",
      scenario: "runtime-package",
      reason: error instanceof Error ? error.message : String(error),
      extractedPlugin,
      directStatusStarted: status !== undefined,
      senpiExitStatus: senpi?.exitStatus,
    }
    writeEvidence(evidenceDir, payload, { senpi })
    process.exitCode = 1
    return payload
  } finally {
    if (status !== undefined) terminateKnownOwner(status)
    rmSync(workRoot, { recursive: true, force: true })
  }
}

async function runTools(evidenceDir) {
  const resolvedSenpi = findOnPath(process.env.SENPI_BIN?.trim() || "senpi")
  if (resolvedSenpi === null) throw new Error("senpi binary unavailable; normal mode cannot SKIP")
  const tsServer = findOnPath("typescript-language-server")
  if (tsServer === null) throw new Error("typescript-language-server unavailable; tools scenario cannot SKIP")
  const workRoot = mkdtempSync(join(tmpdir(), "omo-senpi-lsp-tools-e2e-"))
  const beforeRealSenpiHash = digestDirectory(realSenpiAgentDir)
  const beforeRealPiHash = digestDirectory(join(homedir(), ".pi"))
  const beforeRealOmoDaemonHash = digestDirectory(join(homedir(), ".omo", "lsp-daemon"))
  let status
  let extractedPlugin
  let senpi
  let inspect
  try {
    const packed = packAndExtract(workRoot)
    extractedPlugin = packed.extractedPlugin
    const runtimeDist = join(extractedPlugin, "runtime", "lsp-daemon", "dist")
    await verifyRuntimeDist(runtimeDist)
    const packageJson = JSON.parse(readFileSync(join(runtimeDist, "package.json"), "utf8"))
    const version = typeof packageJson.version === "string" ? packageJson.version : "0"
    const cliPath = join(runtimeDist, "cli.js")
    const agentDir = join(workRoot, "agent")
    const homeDir = join(workRoot, "home")
    const projectDir = join(workRoot, "project")
    const emptyProjectDir = join(workRoot, "empty-project")
    const sessionDir = join(workRoot, "sessions")
    const daemonDir = join(workRoot, "daemon")
    spawnSync("mkdir", ["-p", agentDir, homeDir, projectDir, emptyProjectDir, sessionDir, daemonDir, join(homeDir, ".pi"), join(projectDir, ".pi")])
    writeFileSync(
      join(homeDir, ".pi", "lsp-client.json"),
      `${JSON.stringify(
        {
          lsp: {
            typescript: {
              command: [tsServer, "--stdio"],
              env: { OMO_SENPI_TOOLS_QA_USER_CONFIG: "1" },
              extensions: [".ts"],
              priority: 1000,
            },
          },
        },
        null,
        2,
      )}\n`,
    )
    const projectSentinel = join(workRoot, "project-command-spawned")
    writeFileSync(
      join(projectDir, ".pi", "lsp-client.json"),
      `${JSON.stringify(
        {
          lsp: {
            "project-sentinel": {
              command: ["sh", "-c", `printf spawned > ${JSON.stringify(projectSentinel)}`],
              extensions: [".ts"],
              priority: 2000,
            },
          },
        },
        null,
        2,
      )}\n`,
    )
    const install = runChecked("node", [join(extractedPlugin, "scripts", "install.mjs"), "install"], {
      cwd: projectDir,
      env: { ...isolatedHomeEnv(process.env, homeDir), SENPI_CODING_AGENT_DIR: agentDir },
    })
    allowIsolatedToolPermission(agentDir, "lsp_goto_definition")
    status = await directStatusTwice(runtimeDist, daemonDir)
    inspect = await inspectExtractedTools({
      extractedPlugin,
      projectDir,
      emptyProjectDir,
      homeDir,
      daemonDir,
      cliPath,
      version,
    })
    senpi = runSenpiToolProof({
      senpiBin: resolvedSenpi,
      agentDir,
      homeDir,
      projectDir,
      sessionDir,
      daemonDir,
      cliPath,
      version,
    })
    const descriptorNames = inspect.descriptors.map((descriptor) => descriptor.name).sort()
    const unavailableDetails = inspect.unavailable?.details
    const checks = {
      sixCompleteDescriptors: descriptorNames.length === 6 && descriptorNames.every((name) => name.startsWith("lsp_")),
      sequentialRename: inspect.descriptors.find((descriptor) => descriptor.name === "lsp_rename")?.executionMode === "sequential",
      rendererParity: inspect.descriptors.every((descriptor) => descriptor.hasRenderCall && descriptor.hasRenderResult),
      userPiGotoDefinition: senpi.toolSucceeded === true,
      projectCommandUnspawned: !existsSync(projectSentinel),
      oneWarning: inspect.warningCount === 1,
      unavailableShape:
        unavailableDetails?.errorKind === "missing_dependency" &&
        unavailableDetails?.availability?.kind === "not_configured" &&
        unavailableDetails?.availability?.installDecisionTool === false &&
        JSON.stringify(inspect.unavailable).includes(".pi") &&
        !JSON.stringify(inspect.unavailable).includes("install_decision"),
      extractedRuntimePath: runtimeDist.startsWith(extractedPlugin) && !runtimeDist.startsWith(repoRoot),
      realHomesUnchanged:
        beforeRealSenpiHash === digestDirectory(realSenpiAgentDir) &&
        beforeRealPiHash === digestDirectory(join(homedir(), ".pi")) &&
        beforeRealOmoDaemonHash === digestDirectory(join(homedir(), ".omo", "lsp-daemon")),
      noSkip: true,
    }
    const payload = {
      result: Object.values(checks).every(Boolean) ? "PASS" : "FAIL",
      scenario: "tools",
      checks,
      senpiBin: resolvedSenpi,
      typescriptLanguageServer: tsServer,
      extractedPlugin,
      extractedExtension: join(extractedPlugin, "extensions", "omo.js"),
      extractedRuntime: runtimeDist,
      isolatedAgentDir: agentDir,
      isolatedHomeDir: homeDir,
      isolatedProjectDir: projectDir,
      installedPackage: JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8")).packages?.[0],
      installStdout: install.stdout.trim(),
      descriptors: inspect.descriptors,
      warningCount: { inspectedExtension: inspect.warningCount, senpi: senpi.warningCount },
      senpiArgv: senpi.argv,
      unavailable: inspect.unavailable,
      gotoDefinitionToolEvent: senpi.toolEvent,
      directStatus: {
        sameOwner: status.first.pid === status.second.pid,
        sameEndpoint: status.first.endpoint.path === status.second.endpoint.path,
        firstPid: status.first.pid,
        secondPid: status.second.pid,
        endpoint: status.first.endpoint.path,
        authPresent: status.authPresent,
        overridePairUsed: status.overridePairUsed,
      },
      projectCommandSentinel: projectSentinel,
      cleanup: "work root removed in finally; known daemon pid terminated",
    }
    writeEvidence(evidenceDir, payload, { senpi, packed })
    if (payload.result !== "PASS") process.exitCode = 1
    return payload
  } catch (error) {
    const payload = {
      result: "FAIL",
      scenario: "tools",
      reason: error instanceof Error ? error.message : String(error),
      extractedPlugin,
      directStatusStarted: status !== undefined,
      senpiExitStatus: senpi?.exitStatus,
      inspectStarted: inspect !== undefined,
    }
    writeEvidence(evidenceDir, payload, { senpi })
    process.exitCode = 1
    return payload
  } finally {
    if (status !== undefined) terminateKnownOwner(status)
    rmSync(workRoot, { recursive: true, force: true })
  }
}

async function runVendoredRemoval(evidenceDir) {
  const architecture = runSeededArchitectureGuardProbe(evidenceDir)
  const tools = await runTools(evidenceDir === undefined ? undefined : join(evidenceDir, "tools"))
  const postEdit = await runPostEdit(evidenceDir === undefined ? undefined : join(evidenceDir, "post-edit"))
  const toolDescriptorNames = tools.descriptors?.map((descriptor) => descriptor.name).sort() ?? []
  const checks = {
    packedToolParity: tools.result === "PASS",
    packedPostEditParity: postEdit.result === "PASS",
    sixDescriptors:
      toolDescriptorNames.length === 6 &&
      toolDescriptorNames.join(",") ===
        "lsp_diagnostics,lsp_find_references,lsp_goto_definition,lsp_prepare_rename,lsp_rename,lsp_symbols",
    sequentialRename: tools.checks?.sequentialRename === true,
    alwaysVisibleUnavailableShape: tools.checks?.unavailableShape === true,
    projectCommandRejected: tools.checks?.projectCommandUnspawned === true,
    noRepositoryResolution:
      tools.checks?.extractedRuntimePath === true &&
      typeof tools.extractedPlugin === "string" &&
      !tools.extractedPlugin.startsWith(repoRoot) &&
      typeof postEdit.extractedPlugin === "string" &&
      !postEdit.extractedPlugin.startsWith(repoRoot),
    seededArchitectureGuardFailure: architecture.seededTransportManagerFailure === true,
    uncappedPostEdit: postEdit.checks?.noCap === true,
    noDaemonStop: postEdit.checks?.noDaemonStop === true,
    realHomesUnchanged: tools.checks?.realHomesUnchanged === true && postEdit.checks?.realHomesUnchanged === true,
    noSkip: tools.checks?.noSkip === true && postEdit.checks?.noSkip === true,
  }
  const payload = {
    result: Object.values(checks).every(Boolean) ? "PASS" : "FAIL",
    scenario: "vendored-removal",
    checks,
    architectureGuard: architecture,
    toolsResultPath: evidenceDir === undefined ? undefined : join(evidenceDir, "tools", "result.json"),
    postEditResultPath: evidenceDir === undefined ? undefined : join(evidenceDir, "post-edit", "result.json"),
    toolsSummary: {
      senpiBin: tools.senpiBin,
      typescriptLanguageServer: tools.typescriptLanguageServer,
      extractedPlugin: tools.extractedPlugin,
      extractedRuntime: tools.extractedRuntime,
      descriptors: tools.descriptors,
      warningCount: tools.warningCount,
      directStatus: tools.directStatus,
      senpiArgv: tools.senpiArgv,
    },
    postEditSummary: {
      senpiBin: postEdit.senpiBin,
      typescriptLanguageServer: postEdit.typescriptLanguageServer,
      extractedPlugin: postEdit.extractedPlugin,
      extractedRuntime: postEdit.extractedRuntime,
      packagedExtensionPostEdit: postEdit.packagedExtensionPostEdit,
      injectedSessionCacheProbe: postEdit.injectedSessionCacheProbe,
      directStatus: postEdit.directStatus,
      senpiArgv: postEdit.senpiPostEdit?.argv,
    },
    cleanup: "tools and post-edit scenarios removed their work roots and terminated known daemon pids",
  }
  writeEvidence(evidenceDir, payload, {})
  if (payload.result !== "PASS") process.exitCode = 1
  return payload
}

function writeEvidence(evidenceDir, payload, artifacts) {
  if (evidenceDir === undefined) return
  spawnSync("mkdir", ["-p", evidenceDir])
  writeJson(join(evidenceDir, "result.json"), payload)
  if (artifacts.senpi !== undefined) {
    writeFileSync(join(evidenceDir, "senpi.stdout.json.log"), artifacts.senpi.stdout ?? "")
    writeFileSync(join(evidenceDir, "senpi.stderr.log"), artifacts.senpi.stderr ?? "")
  }
}

async function runSelfTest(evidenceDir) {
  const scenario = parseArgs(process.argv).scenario
  if (scenario === "tools") return runToolsSelfTest(evidenceDir)
  if (scenario === "post-edit") return runPostEditSelfTest(evidenceDir)
  if (scenario === "vendored-removal") return runVendoredRemovalSelfTest(evidenceDir)
  const workRoot = mkdtempSync(join(tmpdir(), "omo-senpi-lsp-self-test-"))
  try {
    const plugin = join(workRoot, "plugin")
    const agentDir = join(workRoot, "agent")
    spawnSync("mkdir", ["-p", join(plugin, "extensions"), join(plugin, "skills", "ultrawork"), join(plugin, "skills", "ulw-loop"), join(plugin, "scripts")])
    writeFileSync(join(plugin, "package.json"), JSON.stringify({ name: "@code-yeongyu/omo-senpi" }))
    writeFileSync(join(plugin, "extensions", "omo.js"), "export default {}\n")
    writeFileSync(join(plugin, "skills", "ultrawork", "SKILL.md"), "# Ultrawork\n")
    writeFileSync(join(plugin, "skills", "ulw-loop", "SKILL.md"), "# ULW Loop\n")
    writeFileSync(join(plugin, "scripts", "install.mjs"), "placeholder\n")
    spawnSync("mkdir", ["-p", agentDir])
    writeFileSync(join(agentDir, "settings.json"), JSON.stringify({ packages: ["keep-me"] }))
    const install = spawnSync(
      "bun",
      [
        "-e",
        `import { runSenpiInstaller } from ${JSON.stringify(pathToFileURL(join(packageRoot, "src", "install", "install-senpi.ts")).href)}; await runSenpiInstaller({ agentDir: ${JSON.stringify(agentDir)}, pluginPath: ${JSON.stringify(plugin)} })`,
      ],
      { cwd: repoRoot, encoding: "utf8" },
    )
    const settings = JSON.parse(readFileSync(join(agentDir, "settings.json"), "utf8"))
    if (install.status === 0) throw new Error("self-test expected missing runtime install to fail")
    if (JSON.stringify(settings) !== JSON.stringify({ packages: ["keep-me"] })) {
      throw new Error("self-test expected settings to remain unchanged")
    }
    const payload = { result: "PASS", scenario: "runtime-package", missingRuntimeSettingsUnchanged: true }
    writeEvidence(evidenceDir, payload, {})
    return payload
  } finally {
    rmSync(workRoot, { recursive: true, force: true })
  }
}

function runPostEditSelfTest(evidenceDir) {
  const content = summarizePostEditContent({
    content: [
      { type: "text", text: "Wrote file successfully." },
      { type: "text", text: "\n\nLSP errors detected in a.ts, please fix:\nerror[ts] (1) at 1:1: broken" },
    ],
  })
  if (content.length !== 2 || !content[1].includes("a.ts")) throw new Error("self-test post-edit content summary failed")
  const injected = runInjectedPostEditProbe(evidenceDir)
  if (
    injected.repeatedStartNoReprobe !== true ||
    injected.compactRetry !== true ||
    injected.shutdownDelete !== true ||
    injected.childIsolation !== true ||
    injected.noCap !== true
  ) {
    throw new Error("self-test post-edit injected probe failed")
  }
  const payload = {
    result: "PASS",
    scenario: "post-edit",
    selfTest: true,
    contentSummary: true,
    injectedSessionCacheProbe: injected,
    noSkip: true,
  }
  writeEvidence(evidenceDir, payload, {})
  return payload
}

async function runToolsSelfTest(evidenceDir) {
  const events = parseJsonEvents(
    `${JSON.stringify({ type: "tool_execution_end", toolName: "lsp_goto_definition", result: { isError: false, content: [{ type: "text", text: "sample.ts:1:1" }] } })}\nnot-json\n`,
  )
  const toolEvent = findToolExecution(events, "lsp_goto_definition")
  if (toolEvent?.result?.isError === true) throw new Error("self-test expected tool event success")
  if (
    countProjectCommandWarnings(
      "omo-senpi ignored project-local LSP commands; move custom commands to the user .pi config",
    ) !== 1
  ) {
    throw new Error("self-test expected warning counter to detect one warning")
  }
  const descriptor = describeTool({
    name: "lsp_rename",
    label: "LSP Rename",
    description: "Rename",
    parameters: { properties: { filePath: {}, line: {} }, required: ["filePath"] },
    renderCall() {},
    renderResult() {},
    executionMode: "sequential",
  })
  if (descriptor.executionMode !== "sequential" || !descriptor.hasRenderCall || !descriptor.hasRenderResult) {
    throw new Error("self-test descriptor probe failed")
  }
  const payload = {
    result: "PASS",
    scenario: "tools",
    selfTest: true,
    parsedToolEvent: true,
    warningCounter: true,
    descriptorProbe: true,
    noSkip: true,
  }
  writeEvidence(evidenceDir, payload, {})
  return payload
}

async function runVendoredRemovalSelfTest(evidenceDir) {
  const architecture = runSeededArchitectureGuardProbe(evidenceDir)
  const tools = await runToolsSelfTest(evidenceDir === undefined ? undefined : join(evidenceDir, "tools-self-test"))
  const postEdit = runPostEditSelfTest(evidenceDir === undefined ? undefined : join(evidenceDir, "post-edit-self-test"))
  const checks = {
    seededArchitectureGuardFailure: architecture.seededTransportManagerFailure === true,
    toolsSelfTest: tools.result === "PASS",
    postEditSelfTest: postEdit.result === "PASS",
    noSkip: tools.noSkip === true && postEdit.noSkip === true,
  }
  const payload = {
    result: Object.values(checks).every(Boolean) ? "PASS" : "FAIL",
    scenario: "vendored-removal",
    selfTest: true,
    checks,
    architectureGuard: architecture,
  }
  writeEvidence(evidenceDir, payload, {})
  if (payload.result !== "PASS") process.exitCode = 1
  return payload
}

async function runAll(evidenceDir) {
  const runtimePackage = await runRuntimePackage(evidenceDir === undefined ? undefined : join(evidenceDir, "runtime-package"))
  const vendoredRemoval = await runVendoredRemoval(evidenceDir === undefined ? undefined : join(evidenceDir, "vendored-removal"))
  const checks = {
    runtimePackage: runtimePackage.result === "PASS",
    vendoredRemoval: vendoredRemoval.result === "PASS",
    reuse: runtimePackage.directStatus?.sameOwner === true && vendoredRemoval.toolsSummary?.directStatus?.sameOwner === true,
    auth: runtimePackage.directStatus?.authPresent === true && vendoredRemoval.toolsSummary?.directStatus?.authPresent === true,
    exactPiRouting: vendoredRemoval.checks?.alwaysVisibleUnavailableShape === true,
    projectCommandRejected: vendoredRemoval.checks?.projectCommandRejected === true,
    sessionReset: vendoredRemoval.postEditSummary?.injectedSessionCacheProbe?.compactRetry === true,
    sixDescriptors: vendoredRemoval.checks?.sixDescriptors === true,
    unboundedOutput: vendoredRemoval.checks?.uncappedPostEdit === true,
    noRepositoryResolution: runtimePackage.outsideRepo === true && vendoredRemoval.checks?.noRepositoryResolution === true,
    cleanup: runtimePackage.cleanup !== undefined && vendoredRemoval.cleanup !== undefined,
    realHomesUnchanged:
      runtimePackage.realSenpiHashUnchanged === true && vendoredRemoval.checks?.realHomesUnchanged === true,
    noSkip: runtimePackage.result !== "SKIP" && vendoredRemoval.result !== "SKIP",
  }
  const payload = {
    result: Object.values(checks).every(Boolean) ? "PASS" : "FAIL",
    scenario: "all",
    checks,
    scenarioResults: {
      runtimePackage: evidenceDir === undefined ? runtimePackage : join(evidenceDir, "runtime-package", "result.json"),
      vendoredRemoval: evidenceDir === undefined ? vendoredRemoval : join(evidenceDir, "vendored-removal", "result.json"),
    },
    extensionAndRuntime: {
      runtimePackageExtension: runtimePackage.extractedExtension,
      runtimePackageRuntime: runtimePackage.extractedRuntime,
      vendoredToolsExtension: vendoredRemoval.toolsSummary?.extractedPlugin === undefined
        ? undefined
        : join(vendoredRemoval.toolsSummary.extractedPlugin, "extensions", "omo.js"),
      vendoredToolsRuntime: vendoredRemoval.toolsSummary?.extractedRuntime,
    },
    childArgv: {
      runtimePackage: runtimePackage.senpiArgv,
      tools: vendoredRemoval.toolsSummary?.senpiArgv,
      postEdit: vendoredRemoval.postEditSummary?.senpiArgv,
    },
  }
  writeEvidence(evidenceDir, payload, {})
  if (payload.result !== "PASS") process.exitCode = 1
  return payload
}

async function runAllSelfTest(evidenceDir) {
  const runtimePackage = await runSelfTest(evidenceDir === undefined ? undefined : join(evidenceDir, "runtime-package-self-test"))
  const vendoredRemoval = await runVendoredRemovalSelfTest(evidenceDir === undefined ? undefined : join(evidenceDir, "vendored-removal-self-test"))
  const checks = {
    runtimePackageSelfTest: runtimePackage.result === "PASS",
    vendoredRemovalSelfTest: vendoredRemoval.result === "PASS",
    seededArchitectureGuardFailure: vendoredRemoval.checks?.seededArchitectureGuardFailure === true,
    toolsSelfTest: vendoredRemoval.checks?.toolsSelfTest === true,
    postEditSelfTest: vendoredRemoval.checks?.postEditSelfTest === true,
    noSkip: runtimePackage.result !== "SKIP" && vendoredRemoval.checks?.noSkip === true,
  }
  const payload = {
    result: Object.values(checks).every(Boolean) ? "PASS" : "FAIL",
    scenario: "all",
    selfTest: true,
    checks,
  }
  writeEvidence(evidenceDir, payload, {})
  if (payload.result !== "PASS") process.exitCode = 1
  return payload
}

const args = parseArgs(process.argv)
await mkdir(args.evidenceDir ?? tmpdir(), { recursive: true })
const payload = args.selfTest
  ? args.scenario === "all"
    ? await runAllSelfTest(args.evidenceDir)
    : await runSelfTest(args.evidenceDir)
  : args.scenario === "tools"
    ? await runTools(args.evidenceDir)
    : args.scenario === "post-edit"
      ? await runPostEdit(args.evidenceDir)
      : args.scenario === "vendored-removal"
        ? await runVendoredRemoval(args.evidenceDir)
        : args.scenario === "all"
          ? await runAll(args.evidenceDir)
          : await runRuntimePackage(args.evidenceDir)
console.log(JSON.stringify(payload))
