// Wording tests for the memory notice family. Expectations are LITERAL strings: they are the words
// the user reads, so a corrupted helper must not be able to keep them green.
import { describe, expect, test } from "bun:test"

import {
  memoryDegradedNoticeSpec,
  memoryFailureNoticeSpec,
  memoryPendingLine,
  memoryWriteNoticeSpec,
} from "./memory-notice-spec"
import type { MemoryWriteNotice } from "./tools"

const NOW = Date.parse("2026-08-19T12:00:00.000Z")

function notice(over: Partial<MemoryWriteNotice> = {}): MemoryWriteNotice {
  return {
    sha: "a1b2c3d4e5f6a7b8",
    subject: "Track the deploy runbook",
    identity: "project-a1b2c3d4",
    affected: [{ path: "knowledge/deploy.md", insertions: 47, deletions: 0 }],
    size: { systemBytes: 2048, totalBytes: 33_792, fileCount: 12 },
    timeline: {
      entriesToday: 4,
      previousEntryAtISO: "2026-08-19T11:55:00.000Z",
      lastConsolidationAtISO: "2026-08-13T12:00:00.000Z",
      unreflectedSteps: 3,
    },
    ...over,
  }
}

describe("memory write notice wording", () => {
  test("#given a single-file insertion #when specified #then it is an accent remembered entry with dim size and timeline lines", () => {
    expect(memoryWriteNoticeSpec(notice(), NOW, { command: "create", file_path: "knowledge/deploy.md" })).toEqual({
      title: "● Remembered · 4th entry today",
      tone: "accent",
      why: "Added 47 lines to knowledge/deploy.md.",
      extra: [
        { text: "system 2.0K injected · 33K total · 12 files", tone: "dim" },
        { text: "last entry 5m ago · last consolidation 6d ago · 3 steps unreflected", tone: "dim" },
      ],
      expandedLine: "a1b2c3d · project-a1b2c3d4 · Track the deploy runbook",
    })
  })

  test("#given the entry count needs an ordinal #when specified #then English suffixes are correct", () => {
    const titles = [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map((entriesToday) =>
      memoryWriteNoticeSpec(notice({ timeline: { entriesToday } }), NOW).title,
    )
    expect(titles).toEqual([
      "● Remembered · 1st entry today",
      "● Remembered · 2nd entry today",
      "● Remembered · 3rd entry today",
      "● Remembered · 4th entry today",
      "● Remembered · 11th entry today",
      "● Remembered · 12th entry today",
      "● Remembered · 13th entry today",
      "● Remembered · 21st entry today",
      "● Remembered · 22nd entry today",
      "● Remembered · 23rd entry today",
      "● Remembered · 101st entry today",
      "● Remembered · 111th entry today",
    ])
  })

  test("#given the entry count is unavailable #when specified #then the title is a plain remembered line", () => {
    expect(memoryWriteNoticeSpec(notice({ timeline: {} }), NOW).title).toBe("● Remembered")
  })

  test.each([
    ["a single added line", [{ path: "knowledge/deploy.md", insertions: 1, deletions: 0 }], "Added 1 line to knowledge/deploy.md."],
    ["an in-place edit", [{ path: "knowledge/deploy.md", insertions: 12, deletions: 4 }], "Updated 1 memory file (knowledge/deploy.md)."],
    [
      "several files",
      [{ path: "knowledge/deploy.md", insertions: 12, deletions: 4 }, { path: "system/persona.md", insertions: 3, deletions: 0 }],
      "Updated 2 memory files (knowledge/deploy.md, system/persona.md).",
    ],
  ] as const)("#given %s #when specified #then the why sentence names it", (_label, affected, why) => {
    expect(memoryWriteNoticeSpec(notice({ affected }), NOW).why).toBe(why)
  })

  test("#given a deletion #when specified #then it reads as a relieved let-go naming the cleared lines", () => {
    const spec = memoryWriteNoticeSpec(
      notice({ affected: [{ path: "reference/old.md", insertions: 0, deletions: 22 }] }),
      NOW,
      { command: "delete", file_path: "reference/old.md" },
    )
    expect(spec.title).toBe("● Let go · 4th entry today")
    expect(spec.tone).toBe("accent")
    expect(spec.why).toBe("Cleared reference/old.md (22 lines). One less thing to carry.")
  })

  test("#given a rename #when specified #then it reads as a move between the two paths", () => {
    const spec = memoryWriteNoticeSpec(
      notice({ affected: [{ path: "reference/new.md", insertions: 0, deletions: 0 }] }),
      NOW,
      { command: "rename", old_path: "reference/old.md", new_path: "reference/new.md" },
    )
    expect(spec.title).toBe("● Remembered · 4th entry today")
    expect(spec.why).toBe("Moved reference/old.md to reference/new.md.")
  })

  test("#given the size crosses the 10K boundary #when specified #then one decimal is used below it and an integer above", () => {
    const small = memoryWriteNoticeSpec(notice({ size: { systemBytes: 2048, totalBytes: 9_932, fileCount: 1 } }), NOW)
    const large = memoryWriteNoticeSpec(notice({ size: { systemBytes: 10_240, totalBytes: 1_048_576, fileCount: 3 } }), NOW)
    expect(small.extra?.[0]?.text).toBe("system 2.0K injected · 9.7K total · 1 file")
    expect(large.extra?.[0]?.text).toBe("system 10K injected · 1024K total · 3 files")
  })

  test.each([
    ["a week-old consolidation", { lastConsolidationAtISO: "2026-08-12T12:00:00.000Z", unreflectedSteps: 3 }, "last consolidation 7d ago · 3 steps unreflected"],
    ["a 25-step backlog", { lastConsolidationAtISO: "2026-08-13T12:00:00.000Z", unreflectedSteps: 25 }, "last consolidation 6d ago · 25 steps unreflected"],
  ] as const)("#given %s #when specified #then the timeline line turns warning toned", (_label, timeline, text) => {
    expect(memoryWriteNoticeSpec(notice({ timeline }), NOW).extra?.at(-1)).toEqual({ text, tone: "warning" })
  })

  test("#given degraded gathering #when a field is missing #then only its own fragment drops", () => {
    const spec = memoryWriteNoticeSpec(notice({ size: undefined, timeline: { entriesToday: 4, unreflectedSteps: 3 } }), NOW)
    expect(spec.extra).toEqual([{ text: "3 steps unreflected", tone: "dim" }])
  })

  test("#given a committed write with no gathered facts #when specified #then it is a statless remembered notice naming the path", () => {
    expect(memoryDegradedNoticeSpec({ command: "str_replace", file_path: "knowledge/deploy.md" })).toEqual({
      title: "● Remembered",
      tone: "accent",
      why: "Saved knowledge/deploy.md.",
      extra: [],
    })
    expect(memoryDegradedNoticeSpec({ command: "delete", file_path: "knowledge/deploy.md" })).toMatchObject({
      title: "● Let go",
      why: "Cleared knowledge/deploy.md. One less thing to carry.",
    })
    expect(memoryDegradedNoticeSpec().why).toBe("Saved a memory change.")
  })
})

describe("memory refusal wording", () => {
  test.each([
    ["memory: create: block already exists at reference/a.md", "reference/a.md already exists."],
    ["memory: rename: destination already exists at reference/b.md", "reference/b.md already exists."],
    ["memory: str_replace: old_string was not found in the target memory block", "The text to replace was not in that memory."],
    ["memory: system/persona.md is read_only and cannot be modified", "system/persona.md is read-only."],
    ["memory: insert made no changes", "Nothing needed to change."],
    ["memory: create: 'file_path' must be a non-empty string", "The request had no file path."],
    ["memory: no memory identity bound to this session yet; the binding is re-established on the next user turn", "Memory is not ready for this session yet."],
    ["memory: writer lock is busy", "Writer lock is busy."],
  ])("#given %s #when specified #then the why line is a plain sentence", (message, why) => {
    const spec = memoryFailureNoticeSpec(message, { command: "create" })
    expect(spec).toEqual({ title: "○ Not remembered", tone: "dim", why, expandedLine: message })
  })

  test("#given a refused deletion #when specified #then the title says it couldn't let go", () => {
    expect(memoryFailureNoticeSpec("memory: delete: x", { command: "delete" }).title).toBe("○ Couldn't let go")
  })
})

describe("memory pending wording", () => {
  test.each([
    [{ command: "create", file_path: "reference/a.md" }, "◌ Remembering · reference/a.md"],
    [{ command: "delete", file_path: "reference/a.md" }, "◌ Letting go · reference/a.md"],
    [{ command: "rename", old_path: "reference/a.md", new_path: "reference/b.md" }, "◌ Moving · reference/a.md → reference/b.md"],
    [{}, "◌ Remembering"],
  ])("#given %j #when pending #then one friendly line describes the in-flight change", (args, line) => {
    expect(memoryPendingLine(args)).toBe(line)
  })
})
