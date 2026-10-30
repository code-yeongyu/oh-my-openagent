import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const PACKAGE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const PATCH_SCRIPT = join(PACKAGE_ROOT, "bin", "senpi-patch.mjs")
const PI_AI_ANTHROPIC_MESSAGES = "@earendil-works/pi-ai/dist/api/anthropic-messages.js"
const ENGINE_BUNDLE = "dist/bundle"
// Claude Opus 5.5 rejects OAuth requests advertising Claude Code below 2.1.280 (claude_code_version_too_old).
const FLOOR = "2.1.280"

const roots: string[] = []

type Fixture = { root: string; anthropicMessages: string }

function anthropicMessagesSource(claudeCodeVersion: string): string {
  return [
    "// Stealth mode: Mimic Claude Code's tool naming exactly",
    `const claudeCodeVersion = "${claudeCodeVersion}";`,
    "// Claude Code 2.x tool names (canonical casing)",
    "const claudeCodeTools = [",
    '  "Read",',
    '  "Write",',
    '  "Edit",',
    '  "Bash",',
    "]",
    "export { claudeCodeTools }",
    "",
  ].join("\n")
}

// Where senpi's pi-ai lives: inside senpi (bundled publish), beside senpi (hoisted npm install), or
// beside senpi's real path in bun's isolated store while the install links senpi by symlink.
type Layout = "bundled" | "hoisted" | "bun-store"

function createFixture(claudeCodeVersion: string, layout: Layout = "bundled"): Fixture {
  const scratch = mkdtempSync(join(tmpdir(), "omo-senpi-patch-"))
  roots.push(scratch)
  const installRoot = layout === "bun-store" ? join(scratch, "node_modules", ".bun", "senpi@test") : scratch
  const root = layout === "bundled" ? scratch : join(installRoot, "node_modules", "@code-yeongyu", "senpi")
  mkdirSync(root, { recursive: true })
  writeFileSync(join(root, "package.json"), JSON.stringify({
    name: "@code-yeongyu/senpi",
    version: "2026.9.2",
    type: "module",
  }))
  const rpcPath = join(root, "dist", "modes", "rpc", "rpc-mode.js")
  mkdirSync(dirname(rpcPath), { recursive: true })
  writeFileSync(rpcPath, readFileSync(new URL("./modes/rpc/rpc-mode.js", import.meta.resolve("@code-yeongyu/senpi")), "utf8"))
  const anthropicMessages = join(layout === "bundled" ? root : installRoot, "node_modules", PI_AI_ANTHROPIC_MESSAGES)
  mkdirSync(dirname(anthropicMessages), { recursive: true })
  writeFileSync(anthropicMessages, anthropicMessagesSource(claudeCodeVersion))
  if (layout !== "bun-store") return { root, anthropicMessages }
  const linked = join(scratch, "node_modules", "@code-yeongyu", "senpi")
  mkdirSync(dirname(linked), { recursive: true })
  symlinkSync(root, linked, "junction")
  return { root: linked, anthropicMessages }
}

function bundledChunkSources(claudeCodeVersion: string): Record<string, string> {
  return {
    "chunks/anthropic-messages-TEST.js": `function cacheControl(){return{type:"ephemeral"}}var claudeCodeVersion="${claudeCodeVersion}",claudeCodeTools=["Read","Write"];export{claudeCodeTools};\n`,
    "chunks/session-worker.js": `init_prompt_cache_ttl();claudeCodeVersion="${claudeCodeVersion}",claudeCodeTools=["Read","Write"]}});\n`,
    "cli.js": 'import("./chunks/session-worker.js");\n',
  }
}

function writeEngineBundle(root: string, files: Record<string, string>): void {
  for (const [relative, source] of Object.entries(files)) {
    const path = join(root, ENGINE_BUNDLE, relative)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, source)
  }
}

function readEngineBundle(root: string, files: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.keys(files).map((relative) => [relative, readFileSync(join(root, ENGINE_BUNDLE, relative), "utf8")]))
}

