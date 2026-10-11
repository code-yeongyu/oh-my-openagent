import { afterAll, describe, expect, it } from "bun:test"
import { createHash } from "node:crypto"
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

// #9113: the senpi extension importer re-transpiles the whole of `omo.js` on every start, so computer
// use may keep only its registration shell there; the desktop service, engine client, and handle live
// in `omo-computer-use.js` and are evaluated on first use. Inspect the emitted artifacts, not the
// source graph: only the build decides which module lands in which file.
const packageRoot = fileURLToPath(new URL("..", import.meta.url))
const pluginRoot = join(packageRoot, "plugin")
const extensionsDir = join(pluginRoot, "extensions")
const RUNTIME_FILE = "omo-computer-use.js"
const EVALUATIONS = "__omoComputerUseRuntimeEvaluations"
const DRIVER_TIMEOUT_MS = 60_000

// Strings owned by the implementation (desktop service, engine locator, engine status, handle, tool
// execute); terser mangles identifiers, but string literals survive it.
const IMPLEMENTATION_MARKERS = [
  "Timed out starting desktop engine",
  "computer run was aborted",
  "is quarantined by macOS Gatekeeper",
  "Desktop engine unavailable (",
  "Computer use is off for this session",
  "Closed the desktop session.",
] as const

// One marker per prelude asset; the sha256 values are dev's published bytes, mirrored from
// senpi-desktop-prelude/test/assets.sha256.json so a corrupted or stale staged JSON fails here too.
const PRELUDE_ASSET_FIELDS: readonly (readonly [field: string, marker: string, sha256: string])[] = [
  [
    "COMPUTER_PRELUDE_JAVASCRIPT",
    "computer.run() expects a function or code string",
    "fc39d82a33153e2497928d1ccaab801d3207c0a79a15a3fc0f5441557baece4d",
  ],
  [
    "COMPUTER_PRELUDE_PYTHON",
    "Positional args with trailing Nones dropped",
    "1c957b8494965fb0714361eb5620069756674f1452211be104a930abd866528b",
  ],
  [
    "COMPUTER_DECLARATIONS",
    "interface ComputerClickOptions extends ComputerDeliveryOptions",
    "bbf4686750944e342b9ba300d11dad850299459f2a8314e099f9a9c1062f5677",
  ],
  [
    "COMPUTER_DOCUMENTATION",
    "host desktop facade, experimental (present while the `computer` tool is active)",
    "ff5bdb57685fd57a7e666bf864f956a7c4937f90b9cfb6dfee306d8941501c3d",
  ],
  ["COMPUTER_SAFETY", "<critical>", "0c9f2d6223d92fdff268f1ee1eebc6f33870f5737bc09ab0dadafb96a4f36124"],
]

const roots: string[] = []

