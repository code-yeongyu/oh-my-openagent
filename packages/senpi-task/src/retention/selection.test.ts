import { describe, expect, test } from "bun:test"

import type { OmoTaskTranscriptRetention } from "@oh-my-opencode/omo-config-core"

import type { TaskRecord, TaskStatus } from "../state"
import { selectForTranscriptRetention } from "./selection"

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

function record(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    task_id: "st_00000001",
    name: "st_00000001",
    parent_session_id: "parent-1",
    root_session_id: "parent-1",
    depth: 1,
    execution_mode: "in-process",
    model: "openai/gpt-6-astra",
    status: "completed",
    residency_state: "persisted_only",
    created_at: "2026-09-10T00:00:00.000Z",
    updated_at: "2026-09-10T00:10:00.000Z",
    terminal_at: "2026-09-10T00:10:00.000Z",
    notify_on_terminal: false,
    notification: { run_epoch: 1, notified_epoch: 1 },
    ...overrides,
  } as TaskRecord
}

describe("selectForTranscriptRetention", () => {
  test("#given retention is disabled #when selecting #then nothing is selected", () => {
    expect(selectForTranscriptRetention(undefined, record())).toBeUndefined()
    expect(selectForTranscriptRetention(retentionSettings({ enabled: false }), record())).toBeUndefined()
  })

  test("#given an explicit retain_transcript false #when selecting #then the task is never selected", () => {
    const selected = selectForTranscriptRetention(retentionSettings(), record({ retain_transcript: false, category: "deep" }))
    expect(selected).toBeUndefined()
  })

  test("#given an explicit retain_transcript true #when selecting #then the task is selected as a full explicit archive regardless of category or sample", () => {
    const completed = selectForTranscriptRetention(retentionSettings({ success_sample_denominator: 4 }), record({ retain_transcript: true }))
    expect(completed).toEqual({ reason: "explicit", mode: "full", sample_retained: true, protected_by_path: false })
    const offCategory = selectForTranscriptRetention(retentionSettings(), record({ retain_transcript: true, category: "explore" }))
    expect(offCategory?.mode).toBe("full")
  })

  test("#given an explicit retain_transcript metadata #when selecting #then the task is selected as a metadata-only explicit archive", () => {
    const selected = selectForTranscriptRetention(retentionSettings(), record({ retain_transcript: "metadata", category: "explore" }))
    expect(selected).toEqual({ reason: "explicit", mode: "metadata", sample_retained: true, protected_by_path: false })
  })

  test("#given a listed-category task #when selecting #then it is selected by the category rule", () => {
    // A failed-class run is always retained, so this pins the category rule without coupling to
    // the success-sample hash bucket of any particular task id.
    const selected = selectForTranscriptRetention(retentionSettings(), record({ category: "deep", status: "error" }))
    expect(selected).toEqual({ reason: "category", mode: "full", sample_retained: true, protected_by_path: false })
  })

  test("#given an unlisted-category task without an explicit mark #when selecting #then it is not selected", () => {
    expect(selectForTranscriptRetention(retentionSettings(), record({ category: "explore", status: "error" }))).toBeUndefined()
    expect(selectForTranscriptRetention(retentionSettings(), record({ status: "error" }))).toBeUndefined()
  })

  test("#given a failed-class selected run #when selecting #then it is always retained regardless of the success sample", () => {
    for (const status of ["error", "cancelled", "interrupted", "lost"] as const satisfies readonly TaskStatus[]) {
      const selected = selectForTranscriptRetention(
        retentionSettings({ success_sample_denominator: 4 }),
        record({ category: "deep", status }),
      )
      expect(selected?.sample_retained).toBe(true)
    }
  })

  test("#given a completed selected run #when the deterministic sample misses #then it is not retained and a hit retains it", () => {
    const settings = retentionSettings({ success_sample_denominator: 4 })
    const retained: string[] = []
    const dropped: string[] = []
    for (let index = 1; index <= 64; index += 1) {
      const taskId = `st_${String(index).padStart(8, "0")}`
      const decision = selectForTranscriptRetention(settings, record({ task_id: taskId, category: "deep" }))
      if (decision === undefined) dropped.push(taskId)
      else retained.push(taskId)
    }
    // Deterministic hash bucketing keeps roughly one in `denominator` successful runs and never
    // depends on process state, so the same id always lands in the same bucket.
    expect(retained.length).toBeGreaterThan(0)
    expect(retained.length).toBeLessThan(64)
    for (const taskId of retained) {
      expect(selectForTranscriptRetention(settings, record({ task_id: taskId, category: "deep" }))?.sample_retained).toBe(true)
    }
    for (const taskId of dropped) {
      expect(selectForTranscriptRetention(settings, record({ task_id: taskId, category: "deep" }))).toBeUndefined()
    }
  })

  test("#given success_sample_denominator 1 #when selecting a completed run #then every successful selected run is retained", () => {
    const settings = retentionSettings({ success_sample_denominator: 1 })
    expect(selectForTranscriptRetention(settings, record({ category: "deep" }))?.sample_retained).toBe(true)
  })
})

