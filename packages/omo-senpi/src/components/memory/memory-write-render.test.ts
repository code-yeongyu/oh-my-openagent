// Presentation tests for the memory write notice (the row a memory/memory_apply_patch
// tool result draws in the transcript).
//
// The contract is senpi's own notice family (notice/box.ts + cache-warm-renderer.ts):
// BOLD tone-coloured title, dim prose "why", zero or more visible tone-carrying extra
// lines, and a dim expanded-only detail line. Expectations are LITERAL strings so a
// corrupted helper cannot keep them green.
import { describe, expect, test } from "bun:test"

import type { ThemeColor } from "@code-yeongyu/senpi"

import { createMemoryWriteRenderResult } from "./memory-write-render"
import type { MemoryToolResultDetails, MemoryWriteNotice } from "./tools"

const BOLD = "\u001b[1m"
const BOLD_OFF = "\u001b[22m"
function bold(text: string): string {
  return `${BOLD}${text}${BOLD_OFF}`
}

const PLAIN_THEME = {
  fg: (_color: ThemeColor, text: string) => text,
  bg: (_color: "customMessageBg", text: string) => text,
}

function recordingTheme(): {
  readonly theme: { fg: (color: ThemeColor, text: string) => string; bg: (color: "customMessageBg", text: string) => string }
  readonly colors: ThemeColor[]
} {
  const colors: ThemeColor[] = []
  return {
    theme: {
      fg: (color: ThemeColor, text: string) => {
        colors.push(color)
        return text
      },
      bg: (_color: "customMessageBg", text: string) => text,
    },
    colors,
  }
}

const WIDE = 200
const NOW = Date.parse("2026-08-19T12:00:00.000Z")

const MESSAGE = "Memory str_replace committed locally (a1b2c3d)."

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

function render(
  details: MemoryToolResultDetails | undefined,
  options: {
    readonly expanded?: boolean
    readonly width?: number
    readonly theme?: unknown
    readonly isError?: boolean
    readonly enabled?: boolean
    readonly now?: number
  } = {},
): string[] {
  const renderResult = createMemoryWriteRenderResult({
    enabled: () => options.enabled ?? true,
    now: () => options.now ?? NOW,
  })
  const component = renderResult(
    { content: [{ type: "text", text: details?.message ?? MESSAGE }], details } as never,
    { expanded: options.expanded ?? false, isPartial: false },
    (options.theme ?? PLAIN_THEME) as never,
    { isError: options.isError ?? false } as never,
  )
  const lines = (component as { render(width: number): string[] }).render(options.width ?? WIDE)
  if (details?.writeNotice === undefined || options.isError === true || options.enabled === false) return lines
  if (lines[0]?.startsWith("<notice-bg>")) return lines
  return lines.slice(1, -1).map((line) => line.slice(1).trimEnd())
}

