import { describe, test, expect, afterEach } from "bun:test"
import { writeFileSync, unlinkSync, existsSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { queryVectorAdapter } from "./vector-adapter"

let tempAdapterPaths: string[] = []

function createTempAdapter(): string {
  const path = join(tmpdir(), `test-adapter-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.py`)
  writeFileSync(path, "#!/usr/bin/env python3\nprint('{}')")
  tempAdapterPaths.push(path)
  return path
}

function cleanupTempAdapters(): void {
  for (const p of tempAdapterPaths) {
    if (existsSync(p)) {
      unlinkSync(p)
    }
  }
  tempAdapterPaths = []
}

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void
type MockExecFile = (cmd: string, args: string[], options: Record<string, unknown>, callback: ExecFileCallback) => void

describe("vector-adapter", () => {
  afterEach(cleanupTempAdapters)

  describe("queryVectorAdapter", () => {
    test("returns empty array when adapter path does not exist", async () => {
      const results = await queryVectorAdapter("pipeline", {
        adapterPath: "/nonexistent/path/to/query_lancedb.py",
      })

      expect(results).toEqual([])
    })

    test("returns empty array when subprocess fails", async () => {
      const results = await queryVectorAdapter("test", {
        adapterPath: "/usr/bin/false",
      })

      expect(results).toEqual([])
    })

    test("parses valid JSON output from subprocess", async () => {
      const adapterPath = createTempAdapter()
      const mockStdout = JSON.stringify({
        results: [
          {
            path: "opencode://ses_test",
            session_id: "ses_test",
            title: "Test Session",
            score: 0.85,
            match_type: ["semantic"],
            snippet: "found match in session...",
            source_type: "opencode_session",
            heading_path: "message/user",
          },
        ],
      })

      const mockSpawn = ((_cmd: string, _args: string[], _opts: Record<string, unknown>, cb: ExecFileCallback) => {
        cb(null, mockStdout, "")
      }) as unknown as typeof import("node:child_process").execFile

      const results = await queryVectorAdapter("test", {
        adapterPath,
        spawnOverride: mockSpawn,
      })

      expect(results.length).toBe(1)
      expect(results[0].session_id).toBe("ses_test")
      expect(results[0].title).toBe("Test Session")
      expect(results[0].score).toBe(0.85)
      expect(results[0].source).toBe("vector")
      expect(results[0].match_type).toContain("semantic")
    })

    test("returns empty array on malformed JSON", async () => {
      const adapterPath = createTempAdapter()
      const mockSpawn = ((_cmd: string, _args: string[], _opts: Record<string, unknown>, cb: ExecFileCallback) => {
        cb(null, "not valid json {{{", "")
      }) as unknown as typeof import("node:child_process").execFile

      const results = await queryVectorAdapter("test", {
        adapterPath,
        spawnOverride: mockSpawn,
      })

      expect(results).toEqual([])
    })

    test("transforms vector result into SearchResult shape", async () => {
      const adapterPath = createTempAdapter()
      const mockStdout = JSON.stringify({
        results: [
          {
            path: "opencode://ses_v1",
            session_id: "ses_v1",
            title: "Vector Test",
            score: 0.92,
            match_type: ["semantic"],
            snippet: "deployment pipeline configuration...",
            source_type: "opencode_session",
            heading_path: "message/assistant",
          },
        ],
      })

      const mockSpawn = ((_cmd: string, _args: string[], _opts: Record<string, unknown>, cb: ExecFileCallback) => {
        cb(null, mockStdout, "")
      }) as unknown as typeof import("node:child_process").execFile

      const results = await queryVectorAdapter("deployment", {
        adapterPath,
        spawnOverride: mockSpawn,
      })

      expect(results.length).toBe(1)
      const r = results[0]
      expect(r.session_id).toBe("ses_v1")
      expect(r.message_id).toBeDefined()
      expect(r.role).toBe("assistant")
      expect(r.excerpt).toBe("deployment pipeline configuration...")
      expect(r.match_count).toBeGreaterThan(0)
      expect(Array.isArray(r.match_type)).toBe(true)
      expect(r.source).toBe("vector")
      expect(typeof r.score).toBe("number")
      expect(r.timestamp).toBeUndefined()
    })

    test("gracefully handles stderr from subprocess", async () => {
      const adapterPath = createTempAdapter()
      const mockStdout = JSON.stringify({
        results: [
          {
            path: "opencode://ses_err",
            session_id: "ses_err",
            title: "Stderr Test",
            score: 0.5,
            match_type: ["keyword"],
            snippet: "test content",
            source_type: "opencode_session",
            heading_path: "message/user",
          },
        ],
      })

      const mockSpawn = ((_cmd: string, _args: string[], _opts: Record<string, unknown>, cb: ExecFileCallback) => {
        cb(null, mockStdout, "warning: some deprecation message on stderr")
      }) as unknown as typeof import("node:child_process").execFile

      const results = await queryVectorAdapter("test", {
        adapterPath,
        spawnOverride: mockSpawn,
      })

      expect(results.length).toBe(1)
    })

    test("does not throw on subprocess timeout", async () => {
      const adapterPath = createTempAdapter()
      const mockSpawn = ((_cmd: string, _args: string[], _opts: Record<string, unknown>, cb: ExecFileCallback) => {
        const err = new Error("ETIMEDOUT") as Error & { killed?: boolean }
        err.killed = true
        cb(err, "", "")
      }) as unknown as typeof import("node:child_process").execFile

      const results = await queryVectorAdapter("test", {
        adapterPath,
        spawnOverride: mockSpawn,
        timeoutMs: 100,
      })

      expect(results).toEqual([])
    })

    test("deduplicates by session_id within vector results", async () => {
      const adapterPath = createTempAdapter()
      const mockStdout = JSON.stringify({
        results: [
          {
            path: "opencode://ses_dup",
            session_id: "ses_dup",
            title: "Same Session A",
            score: 0.9,
            match_type: ["semantic"],
            snippet: "first chunk",
            source_type: "opencode_session",
            heading_path: "message/user",
          },
          {
            path: "opencode://ses_dup",
            session_id: "ses_dup",
            title: "Same Session B",
            score: 0.7,
            match_type: ["semantic"],
            snippet: "second chunk same session",
            source_type: "opencode_session",
            heading_path: "message/assistant",
          },
        ],
      })

      const mockSpawn = ((_cmd: string, _args: string[], _opts: Record<string, unknown>, cb: ExecFileCallback) => {
        cb(null, mockStdout, "")
      }) as unknown as typeof import("node:child_process").execFile

      const results = await queryVectorAdapter("test", {
        adapterPath,
        spawnOverride: mockSpawn,
      })

      const sesDup = results.filter((r) => r.session_id === "ses_dup")
      expect(sesDup.length).toBe(1)
      expect(sesDup[0].score).toBe(0.9)
    })

    test("message_id is deterministic for same input", async () => {
      const adapterPath = createTempAdapter()
      const mockStdout = JSON.stringify({
        results: [
          {
            path: "opencode://ses_stable",
            session_id: "ses_stable",
            title: "Stable",
            score: 0.88,
            match_type: ["semantic"],
            snippet: "stable snippet content",
            source_type: "opencode_session",
            heading_path: "message/user",
          },
        ],
      })

      const mkSpawn = () =>
        ((_cmd: string, _args: string[], _opts: Record<string, unknown>, cb: ExecFileCallback) => {
          cb(null, mockStdout, "")
        }) as unknown as typeof import("node:child_process").execFile

      const results1 = await queryVectorAdapter("test", {
        adapterPath,
        spawnOverride: mkSpawn(),
      })

      const results2 = await queryVectorAdapter("test", {
        adapterPath,
        spawnOverride: mkSpawn(),
      })

      expect(results1.length).toBe(1)
      expect(results2.length).toBe(1)
      expect(results1[0].message_id).toBe(results2[0].message_id)
    })

    test("ignores non-OpenCode results with no session_id", async () => {
      const adapterPath = createTempAdapter()
      const mockStdout = JSON.stringify({
        results: [
          {
            path: "opencode://ses_keep",
            session_id: "ses_keep",
            title: "Session Result",
            score: 0.9,
            match_type: ["semantic"],
            snippet: "valid session result",
            source_type: "opencode_session",
            heading_path: "message/user",
          },
          {
            path: "Zettelkasten/some-note.md",
            title: "A Markdown Note",
            score: 0.8,
            match_type: ["keyword"],
            snippet: "this is markdown content",
            source_type: "markdown_live_fallback",
            heading_path: "",
          },
          {
            path: "opencode://ses_only_path",
            title: "Path Only No Session ID",
            score: 0.7,
            match_type: ["keyword"],
            snippet: "path only item",
            source_type: "opencode_session",
            heading_path: "message/user",
          },
        ],
      })

      const mockSpawn = ((_cmd: string, _args: string[], _opts: Record<string, unknown>, cb: ExecFileCallback) => {
        cb(null, mockStdout, "")
      }) as unknown as typeof import("node:child_process").execFile

      const results = await queryVectorAdapter("test", {
        adapterPath,
        spawnOverride: mockSpawn,
      })

      expect(results.length).toBe(1)
      expect(results[0].session_id).toBe("ses_keep")
    })

    test("filters vector results by session_id when sessionId option is set", async () => {
      const adapterPath = createTempAdapter()
      const mockStdout = JSON.stringify({
        results: [
          {
            path: "opencode://ses_alpha",
            session_id: "ses_alpha",
            title: "Alpha Session",
            score: 0.95,
            match_type: ["semantic"],
            snippet: "alpha content",
            source_type: "opencode_session",
            heading_path: "message/user",
          },
          {
            path: "opencode://ses_beta",
            session_id: "ses_beta",
            title: "Beta Session",
            score: 0.88,
            match_type: ["semantic"],
            snippet: "beta content",
            source_type: "opencode_session",
            heading_path: "message/assistant",
          },
          {
            path: "opencode://ses_gamma",
            session_id: "ses_gamma",
            title: "Gamma Session",
            score: 0.72,
            match_type: ["semantic"],
            snippet: "gamma content",
            source_type: "opencode_session",
            heading_path: "message/user",
          },
        ],
      })

      const mockSpawn = ((_cmd: string, _args: string[], _opts: Record<string, unknown>, cb: ExecFileCallback) => {
        cb(null, mockStdout, "")
      }) as unknown as typeof import("node:child_process").execFile

      const results = await queryVectorAdapter("test", {
        adapterPath,
        spawnOverride: mockSpawn,
        sessionId: "ses_beta",
      })

      expect(results.length).toBe(1)
      expect(results[0].session_id).toBe("ses_beta")
      expect(results[0].title).toBe("Beta Session")
    })

    test("returns all results when sessionId option is not set", async () => {
      const adapterPath = createTempAdapter()
      const mockStdout = JSON.stringify({
        results: [
          {
            path: "opencode://ses_alpha",
            session_id: "ses_alpha",
            title: "Alpha Session",
            score: 0.95,
            match_type: ["semantic"],
            snippet: "alpha content",
            source_type: "opencode_session",
            heading_path: "message/user",
          },
          {
            path: "opencode://ses_beta",
            session_id: "ses_beta",
            title: "Beta Session",
            score: 0.88,
            match_type: ["semantic"],
            snippet: "beta content",
            source_type: "opencode_session",
            heading_path: "message/assistant",
          },
        ],
      })

      const mockSpawn = ((_cmd: string, _args: string[], _opts: Record<string, unknown>, cb: ExecFileCallback) => {
        cb(null, mockStdout, "")
      }) as unknown as typeof import("node:child_process").execFile

      const results = await queryVectorAdapter("test", {
        adapterPath,
        spawnOverride: mockSpawn,
      })

      expect(results.length).toBe(2)
      const ids = results.map((r) => r.session_id).sort()
      expect(ids).toEqual(["ses_alpha", "ses_beta"])
    })

    test("ignores results with wrong source_type", async () => {
      const adapterPath = createTempAdapter()
      const mockStdout = JSON.stringify({
        results: [
          {
            path: "opencode://ses_good",
            session_id: "ses_good",
            title: "Good",
            score: 0.9,
            match_type: ["semantic"],
            snippet: "good result",
            source_type: "opencode_session",
            heading_path: "message/user",
          },
          {
            path: "Zettelkasten/note.md",
            session_id: "ses_wrong_source",
            title: "Wrong Source",
            score: 0.85,
            match_type: ["keyword"],
            snippet: "wrong source type",
            source_type: "markdown_live_fallback",
            heading_path: "",
          },
        ],
      })

      const mockSpawn = ((_cmd: string, _args: string[], _opts: Record<string, unknown>, cb: ExecFileCallback) => {
        cb(null, mockStdout, "")
      }) as unknown as typeof import("node:child_process").execFile

      const results = await queryVectorAdapter("test", {
        adapterPath,
        spawnOverride: mockSpawn,
      })

      expect(results.length).toBe(1)
      expect(results[0].session_id).toBe("ses_good")
    })
  })
})