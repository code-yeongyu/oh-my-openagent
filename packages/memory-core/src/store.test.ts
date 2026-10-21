import { chmodSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "bun:test"

import { ensurePrivateDirectory, isPublicDirMode } from "./fs/private-dir"
import { TranscriptJournal } from "./journal/store"
import type { TranscriptEntry } from "./journal/entries"

const roots: string[] = []

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "omo-store-mode-"))
  roots.push(dir)
  return dir
}

/** `(statSync(path).mode & 0o7777)` — the bits the platform actually enforces. */
function modeOf(path: string): number {
  return statSync(path).mode & 0o7777
}

function transcriptEntry(id: string): TranscriptEntry {
  return {
    kind: "user",
    captured_at: "2026-10-21T00:00:00.000Z",
    source_line_id: id,
    source_message_id: `message-${id}`,
    text: `hello ${id}`,
  }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe("memory store directory modes", () => {
  describe("#given a fresh nested path", () => {
    describe("#when the directory is ensured", () => {
      test("#then every directory the call created is 0700", async () => {
        const runtime = join(scratch(), "memory", "agents", "alice", "runtime")
        const transcripts = join(runtime, "transcripts")

        await ensurePrivateDirectory(transcripts)

        const memory = join(runtime, "..", "..", "..")
        for (const path of [memory, join(memory, "agents"), join(memory, "agents", "alice"), runtime, transcripts]) {
          expect(modeOf(path)).toBe(0o700)
        }
      })

      test("#then it is idempotent on the second call", async () => {
        const root = join(scratch(), "memory")
        await ensurePrivateDirectory(root)
        await ensurePrivateDirectory(root)
        expect(modeOf(root)).toBe(0o700)
      })
    })
  })

  describe("#given a directory that already exists wider than 0700", () => {
    describe("#when the directory is ensured", () => {
      test("#then the 0755 legacy directory is tightened to 0700", async () => {
        const root = join(scratch(), "memory")
        await ensurePrivateDirectory(root)
        chmodSync(root, 0o755)
        expect(modeOf(root)).toBe(0o755)

        expect(await ensurePrivateDirectory(root)).toBe(true)
        expect(modeOf(root)).toBe(0o700)
      })

      test("#then a 0777 directory, wider still, is tightened to 0700", async () => {
        const root = join(scratch(), "memory")
        await ensurePrivateDirectory(root)
        chmodSync(root, 0o777)

        expect(await ensurePrivateDirectory(root)).toBe(true)
        expect(modeOf(root)).toBe(0o700)
      })
    })
  })

  describe("#given a directory that is already private", () => {
    describe("#when the directory is ensured", () => {
      test("#then the call reports that nothing was tightened", async () => {
        const root = join(scratch(), "memory")
        await ensurePrivateDirectory(root)

        expect(await ensurePrivateDirectory(root)).toBe(false)
        expect(modeOf(root)).toBe(0o700)
      })
    })
  })

  describe("#given a journal directory", () => {
    describe("#when the journal appends its first entry", () => {
      test("#then the journal directory is 0700", async () => {
        const journalDir = join(scratch(), "transcripts", "session-1")
        const journal = new TranscriptJournal({ journalDir })

        await journal.append([transcriptEntry("line-1")])

        expect(modeOf(journalDir)).toBe(0o700)
      })
    })

    describe("#when the journal directory is a legacy 0755 tree", () => {
      describe("#then the first append tightens it and leaves the entries alone", () => {
        test("#then the directory is 0700 and the appended file keeps its own mode", async () => {
          const journalDir = join(scratch(), "transcripts", "session-1")
          const journal = new TranscriptJournal({ journalDir })
          await journal.append([transcriptEntry("line-1")])
          chmodSync(journalDir, 0o755)
          const transcriptModeBefore = modeOf(journal.transcriptPath)

          await journal.append([transcriptEntry("line-2")])

          expect(modeOf(journalDir)).toBe(0o700)
          // Files are a separate concern: this change tightens directories only.
          expect(modeOf(journal.transcriptPath)).toBe(transcriptModeBefore)
        })
      })
    })
  })

  describe("#given a mode", () => {
    describe("#when it is classified", () => {
      test("#then only group or other bits count as public", () => {
        expect(isPublicDirMode(0o755)).toBe(true)
        expect(isPublicDirMode(0o750)).toBe(true)
        expect(isPublicDirMode(0o705)).toBe(true)
        expect(isPublicDirMode(0o777)).toBe(true)
        expect(isPublicDirMode(0o700)).toBe(false)
        expect(isPublicDirMode(0o600)).toBe(false)
      })
    })
  })

  describe("#given a private directory", () => {
    describe("#when a file inside it is written", () => {
      test("#then the file's own mode is left to the writer", async () => {
        const root = join(scratch(), "memory")
        await ensurePrivateDirectory(root)
        const file = join(root, "notes.md")
        writeFileSync(file, "hello")
        chmodSync(file, 0o644)

        expect(await ensurePrivateDirectory(root)).toBe(false)
        expect(modeOf(file)).toBe(0o644)
      })
    })
  })
})