import { afterAll, afterEach, beforeEach, describe, expect, it, mock } from "bun:test"
import { randomUUID } from "node:crypto"
import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import type { PluginInput } from "@opencode-ai/plugin"

const storageMaps = new Map<string, Set<string>>()
const logMock = mock(() => undefined)

mock.module("./storage", () => ({
  loadInjectedPaths: (sessionID: string) => storageMaps.get(sessionID) ?? new Set<string>(),
  saveInjectedPaths: (sessionID: string, paths: Set<string>) => {
    storageMaps.set(sessionID, paths)
  },
}))

mock.module("../../shared/logger", () => ({
  log: logMock,
}))

afterAll(() => {
  mock.restore()
})

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
    logMock.mockClear()
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

  it("returns a promise and finds README.md files from temp fixtures", async () => {
    // given
    const sourceDirectory = join(testRoot, "src")
    const componentsDirectory = join(sourceDirectory, "components")
    mkdirSync(componentsDirectory, { recursive: true })
    writeFileSync(join(testRoot, "README.md"), "# Root README")
    writeFileSync(join(sourceDirectory, "README.md"), "# Src README")
    writeFileSync(join(componentsDirectory, "README.md"), "# Components README")

    const { findReadmeMdUp } = await import("./finder")

    // when
    const promise = findReadmeMdUp({
      startDir: componentsDirectory,
      rootDir: testRoot,
    })

    // then
    expect(promise).toBeInstanceOf(Promise)
    await expect(promise).resolves.toEqual([
      join(testRoot, "README.md"),
      join(sourceDirectory, "README.md"),
      join(componentsDirectory, "README.md"),
    ])
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

  it("#given parallel reads for one session #when truncation overlaps #then the README is appended once", async () => {
    // given
    writeFileSync(join(testRoot, "README.md"), "# Root README")
    const { processFilePathForReadmeInjection } = await import("./injector")
    const sessionCaches = new Map<string, Set<string>>()
    const truncating = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const truncator = createTruncator()
    const input = {
      ctx: createPluginContext(testRoot),
      truncator,
      sessionCaches,
      sessionID: "session-overlap",
    }
    const first = { title: "Read A", output: "range A", metadata: {} }
    const second = { title: "Read B", output: "range B", metadata: {} }
    const third = { title: "Read C", output: "range C", metadata: {} }
    const otherSession = { title: "Read D", output: "range D", metadata: {} }

    // when
    const pending = processFilePathForReadmeInjection({
      ...input,
      truncator: {
        ...truncator,
        truncate: async (sessionID, content) => {
          truncating.resolve()
          await release.promise
          return truncator.truncate(sessionID, content)
        },
      },
      filePath: join(testRoot, "a.ts"),
      output: first,
    })
    try {
      await truncating.promise
      await processFilePathForReadmeInjection({ ...input, filePath: join(testRoot, "b.ts"), output: second })
    } finally {
      release.resolve()
      await pending
    }
    await processFilePathForReadmeInjection({ ...input, filePath: join(testRoot, "c.ts"), output: third })
    await processFilePathForReadmeInjection({
      ...input,
      sessionID: "session-other",
      filePath: join(testRoot, "d.ts"),
      output: otherSession,
    })

    // then
    expect(countReadmeMarkers(first.output + second.output)).toBe(1)
    expect(first.output.startsWith("range A")).toBe(true)
    expect(second.output.startsWith("range B")).toBe(true)
    expect(third.output).toBe("range C")
    expect(countReadmeMarkers(otherSession.output)).toBe(1)
  })

  it("#given a Read with a stale cache #when the session cache is reset mid-read #then the next Read can inject", async () => {
    // given
    writeFileSync(join(testRoot, "README.md"), "# Root README")
    const { processFilePathForReadmeInjection } = await import("./injector")
    const sessionCaches = new Map<string, Set<string>>()
    const original = { title: "Original", output: "original", metadata: {} }
    const next = { title: "Next", output: "next", metadata: {} }
    const input = {
      ctx: createPluginContext(testRoot),
      sessionCaches,
      sessionID: "session-reset",
      filePath: join(testRoot, "file.ts"),
    }
    const truncator = createTruncator()

    // when
    await processFilePathForReadmeInjection({
      ...input,
      truncator: {
        ...truncator,
        truncate: async (sessionID, content) => {
          sessionCaches.delete(sessionID)
          storageMaps.delete(sessionID)
          return truncator.truncate(sessionID, content)
        },
      },
      output: original,
    })
    await processFilePathForReadmeInjection({ ...input, truncator, output: next })

    // then
    expect(original.output).toBe("original")
    expect(countReadmeMarkers(next.output)).toBe(1)
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

  it("logs and skips a README when truncation fails", async () => {
    // given
    const sourceDirectory = join(testRoot, "src")
    mkdirSync(sourceDirectory, { recursive: true })
    const readmePath = join(sourceDirectory, "README.md")
    writeFileSync(readmePath, "# Source README")

    const { processFilePathForReadmeInjection } = await import("./injector")
    const output = { title: "Result", output: "base", metadata: {} }
    const sessionID = "session-truncation-failure"
    const sessionCaches = new Map<string, Set<string>>()
    const truncator = {
      truncate: async (_sessionID: string, _content: string) => {
        throw new Error("truncator unavailable")
      },
      getUsage: async (_sessionID: string) => null,
      truncateSync: (value: string) => ({ result: value, truncated: false }),
    }

    // when
    await processFilePathForReadmeInjection({
      ctx: createPluginContext(testRoot),
      truncator,
      sessionCaches,
      filePath: join(sourceDirectory, "file.ts"),
      sessionID,
      output,
    })

    // then
    expect(output.output).toBe("base")
    expect(storageMaps.has(sessionID)).toBe(false)
    expect(sessionCaches.get(sessionID)?.has(sourceDirectory) ?? false).toBe(false)
    expect(logMock).toHaveBeenCalledWith(
      "[directory-readme-injector] Skipped README injection after read/truncate failure",
      {
        error: "truncator unavailable",
        readmePath,
        sessionID,
      },
    )

    // when a later Read retries the same directory
    await processFilePathForReadmeInjection({
      ctx: createPluginContext(testRoot),
      truncator: createTruncator(),
      sessionCaches,
      filePath: join(sourceDirectory, "retry.ts"),
      sessionID,
      output,
    })

    // then
    expect(countReadmeMarkers(output.output)).toBe(1)
  })
})