describe("memory write notice rendering", () => {
  test("#when rendered with a background theme #then every padded line carries customMessageBg", () => {
    const lines = render({ message: MESSAGE, writeNotice: notice() }, {
      theme: {
        fg: (_color: ThemeColor, text: string) => text,
        bg: (_color: "customMessageBg", text: string) => `<notice-bg>${text}</notice-bg>`,
      },
    })
    for (const line of lines) expect(line).toMatch(/^<notice-bg>.*<\/notice-bg>$/u)
  })
  describe("#given a successful single-file write", () => {
    test("#when it renders collapsed #then the notice reads as a dated memory entry with size and timeline lines", () => {
      // given
      const recorder = recordingTheme()

      // when
      const lines = render({ message: MESSAGE, writeNotice: notice() }, { theme: recorder.theme })

      // then
      expect(lines).toEqual([
        bold("● Memory updated · 4th entry today"),
        "Added 47 lines to knowledge/deploy.md.",
        "system 2.0K injected · 33K total · 12 files",
        "last entry 5m ago · last consolidation 6d ago · 3 steps unreflected",
      ])
      expect(recorder.colors).toEqual(["accent", "dim", "dim", "dim"])
    })

    test("#when it renders expanded #then the detail row carries sha7, identity and subject", () => {
      // when
      const lines = render({ message: MESSAGE, writeNotice: notice() }, { expanded: true })

      // then
      expect(lines[4]).toBe("a1b2c3d · project-a1b2c3d4 · Track the deploy runbook")
    })

    test("#when it renders collapsed #then neither the command name nor the local-commit phrasing leaks", () => {
      // when
      const lines = render({ message: MESSAGE, writeNotice: notice() })

      // then
      const output = lines.join("\n")
      expect(output).not.toContain("committed locally")
      for (const command of ["str_replace", "create", "insert", "delete", "rename", "update_description"]) {
        expect(output).not.toContain(command)
      }
      expect(output).not.toContain("a1b2c3d")
    })

    test("#when the entry count needs an ordinal #then English suffixes are correct", () => {
      // when / then
      const ordinals = [1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map((entriesToday) =>
        render({ message: MESSAGE, writeNotice: notice({ timeline: { entriesToday } }) })[0],
      )

      // then
      expect(ordinals).toEqual([
        bold("● Memory updated · 1st entry today"),
        bold("● Memory updated · 2nd entry today"),
        bold("● Memory updated · 3rd entry today"),
        bold("● Memory updated · 4th entry today"),
        bold("● Memory updated · 11th entry today"),
        bold("● Memory updated · 12th entry today"),
        bold("● Memory updated · 13th entry today"),
        bold("● Memory updated · 21st entry today"),
        bold("● Memory updated · 22nd entry today"),
        bold("● Memory updated · 23rd entry today"),
        bold("● Memory updated · 101st entry today"),
        bold("● Memory updated · 111th entry today"),
      ])
    })

    test("#when a single line was added #then the why sentence is singular", () => {
      // when
      const lines = render({
        message: MESSAGE,
        writeNotice: notice({ affected: [{ path: "knowledge/deploy.md", insertions: 1, deletions: 0 }] }),
      })

      // then
      expect(lines[1]).toBe("Added 1 line to knowledge/deploy.md.")
    })

    test("#when the single file also deleted lines #then the why sentence reports the file update", () => {
      // when
      const lines = render({
        message: MESSAGE,
        writeNotice: notice({ affected: [{ path: "knowledge/deploy.md", insertions: 12, deletions: 4 }] }),
      })

      // then
      expect(lines[1]).toBe("Updated 1 memory file (knowledge/deploy.md).")
    })

    test("#when several files changed #then the why sentence summarises them", () => {
      // when
      const lines = render({
        message: MESSAGE,
        writeNotice: notice({
          affected: [
            { path: "knowledge/deploy.md", insertions: 12, deletions: 4 },
            { path: "system/persona.md", insertions: 3, deletions: 0 },
          ],
        }),
      })

      // then
      expect(lines[1]).toBe("Updated 2 memory files (knowledge/deploy.md, system/persona.md).")
    })
  })

  describe("#given byte formatting", () => {
    test("#when the size crosses the 10K boundary #then one decimal is used below it and an integer above", () => {
      // when
      const small = render({
        message: MESSAGE,
        writeNotice: notice({ size: { systemBytes: 2048, totalBytes: 9_932, fileCount: 3 } }),
      })
      const large = render({
        message: MESSAGE,
        writeNotice: notice({ size: { systemBytes: 10_240, totalBytes: 1_048_576, fileCount: 3 } }),
      })

      // then
      expect(small[2]).toBe("system 2.0K injected · 9.7K total · 3 files")
      expect(large[2]).toBe("system 10K injected · 1024K total · 3 files")
    })

    test("#when exactly one file is tracked #then the noun is singular", () => {
      // when
      const lines = render({
        message: MESSAGE,
        writeNotice: notice({ size: { systemBytes: 2048, totalBytes: 33_792, fileCount: 1 } }),
      })

      // then
      expect(lines[2]).toBe("system 2.0K injected · 33K total · 1 file")
    })
  })

  describe("#given a stale consolidation or a deep reflection backlog", () => {
    test("#when consolidation is a week old #then the timeline line turns warning toned", () => {
      // given
      const recorder = recordingTheme()

      // when
      const lines = render(
        {
          message: MESSAGE,
          writeNotice: notice({
            timeline: {
              entriesToday: 4,
              previousEntryAtISO: "2026-08-19T11:55:00.000Z",
              lastConsolidationAtISO: "2026-08-12T12:00:00.000Z",
              unreflectedSteps: 3,
            },
          }),
        },
        { theme: recorder.theme },
      )

      // then
      expect(lines[3]).toBe("last entry 5m ago · last consolidation 7d ago · 3 steps unreflected")
      expect(recorder.colors).toEqual(["accent", "dim", "dim", "warning"])
    })

    test("#when 25 steps are unreflected #then the timeline line turns warning toned", () => {
      // given
      const recorder = recordingTheme()

      // when
      const lines = render(
        {
          message: MESSAGE,
          writeNotice: notice({
            timeline: {
              entriesToday: 4,
              previousEntryAtISO: "2026-08-19T11:55:00.000Z",
              lastConsolidationAtISO: "2026-08-13T12:00:00.000Z",
              unreflectedSteps: 25,
            },
          }),
        },
        { theme: recorder.theme },
      )

      // then
      expect(lines[3]).toBe("last entry 5m ago · last consolidation 6d ago · 25 steps unreflected")
      expect(recorder.colors[3]).toBe("warning")
    })
  })

  describe("#given degraded gathering", () => {
    test("#when there was no prior commit #then the last-entry field is omitted and nothing throws", () => {
      // when
      const lines = render({
        message: MESSAGE,
        writeNotice: notice({
          timeline: { entriesToday: 1, lastConsolidationAtISO: "2026-08-13T12:00:00.000Z", unreflectedSteps: 3 },
        }),
      })

      // then
      expect(lines[3]).toBe("last consolidation 6d ago · 3 steps unreflected")
    })

    test("#when no reflection has ever consolidated #then the consolidation field is omitted", () => {
      // when
      const lines = render({
        message: MESSAGE,
        writeNotice: notice({
          timeline: { entriesToday: 4, previousEntryAtISO: "2026-08-19T11:55:00.000Z", unreflectedSteps: 3 },
        }),
      })

      // then
      expect(lines[3]).toBe("last entry 5m ago · 3 steps unreflected")
    })

    test("#when the journal state is unreadable #then the unreflected field is omitted", () => {
      // when
      const lines = render({
        message: MESSAGE,
        writeNotice: notice({
          timeline: {
            entriesToday: 4,
            previousEntryAtISO: "2026-08-19T11:55:00.000Z",
            lastConsolidationAtISO: "2026-08-13T12:00:00.000Z",
          },
        }),
      })

      // then
      expect(lines[3]).toBe("last entry 5m ago · last consolidation 6d ago")
    })

    test("#when git failed and no per-file counts exist #then the why sentence degrades to the subject line", () => {
      // when
      const lines = render({ message: MESSAGE, writeNotice: notice({ affected: [] }) })

      // then
      expect(lines).toEqual([
        bold("● Memory updated · 4th entry today"),
        "Memory was updated.",
        "system 2.0K injected · 33K total · 12 files",
        "last entry 5m ago · last consolidation 6d ago · 3 steps unreflected",
      ])
    })

    test("#when the tree size read failed #then the size line is dropped entirely", () => {
      // when
      const lines = render({
        message: MESSAGE,
        writeNotice: notice({ size: undefined, affected: [{ path: "a.md", insertions: 2, deletions: 0 }] }),
      })

      // then
      expect(lines).toEqual([
        bold("● Memory updated · 4th entry today"),
        "Added 2 lines to a.md.",
        "last entry 5m ago · last consolidation 6d ago · 3 steps unreflected",
      ])
    })

    test("#when the entry count is unavailable #then the title falls back to a plain memory-updated line", () => {
      // when
      const lines = render({
        message: MESSAGE,
        writeNotice: notice({ timeline: {} }),
      })

      // then
      expect(lines[0]).toBe(bold("● Memory updated"))
      expect(lines).toHaveLength(3)
    })
  })

  describe("#given the notice must not render", () => {
    test("#when the gate is off #then the plain tool message is rendered verbatim", () => {
      // when
      const lines = render({ message: MESSAGE, writeNotice: notice() }, { enabled: false })

      // then
      expect(lines).toEqual([MESSAGE])
    })

    test("#when the result is an error #then the plain tool message is rendered verbatim", () => {
      // given
      const message = "memory: file_path is required for str_replace"

      // when
      const lines = render({ message }, { isError: true })

      // then
      expect(lines).toEqual([message])
    })

    test("#when no writeNotice was gathered #then the plain tool message is rendered verbatim", () => {
      // when
      const lines = render({ message: MESSAGE })

      // then
      expect(lines).toEqual([MESSAGE])
    })

    test("#when details are absent entirely #then the tool text content is rendered", () => {
      // when
      const lines = render(undefined)

      // then
      expect(lines).toEqual([MESSAGE])
    })
  })
})
