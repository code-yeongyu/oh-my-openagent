import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { afterAll, describe, expect, test } from "bun:test"

import { createTaskRecordStore } from "../../store"
import { TRANSCRIPT_ASSISTANT_EVENT, TRANSCRIPT_TOOL_EVENT } from "../../manager/transcript-log"
import { makeRecord } from "./__fixtures__/records"
import { runTaskOutput } from "./output"
import { readEventLogTranscript } from "./transcript/event-log"
import { childSessionDir, readSessionDirTranscript } from "./transcript/session-dir"
import { defaultTranscriptReader } from "./transcript/reader"

const dirs: string[] = []

function tempStateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "senpi-output-"))
  dirs.push(dir)
  return dir
}

afterAll(() => {
  // best-effort cleanup handled by the OS temp reaper; dirs recorded for traceability.
  void dirs
})

describe("readEventLogTranscript", () => {
  test("#given a committed team_message_waited event #when task_output reads the event log #then the recovered body is visible", async () => {
    // given
    const stateDir = tempStateDir()
    const store = createTaskRecordStore({ project_dir: stateDir, task: { state_dir: stateDir } })
    const record = makeRecord({ task_id: "st_000000ef", status: "completed" })
    store.save(record)
    store.appendEvent(record.task_id, {
      type: "team_message_waited",
      payload: { message_id: "message-1", from: "alpha", body: "recovered after lead restart" },
    })
    const manager = {
      get: (taskId: string) => store.load(taskId) ?? undefined,
      list: () => [{ record }],
      waitFor: () => Promise.reject(new Error("waitFor should not be called")),
    }

    // when
    const result = await runTaskOutput(
      { manager, stateDir, waitConfig: { min_ms: 1, default_ms: 5, max_ms: 10 } },
      { task_id: record.task_id, mode: "full", block: false },
      record.parent_session_id,
    )

    // then
    expect(result.details.kind).toBe("transcript")
    if (result.details.kind === "transcript") {
      expect(result.details.transcript).toContain("[team message from alpha] recovered after lead restart")
      expect(result.details.source).toBe("event-log")
    }
  })

  test("#given a store event log with transcript events #when read #then assistant and tool entries are reconstructed in order", () => {
    // given
    const stateDir = tempStateDir()
    const store = createTaskRecordStore({ project_dir: stateDir, task: { state_dir: stateDir } })
    store.appendEvent("st_000000ee", { type: "reconcile_lost", payload: { reason: "noise" } })
    store.appendEvent("st_000000ee", { type: TRANSCRIPT_ASSISTANT_EVENT, payload: { text: "hello world" } })
    store.appendEvent("st_000000ee", { type: TRANSCRIPT_TOOL_EVENT, payload: { tool: "bash", is_error: false } })
    store.appendEvent("st_000000ee", { type: TRANSCRIPT_ASSISTANT_EVENT, payload: { text: "goodbye" } })

    // when
    const entries = readEventLogTranscript(stateDir, "st_000000ee")

    // then
    expect(entries).toEqual([
      { kind: "assistant", text: "hello world" },
      { kind: "tool", tool: "bash", is_error: false },
      { kind: "assistant", text: "goodbye" },
    ])
  })

  test("#given no log file #when read #then an empty list is returned without throwing", () => {
    // given
    const stateDir = tempStateDir()

    // when
    const entries = readEventLogTranscript(stateDir, "st_00m1ss1n")

    // then
    expect(entries).toEqual([])
  })
})

describe("readSessionDirTranscript", () => {
  test("#given a child session jsonl on disk #when read #then assistant text entries are extracted", () => {
    // given
    const stateDir = tempStateDir()
    const sessionDir = childSessionDir(stateDir, "st_0000005e")
    mkdirSync(sessionDir, { recursive: true })
    const jsonl = [
      `{"type":"session","version":3,"id":"s"}`,
      `{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"from session file"}]}}`,
    ].join("\n")
    writeFileSync(join(sessionDir, "2024_abc.jsonl"), jsonl, "utf8")

    // when
    const entries = readSessionDirTranscript(stateDir, "st_0000005e")

    // then
    expect(entries).toEqual([{ kind: "assistant", text: "from session file" }])
  })
})

describe("defaultTranscriptReader", () => {
  test("#given both sources present #when read #then the event log wins and the source is reported", () => {
    // given
    const stateDir = tempStateDir()
    const store = createTaskRecordStore({ project_dir: stateDir, task: { state_dir: stateDir } })
    store.appendEvent("st_000000bb", { type: TRANSCRIPT_ASSISTANT_EVENT, payload: { text: "event log wins" } })
    const sessionDir = childSessionDir(stateDir, "st_000000bb")
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(
      join(sessionDir, "s.jsonl"),
      `{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"session loses"}]}}`,
      "utf8",
    )

    // when
    const result = defaultTranscriptReader({ taskId: "st_000000bb", stateDir })

    // then
    expect(result.source).toBe("event-log")
    expect(result.entries).toEqual([{ kind: "assistant", text: "event log wins" }])
  })

  test("#given only a session dir #when read #then the session jsonl source is used", () => {
    // given
    const stateDir = tempStateDir()
    const sessionDir = childSessionDir(stateDir, "st_0000001a")
    mkdirSync(sessionDir, { recursive: true })
    writeFileSync(
      join(sessionDir, "s.jsonl"),
      `{"type":"message","message":{"role":"assistant","content":[{"type":"text","text":"only session"}]}}`,
      "utf8",
    )

    // when
    const result = defaultTranscriptReader({ taskId: "st_0000001a", stateDir })

    // then
    expect(result.source).toBe("session-jsonl")
    expect(result.entries).toEqual([{ kind: "assistant", text: "only session" }])
  })

  test("#given neither source #when read #then the source is none", () => {
    // given
    const stateDir = tempStateDir()

    // when
    const result = defaultTranscriptReader({ taskId: "st_00000ffe", stateDir })

    // then
    expect(result.source).toBe("none")
    expect(result.entries).toEqual([])
  })
})
