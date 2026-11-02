import { join } from "node:path"
import { afterEach, describe, expect, it } from "bun:test"

import { nodeSessionHistoryFs, type SessionHistoryFs } from "./session-history-fs"
import { collect, createTempDirectories, encodeRecord, makeTestScanner, writeTranscript } from "./test-support"

const temp = createTempDirectories()
afterEach(() => temp.cleanup())

const nowMs = Date.parse("2026-08-24T12:00:00.000Z")
const codexSession = (id: string, cwd: string, prompt: string) =>
  [encodeRecord({ type: "session_meta", payload: { id, cwd } }), encodeRecord({ type: "event_msg", payload: { type: "user_message", message: prompt } })].join("\n")
const rolloutPath = (codexHomePath: string, name: string) => join(codexHomePath, "sessions", "2026", "08", "24", name)

describe("session-history recentSessions budgets (parity with desktop import caps)", () => {
  it("#given a transcript with excessive records #when listed #then skips it without blocking an older one", async () => {
    // given
    const claudeHomePath = await temp.make("record-budget-claude-")
    const codexHomePath = await temp.make("record-budget-codex-")
    const workspace = await temp.make("record-budget-workspace-")
    for (const [sessionId, padding, mtimeMs] of [["excessive", "\n".repeat(100_001), nowMs], ["older", "", nowMs - 1_000]] as const) {
      await writeTranscript({ filePath: rolloutPath(codexHomePath, `rollout-${sessionId}.jsonl`), contents: codexSession(sessionId, workspace, "Imported prompt") + padding, mtimeMs })
    }

    // when
    const outcomes = await collect(makeTestScanner({ claudeHomePath, codexHomePath, now: () => nowMs }).recentSessions({ workspaceRoot: workspace }))

    // then
    expect(outcomes.map((outcome) => outcome._tag)).toEqual(["Skipped", "Importable"])
    expect(outcomes[1]).toMatchObject({ thread: { providerSessionId: "older" } })
  })

  it("#given an oversized tool record #when listed #then still imports the visible history", async () => {
    // given
    const claudeHomePath = await temp.make("claude-home-")
    const codexHomePath = await temp.make("codex-home-")
    const workspace = await temp.make("workspace-")
    const transcript = `${codexSession("large-session", workspace, "Import this large session")}\n${encodeRecord({ type: "tool_result", data: "" }).padEnd(16 * 1024 * 1024 + 1, " ")}`
    await writeTranscript({ filePath: rolloutPath(codexHomePath, "rollout-large.jsonl"), contents: transcript, mtimeMs: nowMs })

    // when
    const outcomes = await collect(makeTestScanner({ claudeHomePath, codexHomePath, now: () => nowMs }).recentSessions({ workspaceRoot: workspace }))

    // then
    expect(outcomes).toMatchObject([{ _tag: "Importable", thread: { providerSessionId: "large-session", messages: [{ role: "user", text: "Import this large session" }] } }])
  })

  it("#given five 16 MiB transcripts across agents #when listed #then streams each one fully exactly once", async () => {
    // given
    const claudeHomePath = await temp.make("budget-claude-")
    const codexHomePath = await temp.make("budget-codex-")
    const workspace = await temp.make("budget-workspace-")
    const transcriptPaths = new Set<string>()
    for (const [index, source] of (["codex", "claudeAgent", "codex", "claudeAgent", "codex"] as const).entries()) {
      const sessionId = `budget-session-${index}`
      const filePath = source === "codex" ? rolloutPath(codexHomePath, `rollout-${sessionId}.jsonl`) : join(claudeHomePath, "projects", "selected", `${sessionId}.jsonl`)
      const contents = source === "codex" ? codexSession(sessionId, workspace, "Imported prompt") : encodeRecord({ type: "user", cwd: workspace, sessionId, message: { content: "Imported prompt" } })
      transcriptPaths.add(filePath)
      await writeTranscript({ filePath, contents: `${contents}\n`.padEnd(16 * 1024 * 1024, " "), mtimeMs: nowMs - index * 1_000 })
    }
    const opens = new Map<string, number>()
    let fullReadBytes = 0
    const fs: SessionHistoryFs = { ...nodeSessionHistoryFs, open: async (filePath) => {
      const count = (opens.get(filePath) ?? 0) + 1
      opens.set(filePath, count)
      const file = await nodeSessionHistoryFs.open(filePath)
      if (!transcriptPaths.has(filePath) || count === 1) return file
      return { ...file, read: async (size: number) => {
        const chunk = await file.read(size)
        if (chunk !== null) fullReadBytes += chunk.byteLength
        return chunk
      } }
    } }
    const scanner = makeTestScanner({ claudeHomePath, codexHomePath, fs, now: () => nowMs })

    // when
    const scan = await scanner.scanProjects()
    const outcomes = await collect(scanner.recentSessions({ workspaceRoot: workspace }))

    // then
    expect(scan.candidates[0]?.threadCount).toBe(5)
    expect(outcomes.map((outcome) => outcome._tag)).toEqual(["Importable", "Importable", "Importable", "Importable", "Importable"])
    expect(fullReadBytes).toBe(80 * 1024 * 1024)
  })

  it("#given 101 recent sessions #when listed #then reads at most 100 transcripts", async () => {
    // given
    const claudeHomePath = await temp.make("count-budget-claude-")
    const codexHomePath = await temp.make("count-budget-codex-")
    const workspace = await temp.make("count-budget-workspace-")
    for (let index = 0; index < 101; index += 1) {
      await writeTranscript({ filePath: rolloutPath(codexHomePath, `rollout-${String(index).padStart(3, "0")}.jsonl`), contents: codexSession(`session-${index}`, workspace, `Prompt ${index}`), mtimeMs: nowMs - index * 1_000 })
    }

    // when
    const outcomes = await collect(makeTestScanner({ claudeHomePath, codexHomePath, now: () => nowMs }).recentSessions({}))

    // then
    expect(outcomes.filter((outcome) => outcome._tag === "Importable")).toHaveLength(100)
    expect(outcomes.at(-1)).toEqual({ _tag: "Skipped" })
  })

  it("#given sessions in a project and in the home directory #when listed without a project #then skips excluded folders", async () => {
    // given
    const claudeHomePath = await temp.make("all-claude-")
    const codexHomePath = await temp.make("all-codex-")
    const homeDir = await temp.make("all-home-")
    const workspace = await temp.make("all-workspace-")
    await writeTranscript({ filePath: rolloutPath(codexHomePath, "rollout-project.jsonl"), contents: codexSession("project-session", workspace, "Project work"), mtimeMs: nowMs })
    await writeTranscript({ filePath: rolloutPath(codexHomePath, "rollout-home.jsonl"), contents: codexSession("home-session", homeDir, "Home chat"), mtimeMs: nowMs - 1_000 })

    // when
    const outcomes = await collect(makeTestScanner({ claudeHomePath, codexHomePath, homeDir, now: () => nowMs }).recentSessions({}))

    // then
    expect(outcomes.flatMap((outcome) => outcome._tag === "Importable" ? [outcome.thread.providerSessionId] : [])).toEqual(["project-session"])
  })
})
