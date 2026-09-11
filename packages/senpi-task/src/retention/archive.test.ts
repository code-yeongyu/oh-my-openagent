import { describe, expect, test } from "bun:test"

import type { OmoTaskTranscriptRetention } from "@oh-my-opencode/omo-config-core"

import { isSpawnSpecV1, type SpawnSpecV1, type TaskRecord } from "../state"
import {
  TASK_ARCHIVE_CONTENT_CUSTOM_TYPE,
  TASK_ARCHIVE_CUSTOM_TYPE,
  composeTaskArchiveContentJsonl,
  composeTaskArchiveManifestJsonl,
  parseArchiveLines,
} from "./archive"

function retentionSettings(overrides: Record<string, unknown> = {}): OmoTaskTranscriptRetention {
  return {
    enabled: true,
    categories: ["deep"],
    ttl_ms: 604800000,
    max_bytes: 262144,
    success_sample_denominator: 4,
    metadata_only_paths: [],
    ...overrides,
  } as OmoTaskTranscriptRetention
}

const SPAWN_SPEC: SpawnSpecV1 = {
  version: 1,
  cwd: "/repo/checkout",
  prompt: "Summarize the retention design",
}

function record(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    task_id: "st_00000004",
    name: "deep-dive",
    task_summary: "Deep design summary",
    parent_session_id: "ses-parent",
    root_session_id: "ses-root",
    depth: 1,
    execution_mode: "in-process",
    model: "openai/gpt-6-astra",
    category: "deep",
    requested_model: { provider: "openai", model_id: "gpt-6-astra", display: "GPT-6 Astra", source: "category" },
    resolved_model: { provider: "openai", model_id: "gpt-6-astra", display: "GPT-6 Astra", source: "category", reasoning: "high" },
    status: "completed",
    residency_state: "persisted_only",
    created_at: "2026-09-10T00:00:00.000Z",
    started_at: "2026-09-10T00:00:01.000Z",
    updated_at: "2026-09-10T00:10:00.000Z",
    terminal_at: "2026-09-10T00:10:00.000Z",
    final_response: "Final answer text",
    notify_on_terminal: false,
    notification: { run_epoch: 1, notified_epoch: 1 },
    spawn_spec: SPAWN_SPEC,
    owner: { kind: "dag", runId: "dag-run-1", nodeId: "node-a", fingerprint: "fp" },
    run_stats: { runtime_ms: 1000, turns: 2, tool_calls: 1, total_tokens: 500 },
    retain_transcript: true,
    ...overrides,
  } as TaskRecord
}

function events() {
  return [
    { type: "assistant_message", payload: { text: "Working on it." } },
    { type: "tool_execution", payload: { tool: "read", is_error: false } },
    { type: "tool_execution", payload: { tool: "bash", is_error: true } },
    { type: "assistant_message", payload: { text: "Final answer text" } },
    { type: "child_error", payload: { message: "turn failed", stop_reason: "error" } },
  ] as const
}

function input(overrides: Partial<Parameters<typeof composeTaskArchiveContentJsonl>[0]> = {}) {
  return {
    record: record(),
    events: [...events()],
    settings: retentionSettings(),
    archiveId: "0f1e2d3c-4b5a-4678-8901-2b3c4d5e6f70",
    archivedAt: "2026-09-11T00:00:00.000Z",
    selection: { reason: "explicit" as const, mode: "full" as const, sample_retained: true, protected_by_path: false },
    ...overrides,
  }
}

const FACTS = {
  file: "2026-09-10T00-10-00-000Z_st_00000004.jsonl.gz",
  sha256: "a".repeat(64),
  compressed_bytes: 512,
  uncompressed_bytes: 4096,
  transcript_truncated: false,
}

