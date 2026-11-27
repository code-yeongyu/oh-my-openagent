import { afterAll, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { dirname, join, relative, resolve } from "node:path"
import { parseSync } from "oxc-parser"

// Security contract: each preload entry file every bun runner loads (test-setup.ts, posthog-test-guard.preload.ts; the
// preload audit pins that every runner loads one) installs the real-account guards itself. A child bun test runs with
// ONLY that file preloaded and a probe: deleting the guard import from the file makes its row fail.

const REPO = resolve(import.meta.dir, "..")
const ENTRIES = ["test-setup.ts", "test-support/posthog-test-guard.preload.ts"] as const

const PROBE = `import { test } from "bun:test"
import { createConnection } from "node:net"
import { join } from "node:path"
test("probe", async () => {
  let dial = "allowed"
  try {
    const socket = createConnection({ path: join(process.env.PROBE_STATE_DIR ?? "", "service.sock") })
    socket.on("error", () => {})
    socket.destroy()
  } catch (error) {
    dial = /real device service/.test(String(error)) ? "refused" : "other"
  }
  const marked = Reflect.get(Bun.secrets, Symbol.for("omo.test.injectedSecrets")) === true
  let read = "allowed"
  try {
    await Bun.secrets.get({ service: "omo-guard-probe", name: "probe" })
  } catch (error) {
    read = /real OS credential store/.test(String(error)) ? "refused" : "other"
  }
  console.log("PROBE " + JSON.stringify({ dial, marked, read }))
})
`

const root = mkdtempSync(join(tmpdir(), "omo-guard-wiring-"))
afterAll(() => rmSync(root, { recursive: true, force: true }))

async function probeUnder(
  entry: string,
): Promise<{ readonly probe: Record<string, unknown>; readonly output: string }> {
  const dir = mkdtempSync(join(root, "run-"))
  const home = join(dir, "home")
  mkdirSync(home)
  writeFileSync(join(dir, "probe.test.ts"), PROBE)
  // The child's home is the "machine's own": its device-service dir is what the guard must refuse.
  const child = Bun.spawn([process.execPath, "test", "--preload", join(REPO, entry), "./probe.test.ts"], {
    cwd: dir,
    env: {
      PATH: process.env["PATH"] ?? "",
      HOME: home,
      USERPROFILE: home,
      TMPDIR: dir,
      PROBE_STATE_DIR: join(home, ".omo", "device-service"),
    },
    stdout: "pipe",
    stderr: "pipe",
  })
  const [stdout, stderr] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()])
  await child.exited
  const output = stdout + stderr
  const line = output.split("\n").find((entryLine) => entryLine.startsWith("PROBE "))
  if (line === undefined) throw new Error(`the probe printed nothing under ${entry}:\n${output}`)
  return { probe: JSON.parse(line.slice("PROBE ".length)) as Record<string, unknown>, output }
}

describe("real-account guards are wired into each preload entry", () => {
  test.each(ENTRIES)(
    "#given only %s preloaded #when a test dials the home's device service and reads the credential store #then the dial is refused and recorded, and the store is never the real one",
    async (entry) => {
      const { probe, output } = await probeUnder(entry)

      expect(probe["dial"]).toBe("refused")
      expect(output).toContain("a test dialed this machine's real device service")
      // Under test-setup.ts the hermetic in-memory store replaces the refusing stand-in; either way it is a marked fake.
      expect(probe["marked"]).toBe(true)
      if (entry !== "test-setup.ts") expect(probe["read"]).toBe("refused")
    },
    60_000,
  )
})

// The runners that load neither preload (vitest in the two vendored LSP packages, node --test in the Codex plugin and
// the desktop boundary script) get no guard, so the trees they test must not reach the device service at all.
const UNGUARDED_TREES = [
  "packages/lsp-daemon",
  "packages/lsp-tools-mcp",
  "packages/omo-codex/plugin",
  "scripts/desktop-package-boundaries.test.mjs",
] as const
const FORBIDDEN_DIRS = [
  "packages/device-service-core",
  "packages/omo-senpi/src/components/omo-sdk",
  "packages/omo-senpi/src/components/remote",
] as const
const FORBIDDEN_PACKAGES = /^@oh-my-opencode\/(device-service-core|omo-senpi)(\/|$)/
type Node = { readonly type: string; readonly [key: string]: unknown }
const isNode = (value: unknown): value is Node =>
  typeof value === "object" && value !== null && typeof Reflect.get(value, "type") === "string"
function* walk(node: unknown): Generator<Node> {
  if (Array.isArray(node)) {
    for (const item of node) yield* walk(item)
    return
  }
  if (!isNode(node)) return
  yield node
  for (const [key, value] of Object.entries(node)) if (key !== "parent") yield* walk(value)
}
const literal = (node: unknown): string | undefined => {
  const value = isNode(node) && node.type === "Literal" ? node["value"] : undefined
  return typeof value === "string" ? value : undefined
}

// Parsed, so a specifier quoted in a string or a comment (a fixture) is not an import.
function specifiersOf(path: string, text: string): string[] {
  const found: string[] = []
  for (const node of walk(parseSync(path, text).program)) {
    if (
      ["ImportDeclaration", "ExportNamedDeclaration", "ExportAllDeclaration", "ImportExpression"].includes(node.type)
    ) {
      const source = literal(node["source"])
      if (source !== undefined) found.push(source)
    }
    const callee = node.type === "CallExpression" ? node["callee"] : undefined
    if (isNode(callee) && callee.type === "Identifier" && callee["name"] === "require") {
      const first = literal((node["arguments"] as unknown[] | undefined)?.[0])
      if (first !== undefined) found.push(first)
    }
  }
  return found
}

function forbiddenImports(): string[] {
  const listed = spawnSync("git", ["ls-files", "--", ...UNGUARDED_TREES], { cwd: REPO, encoding: "utf8" })
  if (listed.status !== 0) throw new Error(`git ls-files failed: ${listed.stderr}`)
  const sources = listed.stdout
    .split("\n")
    .filter((path) => /\.(m|c)?[jt]sx?$/.test(path) && !/(^|\/)(node_modules|dist)\//.test(path))
  return sources.flatMap((path) => {
    const text = readFileSync(join(REPO, path), "utf8")
    return specifiersOf(path, text).flatMap((specifier) => {
      if (FORBIDDEN_PACKAGES.test(specifier)) return [`${path}: ${specifier}`]
      if (!specifier.startsWith(".")) return []
      const target = relative(REPO, resolve(REPO, dirname(path), specifier))
      return FORBIDDEN_DIRS.some((dir) => target === dir || target.startsWith(`${dir}/`))
        ? [`${path}: ${specifier}`]
        : []
    })
  })
}

describe("runners without the guard preload", () => {
  test("#given the trees the vitest and node --test runners test #when their imports are read #then none reaches the device-service core, the SDK entry or the remote module", () => {
    expect(forbiddenImports()).toEqual([])
  })
})