afterAll(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

function readExtension(file: string): string {
  const path = join(extensionsDir, file)
  expect(existsSync(path), `missing built extension at ${path}; run build:senpi-plugin first`).toBe(true)
  return readFileSync(path, "utf8")
}

describe("computer-use lazy runtime (#9113)", () => {
  it("#given the built plugin #when its artifacts are inspected #then the implementation lives only in the lazy entry", () => {
    const main = readExtension("omo.js")
    const runtime = readExtension(RUNTIME_FILE)
    const manifest = JSON.parse(readFileSync(join(pluginRoot, "package.json"), "utf8")) as {
      imports?: Record<string, string>
    }

    for (const marker of IMPLEMENTATION_MARKERS) {
      expect(main.includes(marker), `omo.js still bundles ${JSON.stringify(marker)}`).toBe(false)
      expect(runtime.includes(marker), `${RUNTIME_FILE} lacks ${JSON.stringify(marker)}`).toBe(true)
    }
    expect(main).toMatch(/\bimport\s*\(\s*["']#omo-computer-use-runtime["']\s*\)/)
    expect(manifest.imports?.["#omo-computer-use-runtime"]).toBe(`./extensions/${RUNTIME_FILE}`)
  })

  it("#given the built plugin #when the prelude asset is inspected #then the texts live only in the staged JSON, byte-identical to dev (#9113)", () => {
    const main = readExtension("omo.js")
    const runtime = readExtension(RUNTIME_FILE)
    const asset = JSON.parse(readExtension("assets.generated.json")) as Record<string, string>

    for (const [field, marker, sha256] of PRELUDE_ASSET_FIELDS) {
      expect(main.includes(marker), `omo.js still bundles prelude text ${JSON.stringify(marker)}`).toBe(false)
      expect(runtime.includes(marker), `${RUNTIME_FILE} still bundles prelude text ${JSON.stringify(marker)}`).toBe(false)
      expect(typeof asset[field], `staged prelude JSON lacks ${field}`).toBe("string")
      expect(
        createHash("sha256").update(asset[field]).digest("hex"),
        `staged prelude JSON's ${field} drifted from dev's published bytes`,
      ).toBe(sha256)
      expect(asset[field].includes(marker)).toBe(true)
    }
  })

  it("#given the built main bundle #when a session never uses the desktop #then the runtime entry is evaluated only on first use", async () => {
    // given: a copy of the plugin whose runtime entry counts its own evaluations. It sits inside the
    // package so the bundle's senpi peers resolve exactly as they do from plugin/extensions.
    const root = mkdtempSync(join(packageRoot, ".computer-use-lazy-"))
    roots.push(root)
    const copyExtensions = join(root, "plugin", "extensions")
    mkdirSync(copyExtensions, { recursive: true })
    copyFileSync(join(pluginRoot, "package.json"), join(root, "plugin", "package.json"))
    copyFileSync(join(extensionsDir, "omo.js"), join(copyExtensions, "omo.js"))
    copyFileSync(join(extensionsDir, "assets.generated.json"), join(copyExtensions, "assets.generated.json"))
    const realRuntime = join(extensionsDir, RUNTIME_FILE)
    const reexport = existsSync(realRuntime)
      ? `export * from ${JSON.stringify(pathToFileURL(copyRuntime(realRuntime, copyExtensions)).href)}\n`
      : ""
    writeFileSync(
      join(copyExtensions, RUNTIME_FILE),
      `globalThis.${EVALUATIONS} = (globalThis.${EVALUATIONS} ?? 0) + 1\n${reexport}`,
    )
    const home = join(root, "home")
    mkdirSync(home)
    const driver = join(root, "drive.mjs")
    writeFileSync(driver, DRIVER_SOURCE)

    // when
    const child = Bun.spawn([process.execPath, driver, join(copyExtensions, "omo.js")], {
      cwd: home,
      env: {
        ...process.env,
        HOME: home,
        USERPROFILE: home,
        XDG_CONFIG_HOME: join(home, ".config"),
        APPDATA: join(home, "AppData", "Roaming"),
        LOCALAPPDATA: join(home, "AppData", "Local"),
      },
      stdout: "pipe",
      stderr: "pipe",
    })
    const timer = setTimeout(() => child.kill(), DRIVER_TIMEOUT_MS)
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    clearTimeout(timer)

    // then
    expect(exitCode, `driver failed:\n${stderr}`).toBe(0)
    const steps = JSON.parse(stdout.trim().split("\n").at(-1) ?? "{}") as DriverSteps
    expect(steps.registered.tools).toEqual(["computer"])
    expect(steps.registered.evaluations).toBe(0)
    expect(steps.startup).toBe(0)
    expect(steps.executed).toEqual({ evaluations: 1, text: "Closed the desktop session." })
    expect(steps.status.evaluations).toBe(1)
    expect(steps.status.notice).toContain("Computer use: enabled=true active=false engine=not started")
  }, DRIVER_TIMEOUT_MS + 10_000)
})

function copyRuntime(realRuntime: string, dir: string): string {
  const copy = join(dir, "omo-computer-use.real.js")
  copyFileSync(realRuntime, copy)
  return copy
}

interface DriverSteps {
  readonly registered: { readonly evaluations: number; readonly tools: readonly string[] }
  readonly startup: number
  readonly executed: { readonly evaluations: number; readonly text: string }
  readonly status: { readonly evaluations: number; readonly notice: string }
}

// A fresh process: the module cache and globals of this test runner cannot hide an evaluation.
const DRIVER_SOURCE = `
import { pathToFileURL } from "node:url"
const count = () => globalThis.${EVALUATIONS} ?? 0
const mod = await import(pathToFileURL(process.argv[2]).href)
const component = mod.omoSenpiComponents.find((candidate) => candidate.name === "computer-use")
const tools = new Map()
const commands = new Map()
const handlers = new Map()
const notices = []
let active = ["read"]
const pi = {
  cwd: process.cwd(),
  registerTool: (tool) => void tools.set(tool.name, tool),
  registerCommand: (name, options) => void commands.set(name, options),
  on: (event, handler) => void handlers.set(event, [...(handlers.get(event) ?? []), handler]),
  getActiveTools: () => [...active],
  setActiveTools: (names) => { active = [...names] },
  executeTool: async () => ({ content: [] }),
}
const ctx = {
  cwd: process.cwd(),
  model: undefined,
  sessionManager: { getSessionId: () => "lazy-probe", getSessionDir: () => process.cwd() },
  ui: { notify: (message) => void notices.push(message) },
}
const emit = async (event, payload) => {
  for (const handler of handlers.get(event) ?? []) await handler(payload, ctx)
}
const logger = { debug() {}, info() {}, warn() {}, error() {} }
await component.register(pi, { logger, config: { getFlag: () => undefined } })
const steps = { registered: { evaluations: count(), tools: [...tools.keys()] } }
await emit("session_start", { type: "session_start", reason: "startup" })
await emit("resources_discover", {})
await emit("tool_activated", { type: "tool_activated", toolNames: ["read"] })
await emit("tool_execution_start", { type: "tool_execution_start", toolCallId: "c1", toolName: "read", args: {} })
steps.startup = count()
const closed = await tools.get("computer").execute("c2", { action: "close" }, undefined, undefined, ctx)
steps.executed = { evaluations: count(), text: closed.content[0]?.text }
await commands.get("computer").handler("status", ctx)
steps.status = { evaluations: count(), notice: notices.at(-1) ?? "" }
console.log(JSON.stringify(steps))
process.exit(0)
`