describe("composeTaskArchiveContentJsonl", () => {
  test("#given a record and visible events #when composing #then line one is a senpi session header carrying the task cwd", () => {
    const lines = parseArchiveLines(composeTaskArchiveContentJsonl(input()).text)
    expect(lines[0]).toEqual({
      type: "session",
      version: 3,
      id: "0f1e2d3c-4b5a-4678-8901-2b3c4d5e6f70",
      timestamp: "2026-09-10T00:00:00.000Z",
      cwd: "/repo/checkout",
    })
  })

  test("#given a named task #when composing #then a session_info entry carries a finder-visible name", () => {
    const lines = parseArchiveLines(composeTaskArchiveContentJsonl(input()).text)
    const info = lines.find((line) => line.type === "session_info")
    expect(info?.name).toBe("omo task deep-dive (completed)")
  })

  test("#given a record #when composing #then the metadata entry carries parent linkage, models, outcome, usage, and dag owner", () => {
    const meta = parseArchiveLines(composeTaskArchiveContentJsonl(input()).text).find(
      (line) => line.type === "custom" && line.customType === TASK_ARCHIVE_CUSTOM_TYPE,
    )
    expect(meta?.data).toMatchObject({
      schema_version: 2,
      task_id: "st_00000004",
      parent_session_id: "ses-parent",
      root_session_id: "ses-root",
      category: "deep",
      model: "openai/gpt-6-astra",
      requested_model: { provider: "openai", model_id: "gpt-6-astra" },
      resolved_model: { provider: "openai", model_id: "gpt-6-astra", reasoning: "high" },
      cwd: "/repo/checkout",
      started_at: "2026-09-10T00:00:01.000Z",
      terminal_at: "2026-09-10T00:10:00.000Z",
      status: "completed",
      final_response: "Final answer text",
      run_stats: { runtime_ms: 1000, turns: 2, tool_calls: 1, total_tokens: 500 },
      tool_call_count: 2,
      tool_error_count: 1,
      dag_run_id: "dag-run-1",
      dag_node_id: "node-a",
      retained_because: "explicit",
      content_retention: "full",
      redaction: "builtin-v1",
      transcript_event_count: 5,
      transcript_truncated: false,
      archived_at: "2026-09-11T00:00:00.000Z",
    })
    expect(meta?.data).not.toHaveProperty("protected_by_path")
  })

  test("#given a protected downgrade selection #when composing #then the metadata reports metadata-only and the protecting path rule", () => {
    const meta = parseArchiveLines(composeTaskArchiveContentJsonl(input({
      selection: { reason: "category", mode: "metadata", sample_retained: true, protected_by_path: true },
    })).text).find((line) => line.customType === TASK_ARCHIVE_CUSTOM_TYPE)
    expect(meta?.data).toMatchObject({ content_retention: "metadata-only", protected_by_path: true })
  })

  test("#given a spawn prompt and visible events #when composing #then the archive holds the prompt plus every event and nothing else", () => {
    const lines = parseArchiveLines(composeTaskArchiveContentJsonl(input()).text)
    const messages = lines.filter((line) => line.type === "message")
    expect(messages).toHaveLength(3)
    expect(messages[0]?.message).toEqual({
      role: "user",
      content: [{ type: "text", text: "Summarize the retention design" }],
    })
    expect(messages[1]?.message?.role).toBe("assistant")
    expect(messages[1]?.message?.content).toEqual([{ type: "text", text: "Working on it." }])
    expect(messages[2]?.message?.content).toEqual([{ type: "text", text: "Final answer text" }])

    const toolEntries = lines.filter((line) => line.customType === "omo-senpi.task-tool")
    expect(toolEntries).toHaveLength(2)
    expect(toolEntries[1]?.data).toEqual({ tool: "bash", is_error: true })

    const errorEntries = lines.filter((line) => line.customType === "omo-senpi.task-error")
    expect(errorEntries).toHaveLength(1)
    expect(errorEntries[0]?.data).toEqual({ message: "turn failed", stop_reason: "error" })

    // Exactly header + session_info + metadata + (prompt + events). No hidden or synthetic turns.
    expect(lines).toHaveLength(3 + 1 + 5)
  })

  test("#given a legacy spawn spec without a v1 prompt #when composing #then no user message is synthesized", () => {
    const text = composeTaskArchiveContentJsonl(input({ record: record({ spawn_spec: { cwd: "/repo" } }) })).text
    const messages = parseArchiveLines(text).filter((line) => line.type === "message")
    expect(messages).toHaveLength(2)
  })

  test("#given a record without a dag owner #when composing #then no dag fields appear", () => {
    const meta = parseArchiveLines(composeTaskArchiveContentJsonl(input({ record: record({ owner: undefined }) })).text).find(
      (line) => line.customType === TASK_ARCHIVE_CUSTOM_TYPE,
    )
    expect(meta?.data).not.toHaveProperty("dag_run_id")
    expect(meta?.data).not.toHaveProperty("dag_node_id")
  })

  test("#given events exceeding max_bytes #when composing #then head and tail entries are kept and truncation is reported", () => {
    const bigEvents = Array.from({ length: 40 }, (_, index) => ({
      type: "assistant_message",
      payload: { text: `event-${String(index).padStart(2, "0")} ${"x".repeat(400)}` },
    }))
    const composed = composeTaskArchiveContentJsonl(input({
      events: bigEvents,
      settings: retentionSettings({ max_bytes: 4096 }),
      selection: { reason: "category", mode: "full", sample_retained: true, protected_by_path: false },
    }))
    expect(composed.truncated).toBe(true)
    const lines = parseArchiveLines(composed.text)
    const meta = lines.find((line) => line.customType === TASK_ARCHIVE_CUSTOM_TYPE)
    expect(meta?.data?.transcript_truncated).toBe(true)
    const messages = lines.filter((line) => line.type === "message")
    expect(messages.length).toBeGreaterThan(2)
    expect(messages.length).toBeLessThan(40)
    expect(messages[0]?.message?.content?.[0]?.text).toBe("Summarize the retention design")
    expect(messages[1]?.message?.content?.[0]?.text?.startsWith("event-00")).toBe(true)
    expect(messages.at(-1)?.message?.content?.[0]?.text?.startsWith("event-39")).toBe(true)
    expect(meta?.data?.retained_because).toBe("category")
  })
})

