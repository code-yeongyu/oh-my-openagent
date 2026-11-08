#!/usr/bin/env bun
// Load the shipped bundle through a host stub with distinct catalog and activation lookups.
import assert from "node:assert/strict"
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..")
const bundlePath = join(packageRoot, "plugin", "extensions", "omo.js")

class HostStub {
  tools = new Map()
  activeTools = new Set()
  removedToolHints = new Map()
  handlers = new Map()
  flags = new Map()

  on(event, handler) {
    const handlers = this.handlers.get(event) ?? []
    handlers.push(handler)
    this.handlers.set(event, handlers)
  }
  registerFlag(name, options) { this.flags.set(name, options.default) }
  getFlag(name) { return this.flags.get(name) }
  registerTool(tool) { this.tools.set(tool.name, tool) }
  registerRemovedToolHint(name, hint) { this.removedToolHints.set(name, hint) }
  registerCommand() {}
  registerMessageRenderer() {}
  registerMcpServer() {}
  sendMessage() {}
  sendUserMessage() {}
  getAllTools() { return [...this.tools.values()] }

  async execute(name) {
    const tool = this.tools.get(name)
    if (tool === undefined) return { error: { code: "unknown_tool" } }
    if (!this.activeTools.has(name)) return { error: { code: "inactive_tool" } }
    return tool.execute("qa-call", {}, undefined, undefined, {})
  }
}

const sandbox = mkdtempSync(join(tmpdir(), "omo-toolkit-catalog-qa-"))
const previousCwd = process.cwd()
const previousEnv = { ...process.env }
const agentDir = join(sandbox, "agent")
mkdirSync(agentDir)
const errors = []
const warnings = []
const pi = new HostStub()
let proof
try {
  process.chdir(sandbox)
  for (const key of ["HOME", "USERPROFILE", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"]) {
    process.env[key] = sandbox
  }
  for (const key of ["OMO_CODING_AGENT_DIR", "SENPI_CODING_AGENT_DIR", "PI_CODING_AGENT_DIR"]) process.env[key] = agentDir
  for (const key of ["OMO_PACKAGE_DIR", "SENPI_PACKAGE_DIR", "PI_PACKAGE_DIR", "XAI_API_KEY"]) delete process.env[key]
  const bundle = await import(pathToFileURL(bundlePath).href)
  assert.equal(typeof bundle.composeOmoSenpiExtension, "function")
  assert.ok(bundle.omoSenpiComponents.some(component => component.name === "ulw-loop"))
  await bundle.composeOmoSenpiExtension(bundle.omoSenpiComponents, {
    logger: { info() {}, warn(message) { warnings.push(message) }, error(message, details) { errors.push({ message, details }) } },
  })(pi)
  assert.deepEqual(errors, [], "all packaged components must register successfully")
  const catalog = pi.getAllTools().map(tool => tool.name).sort()
  assert.ok(catalog.length > 0, "composition must produce a real catalog")
  assert.ok(!catalog.includes("omo_agent_toolkit"))
  const hint = pi.removedToolHints.get("omo_agent_toolkit")
  assert.match(hint, /OMO_AGENT_TOOLKIT_SDK_ROOT/)
  const removedResult = await pi.execute("omo_agent_toolkit")
  assert.equal(removedResult.error.code, "unknown_tool")
  assert.notEqual(removedResult.error.code, "inactive_tool")
  // A registered-but-inactive control proves the stub does not conflate these host outcomes.
  pi.registerTool({ name: "qa_catalog_control", execute: async () => ({ ok: true }) })
  assert.equal((await pi.execute("qa_catalog_control")).error.code, "inactive_tool")
  pi.activeTools.add("qa_catalog_control")
  assert.deepEqual(await pi.execute("qa_catalog_control"), { ok: true })
  proof = { verdict: "PASS", surface: "built-bundle-host-stub", catalog, removedToolHint: hint, removedResult, inactiveControl: "inactive_tool", warnings, isolatedAgentDir: agentDir }
} finally {
  try {
    for (const handler of pi.handlers.get("session_shutdown") ?? []) await handler({ type: "session_shutdown", reason: "quit" })
  } finally {
    process.chdir(previousCwd)
    for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key]
    Object.assign(process.env, previousEnv)
    rmSync(sandbox, { recursive: true, force: true })
  }
}
assert.ok(!existsSync(sandbox))
console.log(JSON.stringify({ ...proof, cleanup: { sandboxRemoved: true, cwdRestored: process.cwd() === previousCwd } }, null, 2))
