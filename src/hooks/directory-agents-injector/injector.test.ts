import { randomUUID } from "node:crypto"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PluginInput } from "@opencode-ai/plugin"
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"

const storageMaps = new Map<string, Set<string>>()

mock.module("./constants", () => ({
  AGENTS_INJECTOR_STORAGE: "/tmp/directory-agents-injector-tests",
  AGENTS_FILENAME: "AGENTS.md",
}))

mock.module("./storage", () => ({
  loadInjectedPaths: (sessionID: string) => storageMaps.get(sessionID) ?? new Set<string>(),
  saveInjectedPaths: (sessionID: string, paths: Set<string>) => {
    storageMaps.set(sessionID, paths)
  },
  clearInjectedPaths: (sessionID: string) => {
    storageMaps.delete(sessionID)
  },
}))

const truncator = {
  truncate: async (_sessionID: string, content: string) => ({ result: content, truncated: false }),
  getUsage: async (_sessionID: string) => null,
  truncateSync: (output: string, _maxTokens: number, _preserveHeaderLines?: number) => ({
    result: output,
    truncated: false,
  }),
}

describe("processFilePathForAgentsInjection", () => {
  let testRoot = ""
  let srcDirectory = ""
  let componentsDirectory = ""

  const rootAgentsContent = "# ROOT AGENTS\nroot-level directives"
  const srcAgentsContent = "# SRC AGENTS\nsrc-level directives"
  const componentsAgentsContent = "# COMPONENT AGENTS\ncomponents-level directives"

  beforeEach(() => {
    storageMaps.clear()

    testRoot = join(tmpdir(), `directory-agents-injector-${randomUUID()}`)
    srcDirectory = join(testRoot, "src")
    componentsDirectory = join(srcDirectory, "components")

    mkdirSync(componentsDirectory, { recursive: true })
    writeFileSync(join(testRoot, "AGENTS.md"), rootAgentsContent)
    writeFileSync(join(srcDirectory, "AGENTS.md"), srcAgentsContent)
    writeFileSync(join(componentsDirectory, "AGENTS.md"), componentsAgentsContent)
    writeFileSync(join(componentsDirectory, "button.ts"), "export const button = true\n")
    writeFileSync(join(srcDirectory, "file.ts"), "export const sourceFile = true\n")
    writeFileSync(join(testRoot, "file.ts"), "export const rootFile = true\n")
  })

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true })
  })

  it("injects AGENTS.md content from file's parent directory into output", async () => {
    // given
    const { processFilePathForAgentsInjection } = await import("./injector")
    const output = { title: "Read result", output: "base output", metadata: {} }

    // when
    await processFilePathForAgentsInjection({
      ctx: { directory: testRoot } as PluginInput,
      truncator,
      sessionCaches: new Map(),
      filePath: join(srcDirectory, "file.ts"),
      sessionID: "session-parent",
      output,
    })

    // then
    expect(output.output).toContain("[Directory Context:")
    expect(output.output).toContain(srcAgentsContent)
  })

  it("skips root-level AGENTS.md", async () => {
    // given
    rmSync(join(srcDirectory, "AGENTS.md"), { force: true })
    rmSync(join(componentsDirectory, "AGENTS.md"), { force: true })
    const { processFilePathForAgentsInjection } = await import("./injector")
    const output = { title: "Read result", output: "base output", metadata: {} }

    // when
    await processFilePathForAgentsInjection({
      ctx: { directory: testRoot } as PluginInput,
      truncator,
      sessionCaches: new Map(),
      filePath: join(testRoot, "file.ts"),
      sessionID: "session-root-skip",
      output,
    })

    // then
    expect(output.output).not.toContain(rootAgentsContent)
    expect(output.output).not.toContain("[Directory Context:")
  })

  it("injects multiple AGENTS.md when walking up directory tree", async () => {
    // given
    const { processFilePathForAgentsInjection } = await import("./injector")
    const output = { title: "Read result", output: "base output", metadata: {} }

    // when
    await processFilePathForAgentsInjection({
      ctx: { directory: testRoot } as PluginInput,
      truncator,
      sessionCaches: new Map(),
      filePath: join(componentsDirectory, "button.ts"),
      sessionID: "session-multiple",
      output,
    })

    // then
    expect(output.output).toContain(srcAgentsContent)
    expect(output.output).toContain(componentsAgentsContent)
  })

  it("does not re-inject already cached directories", async () => {
    // given
    const { processFilePathForAgentsInjection } = await import("./injector")
    const sessionCaches = new Map<string, Set<string>>()
    const output = { title: "Read result", output: "base output", metadata: {} }

    // when
    await processFilePathForAgentsInjection({
      ctx: { directory: testRoot } as PluginInput,
      truncator,
      sessionCaches,
      filePath: join(componentsDirectory, "button.ts"),
      sessionID: "session-cache",
      output,
    })
    const outputAfterFirstCall = output.output
    await processFilePathForAgentsInjection({
      ctx: { directory: testRoot } as PluginInput,
      truncator,
      sessionCaches,
      filePath: join(componentsDirectory, "button.ts"),
      sessionID: "session-cache",
      output,
    })

    // then
    expect(output.output).toBe(outputAfterFirstCall)
    expect(output.output.split("[Directory Context:").length - 1).toBe(2)
  })

  it("shows truncation notice when content is truncated", async () => {
    // given
    const { processFilePathForAgentsInjection } = await import("./injector")
    const output = { title: "Read result", output: "base output", metadata: {} }
    const truncatedTruncator = {
      truncate: async (_sessionID: string, _content: string) => ({
        result: "truncated...",
        truncated: true,
      }),
      getUsage: async (_sessionID: string) => null,
      truncateSync: (output: string, _maxTokens: number, _preserveHeaderLines?: number) => ({
        result: output,
        truncated: false,
      }),
    }

    // when
    await processFilePathForAgentsInjection({
      ctx: { directory: testRoot } as PluginInput,
      truncator: truncatedTruncator,
      sessionCaches: new Map(),
      filePath: join(srcDirectory, "file.ts"),
      sessionID: "session-truncated",
      output,
    })

    // then
    expect(output.output).toContain("truncated...")
    expect(output.output).toContain("[Note: Content was truncated")
  })

  it("does nothing when filePath cannot be resolved", async () => {
    // given
    const { processFilePathForAgentsInjection } = await import("./injector")
    const output = { title: "Read result", output: "base output", metadata: {} }

    // when
    await processFilePathForAgentsInjection({
      ctx: { directory: testRoot } as PluginInput,
      truncator,
      sessionCaches: new Map(),
      filePath: "",
      sessionID: "session-empty-path",
      output,
    })

    // then
    expect(output.output).toBe("base output")
  })
})
