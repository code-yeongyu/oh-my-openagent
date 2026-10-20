import { stat } from "node:fs/promises"
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

async function fixture() {
  const claudeHomePath = await temp.make("claude-home-")
  const codexHomePath = await temp.make("codex-home-")
  const workspace = await temp.make("workspace-")
  const done = rolloutPath(codexHomePath, "rollout-done.jsonl")
  const fresh = rolloutPath(codexHomePath, "rollout-fresh.jsonl")
  await writeTranscript({ filePath: done, contents: codexSession("done-session", workspace, "Already imported"), mtimeMs: nowMs - 1_000 })
  await writeTranscript({ filePath: fresh, contents: codexSession("fresh-session", workspace, "New work"), mtimeMs: nowMs - 2_000 })
  return { claudeHomePath, codexHomePath, workspace, done, fresh }
}

async function identityOf(filePath: string) {
  const stats = await nodeSessionHistoryFs.stat(filePath)
  return { filePath, size: stats.size, mtimeMs: stats.mtimeMs, device: stats.dev, inode: stats.ino, birthtimeMs: stats.birthtimeMs }
}

function countingOpens(): { fs: SessionHistoryFs; opened: Array<string> } {
  const opened: Array<string> = []
  return { opened, fs: { ...nodeSessionHistoryFs, open: (path) => (opened.push(path), nodeSessionHistoryFs.open(path)) } }
}

describe("session-history recentSessions completed transcripts", () => {
  it("#given an unchanged completed transcript #when listed #then it is AlreadyImported, skipped by the read pass, and outside the read bound", async () => {
    // given
    const { claudeHomePath, codexHomePath, workspace, done } = await fixture()
    const completed = { provider: "codex" as const, providerSessionId: "done-session", ...(await identityOf(done)) }
    const baseline = countingOpens()
    await collect(makeTestScanner({ claudeHomePath, codexHomePath, fs: baseline.fs, now: () => nowMs }).recentSessions({ workspaceRoot: workspace }))
    const { fs, opened } = countingOpens()
    const run = makeTestScanner({ claudeHomePath, codexHomePath, fs, now: () => nowMs }).recentSessions({ workspaceRoot: workspace, completed: [completed] })

    // when
    const outcomes = await collect(run)
    const opensOf = (paths: Array<string>, path: string) => paths.filter((entry) => entry === path).length

    // then
    expect(outcomes.map((outcome) => outcome._tag)).toEqual(["AlreadyImported", "Importable"])
    expect(outcomes[0]).toEqual({ _tag: "AlreadyImported", source: { ...completed, homePath: codexHomePath } })
    expect(opensOf(opened, done)).toBe(opensOf(baseline.opened, done) - 1)
    expect(run.counts()).toEqual({ found: 2, read: 1, cap: 100 })
  })

  it("#given a completed transcript that changed since import #when listed #then it is read again as Importable", async () => {
    // given
    const { claudeHomePath, codexHomePath, workspace, done } = await fixture()
    const completed = { provider: "codex" as const, providerSessionId: "done-session", ...(await identityOf(done)), size: 1 }

    // when
    const outcomes = await collect(makeTestScanner({ claudeHomePath, codexHomePath, now: () => nowMs }).recentSessions({ workspaceRoot: workspace, completed: [completed] }))

    // then
    expect(outcomes.map((outcome) => outcome._tag)).toEqual(["Importable", "Importable"])
  })

  it("#given a completed transcript named for another provider #when listed #then it is not matched", async () => {
    // given
    const { claudeHomePath, codexHomePath, workspace, done } = await fixture()
    const completed = { provider: "claudeAgent" as const, providerSessionId: "done-session", ...(await identityOf(done)) }

    // when
    const outcomes = await collect(makeTestScanner({ claudeHomePath, codexHomePath, now: () => nowMs }).recentSessions({ workspaceRoot: workspace, completed: [completed] }))

    // then
    expect(outcomes.map((outcome) => outcome._tag)).toEqual(["Importable", "Importable"])
  })

  it("#given a copy of an already-imported session #when listed #then the copy is a Duplicate of it", async () => {
    // given
    const { claudeHomePath, codexHomePath, workspace, done } = await fixture()
    const copy = rolloutPath(codexHomePath, "rollout-copy.jsonl")
    await writeTranscript({ filePath: copy, contents: codexSession("done-session", workspace, "Already imported"), mtimeMs: nowMs - 3_000 })
    const completed = { provider: "codex" as const, providerSessionId: "done-session", ...(await identityOf(done)) }

    // when
    const outcomes = await collect(makeTestScanner({ claudeHomePath, codexHomePath, now: () => nowMs }).recentSessions({ workspaceRoot: workspace, completed: [completed] }))

    // then
    expect(outcomes.map((outcome) => outcome._tag)).toEqual(["AlreadyImported", "Importable", "Duplicate"])
  })

  it("#given an importable transcript #when listed #then its source carries device, inode and birthtime", async () => {
    // given
    const { claudeHomePath, codexHomePath, workspace, fresh } = await fixture()
    const stats = await stat(fresh)

    // when
    const outcomes = await collect(makeTestScanner({ claudeHomePath, codexHomePath, now: () => nowMs }).recentSessions({ workspaceRoot: workspace }))
    const importable = outcomes.find((outcome) => outcome._tag === "Importable" && outcome.source.filePath === fresh)

    // then
    expect(importable?._tag === "Importable" ? importable.source : null).toEqual({
      provider: "codex",
      homePath: codexHomePath,
      providerSessionId: "fresh-session",
      ...(await identityOf(fresh)),
    })
    expect(stats.dev).toBeGreaterThanOrEqual(0)
  })
})
