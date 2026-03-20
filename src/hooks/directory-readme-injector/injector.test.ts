import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { PluginInput } from "@opencode-ai/plugin"

const storageMaps = new Map<string, Set<string>>()

mock.module("./storage", () => ({
  loadInjectedPaths: (sessionID: string) => storageMaps.get(sessionID) ?? new Set<string>(),
  saveInjectedPaths: (sessionID: string, paths: Set<string>) => {
    storageMaps.set(sessionID, paths)
  },
}))

function createPluginContext(directory: string): PluginInput {
  return { directory } as PluginInput
}

function countReadmeMarkers(output: string): number {
  return output.split("[Project README:").length - 1
}

function createTruncator(input?: { truncated?: boolean; result?: string }) {
  return {
    truncate: async (_sessionID: string, content: string) => ({
      result: input?.result ?? content,
      truncated: input?.truncated ?? false,
    }),
    getUsage: async (_sessionID: string) => null,
    truncateSync: (output: string) => ({ result: output, truncated: false }),
  }
}

describe("processFilePathForReadmeInjection", () => {
  let testRoot = ""

  beforeEach(() => {
    testRoot = join(tmpdir(), `directory-readme-injector-${randomUUID()}`)
    mkdirSync(testRoot, { recursive: true })
    storageMaps.clear()
  })

  afterEach(() => {
    rmSync(testRoot, { recursive: true, force: true })
    storageMaps.clear()
  })

  it("injects README.md content from file's parent directory into output", async () => {
    // given
    const sourceDirectory = join(testRoot, "src")
    mkdirSync(sourceDirectory, { recursive: true })
    writeFileSync(join(sourceDirectory, "README.md"), "# Source README\nlocal context")

    const { processFilePathForReadmeInjection } = await import("./injector")
    const output = { title: "Result", output: "base", metadata: {} }
    const truncator = createTruncator()

    // when
    await processFilePathForReadmeInjection({
      ctx: createPluginContext(testRoot),
      truncator,
      sessionCaches: new Map<string, Set<string>>(),
      filePath: join(sourceDirectory, "file.ts"),
      sessionID: "session-parent",
      output,
    })

    // then
    expect(output.output).toContain("[Project README:")
    expect(output.output).toContain("# Source README")
    expect(output.output).toContain("local context")
  })

  it("includes root-level README.md (unlike agents-injector)", async () => {
    // given
    writeFileSync(join(testRoot, "README.md"), "# Root README\nroot context")

    const { processFilePathForReadmeInjection } = await import("./injector")
    const output = { title: "Result", output: "", metadata: {} }
    const truncator = createTruncator()

    // when
    await processFilePathForReadmeInjection({
      ctx: createPluginContext(testRoot),
      truncator,
      sessionCaches: new Map<string, Set<string>>(),
      filePath: join(testRoot, "file.ts"),
      sessionID: "session-root",
      output,
    })

    // then
    expect(output.output).toContain("[Project README:")
    expect(output.output).toContain("# Root README")
    expect(output.output).toContain("root context")
  })

  it("injects multiple README.md when walking up directory tree", async () => {
    // given
    const sourceDirectory = join(testRoot, "src")
    const componentsDirectory = join(sourceDirectory, "components")
    mkdirSync(componentsDirectory, { recursive: true })
    writeFileSync(join(testRoot, "README.md"), "# Root README")
    writeFileSync(join(sourceDirectory, "README.md"), "# Src README")
    writeFileSync(join(componentsDirectory, "README.md"), "# Components README")
    writeFileSync(join(componentsDirectory, "button.ts"), "export const button = true")

    const { processFilePathForReadmeInjection } = await import("./injector")
    const output = { title: "Result", output: "", metadata: {} }
    const truncator = createTruncator()

    // when
    await processFilePathForReadmeInjection({
      ctx: createPluginContext(testRoot),
      truncator,
      sessionCaches: new Map<string, Set<string>>(),
      filePath: join(componentsDirectory, "button.ts"),
      sessionID: "session-multi",
      output,
    })

    // then
    expect(countReadmeMarkers(output.output)).toBe(3)
    expect(output.output).toContain("# Root README")
    expect(output.output).toContain("# Src README")
    expect(output.output).toContain("# Components README")
  })

  it("does not re-inject already cached directories", async () => {
    // given
    const sourceDirectory = join(testRoot, "src")
    mkdirSync(sourceDirectory, { recursive: true })
    writeFileSync(join(sourceDirectory, "README.md"), "# Source README")

    const { processFilePathForReadmeInjection } = await import("./injector")
    const sessionCaches = new Map<string, Set<string>>()
    const sessionID = "session-cache"
    const truncator = createTruncator()
    const firstOutput = { title: "Result", output: "", metadata: {} }
    const secondOutput = { title: "Result", output: "", metadata: {} }

    // when
    await processFilePathForReadmeInjection({
      ctx: createPluginContext(testRoot),
      truncator,
      sessionCaches,
      filePath: join(sourceDirectory, "a.ts"),
      sessionID,
      output: firstOutput,
    })
    await processFilePathForReadmeInjection({
      ctx: createPluginContext(testRoot),
      truncator,
      sessionCaches,
      filePath: join(sourceDirectory, "b.ts"),
      sessionID,
      output: secondOutput,
    })

    // then
    expect(countReadmeMarkers(firstOutput.output)).toBe(1)
    expect(secondOutput.output).toBe("")
  })

  it("shows truncation notice when content is truncated", async () => {
    // given
    const sourceDirectory = join(testRoot, "src")
    mkdirSync(sourceDirectory, { recursive: true })
    writeFileSync(join(sourceDirectory, "README.md"), "# Truncated README")

    const { processFilePathForReadmeInjection } = await import("./injector")
    const output = { title: "Result", output: "", metadata: {} }
    const truncator = createTruncator({ result: "trimmed content", truncated: true })

    // when
    await processFilePathForReadmeInjection({
      ctx: createPluginContext(testRoot),
      truncator,
      sessionCaches: new Map<string, Set<string>>(),
      filePath: join(sourceDirectory, "file.ts"),
      sessionID: "session-truncated",
      output,
    })

    // then
    expect(output.output).toContain("trimmed content")
    expect(output.output).toContain("[Note: Content was truncated")
  })

  it("does nothing when filePath cannot be resolved", async () => {
    // given
    const { processFilePathForReadmeInjection } = await import("./injector")
    const output = { title: "Result", output: "unchanged", metadata: {} }
    const truncator = createTruncator()

    // when
    await processFilePathForReadmeInjection({
      ctx: createPluginContext(testRoot),
      truncator,
      sessionCaches: new Map<string, Set<string>>(),
      filePath: "",
      sessionID: "session-empty-path",
      output,
    })

    // then
    expect(output.output).toBe("unchanged")
  })
})
