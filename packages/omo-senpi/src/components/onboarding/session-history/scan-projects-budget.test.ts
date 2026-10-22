import { dirname, join } from "node:path"
import { afterEach, describe, expect, it } from "bun:test"

import { nodeSessionHistoryFs, type SessionHistoryFs } from "./session-history-fs"
import { claudeSessionLine, createTempDirectories, encodeRecord, runScan, writeTranscript } from "./test-support"

const temp = createTempDirectories()
afterEach(() => temp.cleanup())

const byteLength = (text: string) => new TextEncoder().encode(text).byteLength

describe("session-history scanProjects budgets (parity with desktop discovery and metadata caps)", () => {
  for (const source of ["claudeAgent", "codex"] as const) {
    it(`#given 20,001 empty ${source} directories #when scanned #then stops at the 20,000 operation budget`, async () => {
      // given
      const claudeHomePath = await temp.make("claude-home-")
      const codexHomePath = await temp.make("codex-home-")
      const discoveryRoot = source === "claudeAgent" ? join(claudeHomePath, "projects") : join(codexHomePath, "sessions")
      const emptyDirectories = Array.from({ length: 20_001 }, (_, index) => `empty-${index.toString().padStart(5, "0")}`)
      let directoryReadCount = 0
      const fs: SessionHistoryFs = { ...nodeSessionHistoryFs, readDirectory: async (directory) => {
        if (directory === discoveryRoot) { directoryReadCount += 1; return emptyDirectories }
        if (dirname(directory) === discoveryRoot) { directoryReadCount += 1; return [] }
        return nodeSessionHistoryFs.readDirectory(directory)
      } }

      // when
      const result = await runScan({ claudeHomePath, codexHomePath, fs })

      // then
      expect(result.candidates).toEqual([])
      expect(directoryReadCount).toBe(20_000)
    })
  }

  for (const count of [64, 65]) {
    it(`#given ${count} one-MiB files across two homes #when scanned #then shares the 64 MiB metadata budget`, async () => {
      // given
      const claudeHomePath = await temp.make("metadata-home-")
      const secondHome = await temp.make("metadata-second-")
      const codexHomePath = await temp.make("metadata-codex-")
      const firstWorkspace = await temp.make("metadata-first-project-")
      const secondWorkspace = await temp.make("metadata-second-project-")
      const directories = [join(claudeHomePath, "projects", "p"), join(secondHome, "projects", "p")]
      const templates = directories.map((directory) => join(directory, "template.jsonl"))
      for (const [index, workspace] of [firstWorkspace, secondWorkspace].entries()) {
        const record = encodeRecord({ cwd: workspace })
        await writeTranscript({ filePath: templates[index] ?? "", contents: " ".repeat(1024 * 1024 - byteLength(record)) + record, mtimeMs: Date.parse("2026-01-01T00:00:00.000Z") - index * 1_000 })
      }
      const resolveFile = (filePath: string) => {
        const index = directories.indexOf(dirname(filePath))
        return index === -1 ? filePath : templates[index] ?? filePath
      }
      let reservedBytes = 0
      let opens = 0
      const requests: Array<number> = []
      const fs: SessionHistoryFs = {
        ...nodeSessionHistoryFs,
        readDirectory: async (directory) => {
          const index = directories.indexOf(directory)
          return index === -1 ? nodeSessionHistoryFs.readDirectory(directory) : Array.from({ length: index === 0 ? 32 : count - 32 }, (_, item) => `session-${item}.jsonl`)
        },
        stat: (filePath) => nodeSessionHistoryFs.stat(resolveFile(filePath)),
        open: async (filePath) => {
          if (!directories.includes(dirname(filePath))) return nodeSessionHistoryFs.open(filePath)
          opens += 1
          const file = await nodeSessionHistoryFs.open(resolveFile(filePath))
          return { ...file, read: (size: number) => { reservedBytes += size; requests.push(size); return file.read(size) } }
        },
      }

      // when
      const result = await runScan({ claudeHomePath, codexHomePath, fs, extraHomes: [{ source: "claudeAgent", homePath: secondHome }] })

      // then
      expect(result.candidates.map((candidate) => candidate.path)).toEqual([firstWorkspace, secondWorkspace])
      expect(result.candidates.map((candidate) => candidate.threadCount)).toEqual([32, 32])
      expect(result.truncated).toBe(count === 65 ? true : undefined)
      expect(opens).toBe(64)
      expect(reservedBytes).toBe(64 * 1024 * 1024)
      expect(requests[0]).toBe(8 * 1024)
      expect(Math.max(...requests)).toBe(8 * 1024)
    })
  }

  for (const count of [50, 51]) {
    it(`#given ${count} files that read one byte at a time #when scanned #then bounds open and read calls`, async () => {
      // given
      const claudeHomePath = await temp.make("short-metadata-home-")
      const codexHomePath = await temp.make("short-metadata-codex-")
      const workspace = await temp.make("short-metadata-project-")
      const directory = join(claudeHomePath, "projects", "p")
      const template = join(directory, "template.jsonl")
      const record = encodeRecord({ cwd: workspace })
      const contents = " ".repeat(399 - byteLength(record)) + record
      const bytes = new TextEncoder().encode(contents)
      await writeTranscript({ filePath: template, contents, mtimeMs: Date.parse("2026-01-01T00:00:00.000Z") })
      let operations = 0
      const fs: SessionHistoryFs = {
        ...nodeSessionHistoryFs,
        readDirectory: async (target) => target === directory ? Array.from({ length: count }, (_, index) => `session-${index}.jsonl`) : nodeSessionHistoryFs.readDirectory(target),
        stat: (filePath) => nodeSessionHistoryFs.stat(dirname(filePath) === directory ? template : filePath),
        open: async (filePath) => {
          if (dirname(filePath) !== directory) return nodeSessionHistoryFs.open(filePath)
          operations += 1
          let offset = 0
          const file = await nodeSessionHistoryFs.open(template)
          return { ...file, read: async () => {
            operations += 1
            if (offset === bytes.length) return null
            offset += 1
            return bytes.subarray(offset - 1, offset)
          } }
        },
      }

      // when
      const result = await runScan({ claudeHomePath, codexHomePath, fs })

      // then
      expect(operations).toBe(20_000)
      expect(result.candidates[0]?.threadCount).toBe(50)
      expect(result.truncated).toBe(count === 51 ? true : undefined)
    })
  }

  it("#given malformed metadata in one home #when scanned #then bounds records without excluding another home", async () => {
    // given
    const claudeHomePath = await temp.make("record-metadata-home-")
    const secondHome = await temp.make("record-metadata-second-")
    const codexHomePath = await temp.make("record-metadata-codex-")
    const workspace = await temp.make("record-metadata-project-")
    const directory = join(claudeHomePath, "projects", "p")
    const template = join(directory, "template.jsonl")
    await writeTranscript({ filePath: template, contents: "x\n".repeat(1_001), mtimeMs: Date.parse("2026-01-02T00:00:00.000Z") })
    await writeTranscript({ filePath: join(secondHome, "projects", "p", "session.jsonl"), contents: encodeRecord({ cwd: workspace }), mtimeMs: Date.parse("2026-01-01T00:00:00.000Z") })
    let malformedOpens = 0
    const fs: SessionHistoryFs = {
      ...nodeSessionHistoryFs,
      readDirectory: async (target) => target === directory ? Array.from({ length: 102 }, (_, index) => `session-${index}.jsonl`) : nodeSessionHistoryFs.readDirectory(target),
      stat: (filePath) => nodeSessionHistoryFs.stat(dirname(filePath) === directory ? template : filePath),
      open: (filePath) => {
        if (dirname(filePath) !== directory) return nodeSessionHistoryFs.open(filePath)
        malformedOpens += 1
        return nodeSessionHistoryFs.open(template)
      },
    }

    // when
    const result = await runScan({ claudeHomePath, codexHomePath, fs, extraHomes: [{ source: "claudeAgent", homePath: secondHome }] })

    // then
    expect(result.candidates.map((candidate) => candidate.path)).toEqual([workspace])
    expect(malformedOpens).toBe(100)
    expect(result.truncated).toBe(true)
  })

  for (const count of [19_999, 20_000]) {
    it(`#given ${count} project directories #when scanned #then reports unfinished directory work`, async () => {
      // given
      const claudeHomePath = await temp.make("directory-budget-home-")
      const codexHomePath = await temp.make("directory-budget-codex-")
      const projectsDir = join(claudeHomePath, "projects")
      let reads = 0
      const fs: SessionHistoryFs = { ...nodeSessionHistoryFs, readDirectory: async (directory) => {
        if (directory === projectsDir) { reads += 1; return Array.from({ length: count }, (_, index) => `project-${index}`) }
        if (dirname(directory) === projectsDir) { reads += 1; return [] }
        return nodeSessionHistoryFs.readDirectory(directory)
      } }

      // when
      const result = await runScan({ claudeHomePath, codexHomePath, fs })

      // then
      expect(reads).toBe(20_000)
      expect(result.candidates).toEqual([])
      expect(result.truncated).toBe(count === 20_000 ? true : undefined)
    })
  }

  it("#given leading records without a cwd #when scanned #then finds the cwd on a later line", async () => {
    // given
    const claudeHomePath = await temp.make("claude-home-")
    const codexHomePath = await temp.make("codex-home-")
    const workspace = await temp.make("workspace-")
    const contents = `{"type":"file-history-snapshot","messageId":"m1"}\n{"type":"queue-operation","operation":"enqueue"}\n${claudeSessionLine(workspace)}`
    await writeTranscript({ filePath: join(claudeHomePath, "projects", "-slug", "a.jsonl"), contents, mtimeMs: Date.parse("2026-01-01T00:00:00.000Z") })

    // when / then
    expect((await runScan({ claudeHomePath, codexHomePath })).candidates.map((candidate) => candidate.path)).toEqual([workspace])
  })

  it("#given a record ending exactly at the chunk boundary #when scanned #then reads it", async () => {
    // given
    const claudeHomePath = await temp.make("claude-home-")
    const codexHomePath = await temp.make("codex-home-")
    const workspace = await temp.make("workspace-")
    const record = claudeSessionLine(workspace).split("\n")[0] ?? ""
    const prefix = '{"padding":"'
    const suffix = `",${record.slice(1)}`
    const contents = `${prefix}${"x".repeat(32 * 1024 - prefix.length - suffix.length)}${suffix}`
    await writeTranscript({ filePath: join(claudeHomePath, "projects", "-exact", "session.jsonl"), contents, mtimeMs: Date.parse("2026-01-01T00:00:00.000Z") })

    // when
    const result = await runScan({ claudeHomePath, codexHomePath })

    // then
    expect(contents).toHaveLength(32 * 1024)
    expect(result.candidates.map((candidate) => candidate.path)).toEqual([workspace])
  })

  it("#given a first record larger than one chunk #when scanned #then still finds the session metadata", async () => {
    // given
    const claudeHomePath = await temp.make("claude-home-")
    const codexHomePath = await temp.make("codex-home-")
    const workspace = await temp.make("workspace-")
    const history = `{"type":"file-history-snapshot","data":"${"x".repeat(32 * 1024)}"}\n`
    await writeTranscript({ filePath: join(claudeHomePath, "projects", "-large", "session.jsonl"), contents: `${history}${claudeSessionLine(workspace)}`, mtimeMs: Date.parse("2026-01-01T00:00:00.000Z") })

    // when / then
    expect((await runScan({ claudeHomePath, codexHomePath })).candidates.map((candidate) => candidate.path)).toEqual([workspace])
  })
})
