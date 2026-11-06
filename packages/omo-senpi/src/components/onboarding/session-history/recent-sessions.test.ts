import { mkdir, rm, symlink } from "node:fs/promises"
import { basename, dirname, join } from "node:path"
import { afterEach, describe, expect, it } from "bun:test"

import { nodeSessionHistoryFs } from "./session-history-fs"
import { collect, createTempDirectories, encodeRecord, makeRecordLimitTranscript, makeTestScanner, writeTranscript } from "./test-support"

const temp = createTempDirectories()
afterEach(() => temp.cleanup())

const nowMs = Date.parse("2026-08-24T12:00:00.000Z")
const DAY_MS = 24 * 60 * 60 * 1000
const codexSession = (id: string, cwd: string, prompt: string) =>
  [encodeRecord({ type: "session_meta", payload: { id, cwd } }), encodeRecord({ type: "event_msg", payload: { type: "user_message", message: prompt } })].join("\n")
const rolloutPath = (codexHomePath: string, name: string) => join(codexHomePath, "sessions", "2026", "08", "24", name)

async function homes() {
  return { claudeHomePath: await temp.make("claude-home-"), codexHomePath: await temp.make("codex-home-") }
}

describe("session-history recentSessions (parity with desktop AgentSessionScanner.recentThreads)", () => {
  for (const overflow of [false, true]) {
    it(`#given a record-limit transcript with overflow=${overflow} #when listed #then counts terminal newlines correctly`, async () => {
      // given
      const { claudeHomePath, codexHomePath } = await homes()
      const workspace = await temp.make("record-limit-project-")
      await writeTranscript({ filePath: rolloutPath(codexHomePath, "rollout-records.jsonl"), contents: makeRecordLimitTranscript(workspace, overflow), mtimeMs: nowMs })
      await writeTranscript({ filePath: rolloutPath(codexHomePath, "rollout-older.jsonl"), contents: codexSession("older-session", workspace, "Older prompt"), mtimeMs: nowMs - 1_000 })

      // when
      const outcomes = await collect(makeTestScanner({ claudeHomePath, codexHomePath, now: () => nowMs }).recentSessions({ workspaceRoot: workspace }))

      // then
      expect(outcomes.map((outcome) => outcome._tag)).toEqual(overflow ? ["Skipped", "Importable"] : ["Importable", "Skipped"])
      expect(outcomes.flatMap((outcome) => outcome._tag === "Importable" ? outcome.thread.messages.map((message) => message.text) : [])).toEqual([overflow ? "Older prompt" : "First prompt"])
    })
  }

  it("#given Claude and Codex sessions #when listed for one project #then returns recent sessions of that project only", async () => {
    // given
    const { claudeHomePath, codexHomePath } = await homes()
    const workspace = await temp.make("workspace-")
    const otherWorkspace = await temp.make("workspace-other-")
    const claudeTranscript = (cwd: string, sessionId: string) => [
      JSON.stringify({ type: "user", cwd, sessionId, timestamp: "2026-08-23T12:00:00.000Z", message: { role: "user", content: "Fix the project" } }),
      JSON.stringify({ type: "assistant", sessionId, timestamp: "2026-08-23T12:01:00.000Z", message: { role: "assistant", content: [{ type: "text", text: "Done" }] } }),
    ].join("\n")
    await writeTranscript({ filePath: join(claudeHomePath, "projects", "-selected", "claude-recent.jsonl"), contents: claudeTranscript(workspace, "claude-recent"), mtimeMs: nowMs - DAY_MS })
    await writeTranscript({ filePath: join(claudeHomePath, "projects", "-selected", "claude-old.jsonl"), contents: claudeTranscript(workspace, "claude-old"), mtimeMs: nowMs - 31 * DAY_MS })
    await writeTranscript({ filePath: join(claudeHomePath, "projects", "-other", "claude-other.jsonl"), contents: claudeTranscript(otherWorkspace, "claude-other"), mtimeMs: nowMs - DAY_MS })
    await writeTranscript({ filePath: rolloutPath(codexHomePath, "rollout-codex-recent.jsonl"), contents: [
      encodeRecord({ type: "session_meta", payload: { id: "codex-recent", cwd: workspace } }),
      encodeRecord({ type: "event_msg", timestamp: "2026-08-24T10:00:00.000Z", payload: { type: "user_message", message: "Review this code" } }),
      encodeRecord({ type: "response_item", timestamp: "2026-08-24T10:01:00.000Z", payload: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Looks good" }] } }),
    ].join("\n"), mtimeMs: nowMs - 60 * 60 * 1000 })

    // when
    const outcomes = await collect(makeTestScanner({ claudeHomePath, codexHomePath, now: () => nowMs }).recentSessions({ workspaceRoot: workspace }))
    const threads = outcomes.flatMap((outcome) => outcome._tag === "Importable" ? [outcome.thread] : [])

    // then
    expect(threads.map((thread) => thread.providerSessionId)).toEqual(["codex-recent", "claude-recent"])
    expect(threads.map((thread) => thread.messages.map((message) => message.text))).toEqual([["Review this code", "Looks good"], ["Fix the project", "Done"]])
  })

  it("#given a 31-day-old session #when the recent window is widened to 90 days #then includes it", async () => {
    // given
    const { claudeHomePath, codexHomePath } = await homes()
    const workspace = await temp.make("workspace-")
    await writeTranscript({ filePath: rolloutPath(codexHomePath, "rollout-old.jsonl"), contents: codexSession("old-session", workspace, "Old prompt"), mtimeMs: nowMs - 31 * DAY_MS })
    const scanner = makeTestScanner({ claudeHomePath, codexHomePath, now: () => nowMs })

    // when
    const defaultWindow = await collect(scanner.recentSessions({ workspaceRoot: workspace }))
    const widened = await collect(scanner.recentSessions({ workspaceRoot: workspace, recentWindowMs: 90 * DAY_MS }))

    // then
    expect(defaultWindow).toEqual([])
    expect(widened.map((outcome) => outcome._tag)).toEqual(["Importable"])
  })

  it("#given history recorded with a case alias #when listed #then imports it", async () => {
    // given
    const { claudeHomePath, codexHomePath } = await homes()
    const workspace = await temp.make("workspace-")
    const workspaceAlias = join(dirname(workspace), basename(workspace).toUpperCase())
    await writeTranscript({ filePath: join(claudeHomePath, "projects", "-alias", "case-session.jsonl"), contents: [
      encodeRecord({ type: "user", cwd: workspaceAlias, sessionId: "case-session", timestamp: "2026-08-24T10:00:00.000Z", message: { role: "user", content: "Import case alias history" } }),
      encodeRecord({ type: "assistant", sessionId: "case-session", timestamp: "2026-08-24T10:01:00.000Z", message: { role: "assistant", content: "Imported" } }),
    ].join("\n"), mtimeMs: nowMs })
    const fs = { ...nodeSessionHistoryFs, stat: (filePath: string) => nodeSessionHistoryFs.stat(filePath === workspaceAlias ? workspace : filePath) }

    // when
    const outcomes = await collect(makeTestScanner({ claudeHomePath, codexHomePath, fs, now: () => nowMs }).recentSessions({ workspaceRoot: workspace }))

    // then
    expect(outcomes.flatMap((outcome) => outcome._tag === "Importable" ? [outcome.thread.providerSessionId] : [])).toEqual(["case-session"])
  })

  it("#given two copies of one session #when listed #then reports the second as a duplicate", async () => {
    // given
    const { claudeHomePath, codexHomePath } = await homes()
    const workspace = await temp.make("workspace-")
    for (const [name, mtimeMs] of [["rollout-copy-a.jsonl", nowMs], ["rollout-copy-b.jsonl", nowMs - 1]] as const) {
      await writeTranscript({ filePath: rolloutPath(codexHomePath, name), contents: codexSession("copied-session", workspace, "Import this session once"), mtimeMs })
    }

    // when
    const outcomes = await collect(makeTestScanner({ claudeHomePath, codexHomePath, now: () => nowMs }).recentSessions({ workspaceRoot: workspace }))

    // then
    expect(outcomes.map((outcome) => outcome._tag)).toEqual(["Importable", "Duplicate"])
    expect(outcomes[0]).toMatchObject({ _tag: "Importable", thread: { providerSessionId: "copied-session" } })
  })

  it("#given a transcript dated after now #when listed #then does not import it", async () => {
    // given
    const { claudeHomePath, codexHomePath } = await homes()
    const workspace = await temp.make("workspace-")
    await writeTranscript({ filePath: rolloutPath(codexHomePath, "rollout-future.jsonl"), contents: codexSession("future-session", workspace, "Future work"), mtimeMs: nowMs + 1_000 })

    // when / then
    expect(await collect(makeTestScanner({ claudeHomePath, codexHomePath, now: () => nowMs }).recentSessions({ workspaceRoot: workspace }))).toEqual([])
  })

  for (const source of ["claudeAgent", "codex"] as const) {
    for (const replacement of ["same root", "other root", "symlink alias", "other then same"] as const) {
      it(`#given a ${source} transcript replaced with ${replacement} #when listed #then rechecks the snapshot cwd`, async () => {
        // given
        const fixture = await temp.make("replaced-cwd-")
        const workspace = join(fixture, "original")
        const otherWorkspace = join(fixture, "other")
        const alias = join(fixture, "alias")
        const claudeHomePath = join(fixture, "claude")
        const codexHomePath = join(fixture, "codex")
        await mkdir(workspace)
        await mkdir(otherWorkspace)
        if (replacement === "symlink alias") await symlink(workspace, alias)
        const filePath = source === "codex" ? rolloutPath(codexHomePath, "rollout-replaced.jsonl") : join(claudeHomePath, "projects", "p", "replaced.jsonl")
        const makeContents = (cwd: string, text: string, laterCwd?: string) => [
          ...(source === "codex"
            ? [{ type: "session_meta", payload: { id: "replacement-session", cwd } }, { type: "event_msg", payload: { type: "user_message", message: text } }]
            : [{ type: "user", cwd, sessionId: "replacement-session", message: { content: text } }]),
          ...(laterCwd === undefined ? [] : [{ cwd: laterCwd }]),
        ].map((record) => encodeRecord(record)).join("\n")
        await writeTranscript({ filePath, contents: makeContents(workspace, "Original prompt"), mtimeMs: nowMs })
        const scanner = makeTestScanner({ claudeHomePath, codexHomePath, now: () => nowMs })
        expect((await scanner.scanProjects()).candidates.map((candidate) => candidate.path)).toEqual([workspace])
        const replacementCwd = replacement === "symlink alias" ? alias : replacement === "same root" ? workspace : otherWorkspace
        await rm(filePath)
        await writeTranscript({ filePath, contents: makeContents(replacementCwd, "Replacement prompt", replacement === "other then same" ? workspace : undefined), mtimeMs: nowMs })

        // when
        const outcomes = await collect(scanner.recentSessions({ workspaceRoot: workspace }))

        // then
        if (replacement === "same root" || replacement === "symlink alias") {
          expect(outcomes).toHaveLength(1)
          expect(outcomes[0]).toMatchObject({ _tag: "Importable", thread: { messages: [{ text: "Replacement prompt" }] } })
        } else {
          expect(outcomes).toEqual([{ _tag: "Skipped" }])
        }
      })
    }
  }
})