function runPatch(root: string) {
  return spawnSync("node", [PATCH_SCRIPT], {
    encoding: "utf8",
    env: { ...process.env, OMO_SENPI_PATCH_ROOT: root },
  })
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("senpi-patch claudeCodeVersion floor", () => {
  describe(`#given a bundled pi-ai claudeCodeVersion below the ${FLOOR} floor`, () => {
    describe("#when the patch script runs as postinstall does", () => {
      test("#then the version is rewritten to the floor", () => {
        const fixture = createFixture("2.1.75")
        const result = runPatch(fixture.root)
        expect(result.status).toBe(0)
        expect(readFileSync(fixture.anthropicMessages, "utf8")).toBe(anthropicMessagesSource(FLOOR))
      })
    })
  })

  describe("#given a bundled pi-ai claudeCodeVersion already at the floor", () => {
    describe("#when the patch script runs", () => {
      test("#then the bundled file stays byte-identical", () => {
        const fixture = createFixture(FLOOR)
        const before = readFileSync(fixture.anthropicMessages, "utf8")
        const result = runPatch(fixture.root)
        expect(result.status).toBe(0)
        expect(readFileSync(fixture.anthropicMessages, "utf8")).toBe(before)
      })
    })
  })

  describe("#given a bundled pi-ai claudeCodeVersion above the floor", () => {
    describe("#when the patch script runs", () => {
      test("#then the bundled file is never downgraded and stays byte-identical", () => {
        const fixture = createFixture("2.1.300")
        const before = readFileSync(fixture.anthropicMessages, "utf8")
        const result = runPatch(fixture.root)
        expect(result.status).toBe(0)
        expect(readFileSync(fixture.anthropicMessages, "utf8")).toBe(before)
      })
    })
  })

  describe("#given the patch script already rewrote a below-floor version", () => {
    describe("#when it runs again", () => {
      test("#then the rewritten file is left unchanged and the exit stays clean", () => {
        const fixture = createFixture("2.1.75")
        runPatch(fixture.root)
        const afterFirst = readFileSync(fixture.anthropicMessages, "utf8")
        expect(afterFirst).toBe(anthropicMessagesSource(FLOOR))
        const second = runPatch(fixture.root)
        expect(second.status).toBe(0)
        expect(readFileSync(fixture.anthropicMessages, "utf8")).toBe(afterFirst)
      })
    })
  })

  describe("#given the bundled file has no claudeCodeVersion declaration", () => {
    describe("#when the patch script runs", () => {
      test("#then it fails with the unsupported-Senpi error naming the relative path", () => {
        const fixture = createFixture("2.1.75")
        writeFileSync(fixture.anthropicMessages, "export {}\n")
        const result = runPatch(fixture.root)
        expect(result.status).not.toBe(0)
        expect(result.stderr).toContain(`omo-ai: unsupported Senpi ${PI_AI_ANTHROPIC_MESSAGES}`)
      })
    })
  })

  for (const layout of ["hoisted", "bun-store"] as const) {
    describe(`#given a ${layout} install whose pi-ai lives beside senpi instead of inside it`, () => {
      describe("#when the patch script runs as postinstall does", () => {
        test("#then the pi-ai senpi resolves is raised to the floor", () => {
          const fixture = createFixture("2.1.75", layout)
          const result = runPatch(fixture.root)
          expect(result.stderr).toBe("")
          expect(result.status).toBe(0)
          expect(readFileSync(fixture.anthropicMessages, "utf8")).toBe(anthropicMessagesSource(FLOOR))
        })
      })
    })
  }

  describe("#given an engine whose pi-ai is not resolvable from senpi at all", () => {
    describe("#when the patch script runs", () => {
      test("#then it fails naming the missing pi-ai target", () => {
        const fixture = createFixture("2.1.75", "hoisted")
        rmSync(dirname(dirname(dirname(fixture.anthropicMessages))), { recursive: true, force: true })
        const result = runPatch(fixture.root)
        expect(result.status).not.toBe(0)
        expect(result.stderr).toContain(`omo-ai: installed Senpi target is missing: ${PI_AI_ANTHROPIC_MESSAGES}`)
      })
    })
  })
})

// The launcher runs the engine's pre-linked dist/bundle/cli.js whenever it exists, and that bundle
// inlines its own claudeCodeVersion, so the pi-ai floor alone never reaches the running engine.
describe("senpi-patch claudeCodeVersion floor in the engine bundle", () => {
  describe("#given bundled chunks advertising 2.1.251 as senpi 2026.9.22-4 ships them", () => {
    describe("#when the patch script runs as postinstall does", () => {
      test("#then every bundled declaration is raised to the floor and nothing else changes", () => {
        const fixture = createFixture(FLOOR)
        writeEngineBundle(fixture.root, bundledChunkSources("2.1.251"))
        const result = runPatch(fixture.root)
        expect(result.status).toBe(0)
        expect(readEngineBundle(fixture.root, bundledChunkSources(FLOOR))).toEqual(bundledChunkSources(FLOOR))
      })
    })
  })

  describe("#given bundled chunks already above the floor", () => {
    describe("#when the patch script runs", () => {
      test("#then the bundle is never downgraded and stays byte-identical", () => {
        const fixture = createFixture(FLOOR)
        writeEngineBundle(fixture.root, bundledChunkSources("2.1.300"))
        const result = runPatch(fixture.root)
        expect(result.status).toBe(0)
        expect(readEngineBundle(fixture.root, bundledChunkSources("2.1.300"))).toEqual(bundledChunkSources("2.1.300"))
      })
    })
  })

  describe("#given an engine bundle without any claudeCodeVersion declaration", () => {
    describe("#when the patch script runs", () => {
      test("#then it fails with the unsupported-Senpi error naming the bundle", () => {
        const fixture = createFixture(FLOOR)
        writeEngineBundle(fixture.root, { "cli.js": "export {}\n" })
        const result = runPatch(fixture.root)
        expect(result.status).not.toBe(0)
        expect(result.stderr).toContain(`omo-ai: unsupported Senpi ${ENGINE_BUNDLE}`)
      })
    })
  })
})