describe("selectForTranscriptRetention metadata_only_paths", () => {
  test("#given a selected task spawned under a protected root #when selecting #then the category rule downgrades to metadata-only", () => {
    const settings = retentionSettings({ metadata_only_paths: ["/home/dev/clinical-assessment-android"] })
    const selected = selectForTranscriptRetention(settings, record({
      category: "deep",
      status: "error",
      spawn_spec: { version: 1, cwd: "/home/dev/clinical-assessment-android/app/src", prompt: "protected clinical work" },
    }))
    expect(selected).toEqual({ reason: "category", mode: "metadata", sample_retained: true, protected_by_path: true })
  })

  test("#given a protected root equal to the task cwd #when selecting #then it still downgrades (equal counts as inside)", () => {
    const settings = retentionSettings({ metadata_only_paths: ["/clinic"] })
    const selected = selectForTranscriptRetention(settings, record({
      category: "deep",
      status: "error",
      spawn_spec: { version: 1, cwd: "/clinic", prompt: "p" },
    }))
    expect(selected?.mode).toBe("metadata")
    expect(selected?.protected_by_path).toBe(true)
  })

  test("#given a protected root that only shares a string prefix #when selecting #then it does not downgrade", () => {
    const settings = retentionSettings({ metadata_only_paths: ["/clinic"] })
    const selected = selectForTranscriptRetention(settings, record({
      category: "deep",
      status: "error",
      spawn_spec: { version: 1, cwd: "/clinic-other/work", prompt: "p" },
    }))
    expect(selected?.mode).toBe("full")
    expect(selected?.protected_by_path).toBe(false)
  })

  test("#given an explicit full mark under a protected root #when selecting #then the caller's explicit full mark wins over the path rule", () => {
    const settings = retentionSettings({ metadata_only_paths: ["/clinic"] })
    const selected = selectForTranscriptRetention(settings, record({
      retain_transcript: true,
      spawn_spec: { version: 1, cwd: "/clinic", prompt: "p" },
    }))
    expect(selected?.mode).toBe("full")
    expect(selected?.protected_by_path).toBe(false)
  })

  test("#given an unselected task under a protected root #when selecting #then the path rule never promotes retention", () => {
    const settings = retentionSettings({ metadata_only_paths: ["/clinic"] })
    expect(selectForTranscriptRetention(settings, record({ category: "explore" }))).toBeUndefined()
  })

  test("#given blank metadata_only_paths entries #when selecting #then they are ignored rather than matching every cwd", () => {
    const settings = retentionSettings({ metadata_only_paths: ["   ", ""] })
    const selected = selectForTranscriptRetention(settings, record({
      category: "deep",
      status: "error",
      spawn_spec: { version: 1, cwd: "/anywhere", prompt: "p" },
    }))
    expect(selected?.mode).toBe("full")
  })
})