describe("composeTaskArchiveManifestJsonl", () => {
  test("#given a full selection #when composing the manifest #then it holds the metadata and a pointer to the compressed sidecar and no transcript", () => {
    const text = composeTaskArchiveManifestJsonl(input(), FACTS)
    const lines = parseArchiveLines(text)
    expect(lines).toHaveLength(4)
    expect(lines[0]?.type).toBe("session")
    expect(lines[0]?.cwd).toBe("/repo/checkout")
    const meta = lines.find((line) => line.customType === TASK_ARCHIVE_CUSTOM_TYPE)
    expect(meta?.data).toMatchObject({
      task_id: "st_00000004",
      content_retention: "full",
      transcript_truncated: false,
      // identical truncation fact as the content file carries
    })
    const pointer = lines.find((line) => line.customType === TASK_ARCHIVE_CONTENT_CUSTOM_TYPE)
    expect(pointer?.data).toEqual(FACTS)
    expect(lines.some((line) => line.type === "message")).toBe(false)
  })

  test("#given a truncated content #when composing the manifest #then the pointer reports the truncation so audits need not decompress", () => {
    const text = composeTaskArchiveManifestJsonl(input(), { ...FACTS, transcript_truncated: true })
    const pointer = parseArchiveLines(text).find((line) => line.customType === TASK_ARCHIVE_CONTENT_CUSTOM_TYPE)
    expect(pointer?.data?.transcript_truncated).toBe(true)
  })

  test("#given a metadata-only selection #when composing the manifest #then it is the whole artifact with no pointer entry and no free-text content fields", () => {
    const text = composeTaskArchiveManifestJsonl(
      input({ selection: { reason: "explicit", mode: "metadata", sample_retained: true, protected_by_path: false } }),
      undefined,
    )
    const lines = parseArchiveLines(text)
    expect(lines).toHaveLength(3)
    expect(lines.find((line) => line.customType === TASK_ARCHIVE_CONTENT_CUSTOM_TYPE)).toBeUndefined()
    const meta = lines.find((line) => line.customType === TASK_ARCHIVE_CUSTOM_TYPE)
    expect(meta?.data).toMatchObject({
      content_retention: "metadata-only",
      transcript_event_count: 5,
      transcript_truncated: false,
      status: "completed",
      task_id: "st_00000004",
      parent_session_id: "ses-parent",
      resolved_model: { model_id: "gpt-6-astra" },
      run_stats: { runtime_ms: 1000 },
    })
    // Free-text content fields never ride along on a metadata-only archive: they can echo the
    // protected content the mode exists to withhold.
    expect(meta?.data).not.toHaveProperty("final_response")
    expect(meta?.data).not.toHaveProperty("task_summary")
    expect(meta?.data).not.toHaveProperty("description")
    expect(meta?.data).not.toHaveProperty("error_message")
    expect(text).not.toContain("Final answer text")
    expect(text).not.toContain("Summarize the retention design")
  })

  test("#given the same task and facts #when composing twice #then the manifest bytes are identical (deterministic archive)", () => {
    expect(composeTaskArchiveManifestJsonl(input(), FACTS)).toBe(composeTaskArchiveManifestJsonl(input(), FACTS))
  })
})

