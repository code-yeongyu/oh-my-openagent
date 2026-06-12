import { accessSync, constants, readFileSync } from "node:fs"
import { delimiter, dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { runInNewContext } from "node:vm"
import { describe, expect, test } from "bun:test"

import { bunWhich } from "./bun-which-shim"

type BunWhichFunction = (commandName: string) => string | null
type BunWhichRuntime = {
  Transpiler?: new (options: { loader: "ts" }) => { transformSync(source: string): string }
  which(commandName: string): string | null
}
type SandboxProcess = {
  env: { PATH?: string; Path?: string }
  platform: typeof process.platform
}
type BunWhichSandbox = {
  accessSync: typeof accessSync
  constants: typeof constants
  console: Console
  delimiter: typeof delimiter
  join: typeof join
  process: SandboxProcess
  __bunWhichShim?: { bunWhich: BunWhichFunction }
}

const runtime = globalThis as typeof globalThis & { Bun?: BunWhichRuntime }
const PATH_TRAVERSAL_COMMAND_NAMES = [
  "../etc/passwd",
  "/etc/passwd",
  "./tool",
  "sub/dir/tool",
  "C:\\Windows\\evil",
  "C:tool",
  ".",
  "..",
  "node..evil",
]
const NULL_BYTE_COMMAND_NAME = "node\0evil"
const NODE_FALLBACK_BUN_WHICH = loadNodeFallbackBunWhich()

function loadNodeFallbackBunWhich(): BunWhichFunction {
  const sourcePath = join(dirname(fileURLToPath(import.meta.url)), "bun-which-shim.ts")
  const source = readFileSync(sourcePath, "utf8")
  const fsImport = 'import { accessSync, constants } from "node:fs"\n'
  const pathImport = 'import { delimiter, join } from "node:path"\n'
  const exportSignature = "export function bunWhich(commandName: string): string | null {"

  if (!source.includes(fsImport) || !source.includes(pathImport) || !source.includes(exportSignature)) {
    throw new Error("bunWhich source shape changed")
  }

  const scriptSource = `${source
    .replace(fsImport, "")
    .replace(pathImport, "")
    .replace(exportSignature, "function bunWhich(commandName: string): string | null {")}\nglobalThis.__bunWhichShim = { bunWhich }\n`
  const transpilerConstructor = runtime.Bun?.Transpiler
  if (!transpilerConstructor) {
    throw new Error("Bun Transpiler unavailable")
  }

  const transpiler = new transpilerConstructor({ loader: "ts" })
  const script = transpiler.transformSync(scriptSource)
  const sandboxProcess: SandboxProcess = {
    env: { PATH: process.env.PATH, Path: process.env.Path },
    platform: process.platform,
  }
  const sandbox: BunWhichSandbox = { accessSync, constants, console, delimiter, join, process: sandboxProcess }

  runInNewContext(script, sandbox, { filename: sourcePath })

  const nodeFallbackBunWhich = sandbox.__bunWhichShim?.bunWhich
  if (!nodeFallbackBunWhich) {
    throw new Error("Node fallback bunWhich loader failed")
  }

  return nodeFallbackBunWhich
}

describe("bunWhich", () => {
  test("#given 'node' command #when resolved #then returns a non-null path ending in 'node'", () => {
    const resolvedPath = bunWhich("node")

    expect(resolvedPath).not.toBeNull()
    expect(resolvedPath?.toLowerCase()).toMatch(/node(?:\.exe)?$/)
  })

  test("#given a non-existent command #when resolved #then returns null", () => {
    const resolvedPath = bunWhich("this-command-definitely-does-not-exist-abc123xyz")

    expect(resolvedPath).toBeNull()
  })

  test("#given an empty string #when resolved #then returns null", () => {
    const resolvedPath = bunWhich("")

    expect(resolvedPath).toBeNull()
  })

  test("#given the result for 'node' #when resolved #then the returned path matches Bun.which('node')", () => {
    const nativePath = runtime.Bun?.which("node")
    const shimPath = bunWhich("node")

    expect(nativePath).not.toBeNull()
    expect(shimPath).toBe(nativePath)
  })

  test("#given path-traversal command names #when resolved through Bun runtime #then returns null", () => {
    for (const commandName of PATH_TRAVERSAL_COMMAND_NAMES) {
      expect(bunWhich(commandName)).toBeNull()
    }
  })

  test("#given a null-byte command name #when resolved through Bun runtime #then returns null", () => {
    expect(bunWhich(NULL_BYTE_COMMAND_NAME)).toBeNull()
  })
})

describe("#given Node fallback bunWhich loaded without Bun global", () => {
  test("#when 'node' command is resolved #then returns a non-null path ending in 'node'", () => {
    const resolvedPath = NODE_FALLBACK_BUN_WHICH("node")

    expect(resolvedPath).not.toBeNull()
    expect(resolvedPath?.toLowerCase()).toMatch(/node(?:\.exe)?$/)
  })

  test("#when a non-existent command is resolved #then returns null", () => {
    const resolvedPath = NODE_FALLBACK_BUN_WHICH("this-does-not-exist-abc123xyz")

    expect(resolvedPath).toBeNull()
  })

  test("#when an empty string is resolved #then returns null", () => {
    const resolvedPath = NODE_FALLBACK_BUN_WHICH("")

    expect(resolvedPath).toBeNull()
  })

  test("#when path-traversal command names are resolved #then returns null", () => {
    for (const commandName of PATH_TRAVERSAL_COMMAND_NAMES) {
      expect(NODE_FALLBACK_BUN_WHICH(commandName)).toBeNull()
    }
  })

  test("#when a null-byte command name is resolved #then returns null", () => {
    expect(NODE_FALLBACK_BUN_WHICH(NULL_BYTE_COMMAND_NAME)).toBeNull()
  })
})
