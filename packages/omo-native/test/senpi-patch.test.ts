import { afterEach, describe, expect, test } from "bun:test"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const PACKAGE_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)))
const PATCH_SCRIPT = join(PACKAGE_ROOT, "bin", "senpi-patch.mjs")
const BUNDLED_ANTHROPIC_MESSAGES = "node_modules/@earendil-works/pi-ai/dist/api/anthropic-messages.js"
const BUNDLED_MAIN = "dist/main.js"
const FLOOR = "2.1.251"
const CLI_THINKING_PERSISTENT =
  "created.session.setThinkingLevel(created.session.thinkingLevel)"
const CLI_THINKING_SESSION =
  "created.session.setSessionThinkingLevel(created.session.thinkingLevel)"

const roots: string[] = []

type Fixture = { root: string; anthropicMessages: string; main: string }

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

function cliThinkingMainSource(apply: string): string {
  return [
    "const cliThinkingOverride = runtimeParsed.thinking !== undefined || cliThinkingFromModel;",
    "if (created.session.model && cliThinkingOverride) {",
    `    ${apply};`,
    "}",
    "",
  ].join("\n")
}

function createFixture(claudeCodeVersion: string, apply = CLI_THINKING_SESSION): Fixture {
  const root = mkdtempSync(join(tmpdir(), "omo-senpi-patch-"))
  roots.push(root)
  writeFileSync(join(root, "package.json"), JSON.stringify({
    name: "@code-yeongyu/senpi",
    version: "2026.9.2",
    type: "module",
  }))
  const anthropicMessages = join(root, BUNDLED_ANTHROPIC_MESSAGES)
  mkdirSync(dirname(anthropicMessages), { recursive: true })
  writeFileSync(anthropicMessages, anthropicMessagesSource(claudeCodeVersion))
  const main = join(root, BUNDLED_MAIN)
  mkdirSync(dirname(main), { recursive: true })
  writeFileSync(main, cliThinkingMainSource(apply))
  return { root, anthropicMessages, main }
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
  describe("#given a bundled pi-ai claudeCodeVersion below the 2.1.251 floor", () => {
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
        expect(result.stderr).toContain(`omo-ai: unsupported Senpi ${BUNDLED_ANTHROPIC_MESSAGES}`)
      })
    })
  })
})

describe("senpi-patch CLI thinking session-only apply", () => {
  describe("#given startup re-applies the CLI thinking level through the persistent setter", () => {
    describe("#when the patch script runs as postinstall does", () => {
      test("#then the apply is rewritten to the session-only setter", () => {
        const fixture = createFixture(FLOOR, CLI_THINKING_PERSISTENT)
        const result = runPatch(fixture.root)
        expect(result.status).toBe(0)
        expect(readFileSync(fixture.main, "utf8")).toBe(cliThinkingMainSource(CLI_THINKING_SESSION))
        expect(readFileSync(fixture.anthropicMessages, "utf8")).toBe(anthropicMessagesSource(FLOOR))
      })
    })
  })

  describe("#given startup already uses the session-only setter", () => {
    describe("#when the patch script runs", () => {
      test("#then dist/main.js stays byte-identical", () => {
        const fixture = createFixture(FLOOR, CLI_THINKING_SESSION)
        const before = readFileSync(fixture.main, "utf8")
        const result = runPatch(fixture.root)
        expect(result.status).toBe(0)
        expect(readFileSync(fixture.main, "utf8")).toBe(before)
      })
    })
  })

  describe("#given the thinking apply was already rewritten", () => {
    describe("#when the patch script runs again", () => {
      test("#then the rewritten file is left unchanged and the exit stays clean", () => {
        const fixture = createFixture(FLOOR, CLI_THINKING_PERSISTENT)
        runPatch(fixture.root)
        const afterFirst = readFileSync(fixture.main, "utf8")
        expect(afterFirst).toBe(cliThinkingMainSource(CLI_THINKING_SESSION))
        const second = runPatch(fixture.root)
        expect(second.status).toBe(0)
        expect(readFileSync(fixture.main, "utf8")).toBe(afterFirst)
      })
    })
  })

  describe("#given dist/main.js has neither thinking apply form", () => {
    describe("#when the patch script runs", () => {
      test("#then it fails with the unsupported-Senpi error naming dist/main.js", () => {
        const fixture = createFixture(FLOOR)
        writeFileSync(fixture.main, "export {}\n")
        const result = runPatch(fixture.root)
        expect(result.status).not.toBe(0)
        expect(result.stderr).toContain(`omo-ai: unsupported Senpi ${BUNDLED_MAIN}`)
      })
    })
  })
})