describe("archive redaction", () => {
  test("#given secret-shaped credentials in visible text #when composing #then every carried surface is redacted", () => {
    const secret = "sk-ant-api03-abcdef0123456789abcdef0123456789abcdef01"
    const composed = composeTaskArchiveContentJsonl(input({
      record: record({
        spawn_spec: { version: 1, cwd: "/repo", prompt: `run with key ${secret}` },
        final_response: `done, token was ${secret}`,
        error_message: `failed after auth with ${secret}`,
      }),
      events: [
        { type: "assistant_message", payload: { text: `echo ${secret}` } },
        { type: "tool_execution", payload: { tool: "bash", output: `export KEY=${secret}`, is_error: false } },
      ],
    }))
    expect(composed.text).not.toContain(secret)
    expect(composed.text).toContain("[REDACTED]")
    const lines = parseArchiveLines(composed.text)
    expect(lines.some((line) => line.message?.content?.[0]?.text === "run with key [REDACTED]")).toBe(true)
    expect(lines.some((line) => line.message?.content?.[0]?.text === "echo [REDACTED]")).toBe(true)
    const meta = lines.find((line) => line.customType === TASK_ARCHIVE_CUSTOM_TYPE)
    expect(meta?.data?.final_response).toBe("done, token was [REDACTED]")
    expect(meta?.data?.error_message).toBe("failed after auth with [REDACTED]")
    const tool = lines.find((line) => line.customType === "omo-senpi.task-tool")
    expect(tool?.data).toEqual({ tool: "bash", output: "export KEY=[REDACTED]", is_error: false })
  })

  test("#given a private key block and a bearer header #when composing #then blocks are replaced whole", () => {
    const pem = "-----BEGIN OPENSSH PRIVATE KEY-----\nAAAAB3NzaC1yc2EAAAADAQAB\n-----END OPENSSH PRIVATE KEY-----"
    const composed = composeTaskArchiveContentJsonl(input({
      events: [{ type: "assistant_message", payload: { text: `creds: ${pem} and Bearer abcdef0123456789abcdef0` } }],
    }))
    expect(composed.text).not.toContain("AAAAB3NzaC1yc2E")
    expect(composed.text).not.toContain("Bearer abcdef")
    expect(composed.text).toContain("[REDACTED]")
  })

  test("#given ordinary prose that resembles no credential shape #when composing #then text passes through unchanged", () => {
    const composed = composeTaskArchiveContentJsonl(input())
    expect(composed.text).toContain("Summarize the retention design")
    expect(composed.text).toContain("Working on it.")
  })

  test("#given a spawn spec #when composing #then the cwd helper round-trips through the record", () => {
    expect(isSpawnSpecV1(SPAWN_SPEC)).toBe(true)
  })
})
