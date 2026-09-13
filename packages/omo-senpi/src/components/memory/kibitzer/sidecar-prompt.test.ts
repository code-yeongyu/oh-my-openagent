import { describe, expect, test } from "bun:test"

import { loadKibitzerPersona, PERSONA_ASSET_FILENAMES } from "@oh-my-opencode/memory-core"

import {
  KIBITZER_EVENT_WINDOW,
  KIBITZER_FIELD_CAPS,
  KIBITZER_RESEED_MAX_CHARS,
  KIBITZER_SIDECAR_TOOL_NAMES,
  renderKibitzerReseedPrompt,
  renderKibitzerSeedPrompt,
  renderKibitzerWakePrompt,
  type KibitzerSidecarEnvelopeInput,
  type KibitzerSidecarEvent,
} from "./sidecar-prompt"

// Every assertion below reads a machine-consumed value out of the envelope: the tag names the
// sidecar wiring emits, the attributes the child parses, the caps the event feed must respect and
// the escaping that keeps a hostile transcript from breaking the envelope. Persona prose is never
// asserted - only the packaging contract that ships it.

function rootAttributes(xml: string): Record<string, string> {
  const open = /^<([a-z-]+)((?:\s+[a-z-]+="[^"]*")*)\s*>/.exec(xml)
  if (open === null) throw new Error(`no root element in: ${xml.slice(0, 120)}`)
  const attributes: Record<string, string> = {}
  for (const match of (open[2] ?? "").matchAll(/([a-z-]+)="([^"]*)"/g)) {
    attributes[match[1] ?? ""] = match[2] ?? ""
  }
  return attributes
}

function rootName(xml: string): string {
  return /^<([a-z-]+)/.exec(xml)?.[1] ?? ""
}

function toolNames(xml: string): string[] {
  return [...xml.matchAll(/<tool name="([^"]+)"/g)].map((match) => match[1] ?? "")
}

function eventCursors(xml: string): number[] {
  return [...xml.matchAll(/<event cursor="(\d+)"/g)].map((match) => Number(match[1]))
}

function section(xml: string, tag: string): string {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`).exec(xml)
  if (match === null) throw new Error(`no <${tag}> element in: ${xml.slice(0, 200)}`)
  return match[1] ?? ""
}

function sectionAttributes(xml: string, tag: string): Record<string, string> {
  const match = new RegExp(`<${tag}((?:\\s+[a-z-]+="[^"]*")*)\\s*>`).exec(xml)
  if (match === null) throw new Error(`no <${tag}> element in: ${xml.slice(0, 200)}`)
  const attributes: Record<string, string> = {}
  for (const attribute of (match[1] ?? "").matchAll(/([a-z-]+)="([^"]*)"/g)) {
    attributes[attribute[1] ?? ""] = attribute[2] ?? ""
  }
  return attributes
}

function toolAttributes(xml: string, name: string): Record<string, string> {
  const match = new RegExp(`<tool name="${name}"((?:\\s+[a-z-]+="[^"]*")*)\\s*>`).exec(xml)
  if (match === null) throw new Error(`no <tool name="${name}"> element in: ${xml.slice(0, 200)}`)
  const attributes: Record<string, string> = {}
  for (const attribute of (match[1] ?? "").matchAll(/([a-z-]+)="([^"]*)"/g)) {
    attributes[attribute[1] ?? ""] = attribute[2] ?? ""
  }
  return attributes
}

function elements(xml: string, tag: string): string[] {
  return [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g"))].map((match) => match[1] ?? "")
}

function unescapeXml(value: string): string {
  return value
    .replace(/&#10;/g, "\n")
    .replace(/&#13;/g, "\r")
    .replace(/&#9;/g, "\t")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
}

const EVENTS: readonly KibitzerSidecarEvent[] = [
  { cursor: 11, kind: "prompt", text: "rebase the worktree" },
  { cursor: 12, kind: "tool_call", tool: "bash", args: "{\"command\":\"git rebase\"}" },
  { cursor: 13, kind: "tool_result", tool: "bash", resultHead: "rebase in progress" },
  { cursor: 14, kind: "assistant", text: "the rebase is running" },
]

function envelope(overrides: Partial<KibitzerSidecarEnvelopeInput> = {}): KibitzerSidecarEnvelopeInput {
  return {
    sessionId: "ses-1",
    maxItems: 2,
    events: EVENTS,
    candidates: [{ path: "reference/project/head-watch.md", description: "rebase directive", excerpt: "never rebase mid-write", score: 0.42 }],
    ...overrides,
  }
}

describe("resident kibitzer prompt envelopes", () => {
  test("#given a seed input #when the seed envelope is rendered #then it carries the session, cursor range, candidates and the five read-only tool contracts", () => {
    // given
    const input = envelope()

    // when
    const xml = renderKibitzerSeedPrompt(input)

    // then
    expect(rootName(xml)).toBe("kibitzer-seed")
    expect(xml.trimEnd().endsWith("</kibitzer-seed>")).toBe(true)
    const root = rootAttributes(xml)
    expect(root.session).toBe("ses-1")
    expect(root["max-items"]).toBe("2")
    expect(root["cursor-from"]).toBe("11")
    expect(root["cursor-to"]).toBe("14")
    expect(KIBITZER_SIDECAR_TOOL_NAMES).toEqual(["read", "grep", "session_entries", "memory", "nudge"])
    expect(toolNames(xml)).toEqual([...KIBITZER_SIDECAR_TOOL_NAMES])
    expect(xml).toContain("operations=\"search,read\"")
    expect(xml).toContain("<rule id=\"no-memory-write\">")
    expect(sectionAttributes(xml, "candidates").count).toBe("1")
    expect(xml).toContain("<candidate path=\"reference/project/head-watch.md\"")
    expect(eventCursors(xml)).toEqual([11, 12, 13, 14])
  })

  test("#given events that arrive out of order #when the wake envelope is rendered #then cursors are ascending and the digest range bounds the envelope", () => {
    // given
    const input = envelope({
      events: [
        { cursor: 30, kind: "assistant", text: "third" },
        { cursor: 12, kind: "prompt", text: "first" },
        { cursor: 21, kind: "tool_call", tool: "read", args: "{}" },
      ],
      digest: { text: "9 folded events", cursorFrom: 3, cursorTo: 9, folded: 9 },
    })

    // when
    const xml = renderKibitzerWakePrompt(input)

    // then
    expect(rootName(xml)).toBe("kibitzer-wake")
    expect(eventCursors(xml)).toEqual([12, 21, 30])
    const root = rootAttributes(xml)
    expect(root["cursor-from"]).toBe("3")
    expect(root["cursor-to"]).toBe("30")
    const digest = sectionAttributes(xml, "digest")
    expect(digest["cursor-from"]).toBe("3")
    expect(digest["cursor-to"]).toBe("9")
    expect(digest.folded).toBe("9")
  })

  test("#given hostile transcript fields #when an envelope is rendered #then it escapes redacts and caps XML", () => {
    // given
    const input = envelope({
      sessionId: "ses \"quoted\" & <tagged>\nline",
      events: [
        { cursor: 5, kind: "prompt", text: `${"P".repeat(KIBITZER_FIELD_CAPS.prompt)}TAIL-MARKER` },
        { cursor: 6, kind: "assistant", text: `Authorization: Bearer abcdef1234567890 <script>alert('x')</script>` },
        { cursor: 7, kind: "tool_call", tool: "read & grep", args: `${"A".repeat(KIBITZER_FIELD_CAPS.toolArgs)}ARGS-TAIL` },
        { cursor: 8, kind: "tool_result", tool: "read", resultHead: `${"R".repeat(KIBITZER_FIELD_CAPS.resultHead)}RESULT-TAIL` },
      ],
      candidates: [{ path: "notes/<leaked>&key.md", description: "key sk-proj-ABCDEFGHIJKLMNOP lives here", excerpt: "token: hunter2hunter2", score: 1 }],
      digest: { text: "D".repeat(KIBITZER_FIELD_CAPS.digest + 400), cursorFrom: 1, cursorTo: 4, folded: 4 },
    })

    // when
    const xml = renderKibitzerSeedPrompt(input)

    // then: escaping (attributes and text), including the newline an attribute may never carry raw
    expect(xml).not.toContain("<script>")
    expect(xml).toContain("&lt;script&gt;alert(&apos;x&apos;)&lt;/script&gt;")
    const root = rootAttributes(xml)
    expect(root.session).toBe("ses &quot;quoted&quot; &amp; &lt;tagged&gt;&#10;line")
    expect(unescapeXml(root.session ?? "")).toBe("ses \"quoted\" & <tagged>\nline")
    expect(xml).toContain("<candidate path=\"notes/&lt;leaked&gt;&amp;key.md\"")
    // then: redaction happens before the text reaches the envelope
    expect(xml).not.toContain("abcdef1234567890")
    expect(xml).not.toContain("sk-proj-ABCDEFGHIJKLMNOP")
    expect(xml).not.toContain("hunter2hunter2")
    // then: every field keeps its cap, measured on the unescaped value
    const texts = elements(xml, "text").map(unescapeXml)
    expect(texts[0]?.length).toBeLessThanOrEqual(KIBITZER_FIELD_CAPS.prompt)
    expect(texts[1]?.length).toBeLessThanOrEqual(KIBITZER_FIELD_CAPS.assistant)
    expect(unescapeXml(section(xml, "args")).length).toBeLessThanOrEqual(KIBITZER_FIELD_CAPS.toolArgs)
    expect(unescapeXml(section(xml, "result")).length).toBeLessThanOrEqual(KIBITZER_FIELD_CAPS.resultHead)
    expect(unescapeXml(section(xml, "digest")).length).toBeLessThanOrEqual(KIBITZER_FIELD_CAPS.digest)
    expect(KIBITZER_FIELD_CAPS.digest).toBe(1024)
    expect(xml).not.toContain("TAIL-MARKER")
    expect(xml).not.toContain("ARGS-TAIL")
    expect(xml).not.toContain("RESULT-TAIL")
  })

  test("#given configured event caps #when an envelope is rendered #then the configured cap replaces the default", () => {
    // given
    const input = envelope({
      caps: { prompt: 24, assistant: 12 },
      events: [
        { cursor: 4, kind: "prompt", text: "p".repeat(400) },
        { cursor: 5, kind: "assistant", text: "a".repeat(400) },
      ],
    })

    // when
    const xml = renderKibitzerWakePrompt(input)

    // then
    const texts = elements(xml, "text").map(unescapeXml)
    expect(texts[0]?.length).toBeLessThanOrEqual(24)
    expect(texts[1]?.length).toBeLessThanOrEqual(12)
  })

  test("#given more events than the window #when an envelope is rendered #then only the newest events are embedded and the dropped cursors stay in the range", () => {
    // given
    const events: KibitzerSidecarEvent[] = Array.from({ length: KIBITZER_EVENT_WINDOW + 5 }, (_, index) => ({
      cursor: index + 1,
      kind: "assistant" as const,
      text: `body ${index + 1}`,
    }))

    // when
    const xml = renderKibitzerWakePrompt(envelope({ events }))

    // then
    const cursors = eventCursors(xml)
    expect(cursors.length).toBe(KIBITZER_EVENT_WINDOW)
    expect(cursors[0]).toBe(6)
    expect(cursors[cursors.length - 1]).toBe(KIBITZER_EVENT_WINDOW + 5)
    expect(sectionAttributes(xml, "events").omitted).toBe("5")
    expect(rootAttributes(xml)["cursor-from"]).toBe("1")
    expect(rootAttributes(xml)["cursor-to"]).toBe(String(KIBITZER_EVENT_WINDOW + 5))
  })

  test("#given reseed state #when the reseed envelope is rendered #then it carries rejected paths, delivered paths, a one-line summary and the last cursor", () => {
    // given
    const input = {
      sessionId: "ses-9",
      maxItems: 2,
      lastCursor: 77,
      taskSummary: "Rework the recall gate\nand ship it",
      rejectedPaths: ["reference/a-one.md", "reference/a-two.md"],
      deliveredPaths: ["reference/b-one.md"],
    }

    // when
    const xml = renderKibitzerReseedPrompt(input)

    // then
    expect(rootName(xml)).toBe("kibitzer-reseed")
    expect(rootAttributes(xml).cursor).toBe("77")
    expect(rootAttributes(xml).session).toBe("ses-9")
    expect(section(xml, "summary")).toBe("Rework the recall gate and ship it")
    expect(elements(section(xml, "rejected"), "path")).toEqual(["reference/a-one.md", "reference/a-two.md"])
    expect(elements(section(xml, "delivered"), "path")).toEqual(["reference/b-one.md"])
    expect(toolNames(xml)).toEqual([...KIBITZER_SIDECAR_TOOL_NAMES])
    expect(xml).toContain("<rule id=\"no-memory-write\">")
    expect(xml.length).toBeLessThanOrEqual(KIBITZER_RESEED_MAX_CHARS)
  })

  test("#given more reseed paths than the bound allows #when the reseed envelope is rendered #then the output stays within the configured bound and reports the omitted counts", () => {
    // given
    const paths = Array.from({ length: 80 }, (_, index) => `reference/project/${"long-path-segment-".repeat(4)}${index}.md`)

    // when
    const xml = renderKibitzerReseedPrompt({
      sessionId: "ses-9",
      maxItems: 2,
      lastCursor: 512,
      taskSummary: "Ship the resident sidecar",
      rejectedPaths: paths,
      deliveredPaths: paths,
      maxChars: 2000,
    })

    // then
    expect(xml.length).toBeLessThanOrEqual(2000)
    expect(Number(sectionAttributes(xml, "rejected").omitted)).toBeGreaterThan(0)
    expect(Number(sectionAttributes(xml, "delivered").omitted)).toBeGreaterThan(0)
    expect(rootAttributes(xml).cursor).toBe("512")
    expect(section(xml, "summary")).toBe("Ship the resident sidecar")
    expect(toolNames(xml)).toEqual([...KIBITZER_SIDECAR_TOOL_NAMES])
  })

  test("#given any envelope #when it is rendered #then no write-capable tool and no memory-write instruction is offered", () => {
    // given
    const rendered = [
      renderKibitzerSeedPrompt(envelope()),
      renderKibitzerWakePrompt(envelope()),
      renderKibitzerReseedPrompt({ sessionId: "ses-1", maxItems: 2, lastCursor: 3, taskSummary: "s", rejectedPaths: [], deliveredPaths: [] }),
    ]

    // when / then
    for (const xml of rendered) {
      expect(toolNames(xml)).toEqual([...KIBITZER_SIDECAR_TOOL_NAMES])
      expect(xml).not.toMatch(/<tool name="(?:write|edit|bash|find|ls|memory_write|memory_search|memory_read)"/)
      expect(xml).toContain("<rule id=\"no-memory-write\">")
      expect(toolAttributes(xml, "memory").operations).toBe("search,read")
    }
  })

  test("#given the packaged persona #when it is loaded #then the kibitzer asset filename and loader contract are unchanged", () => {
    // when
    const persona = loadKibitzerPersona()

    // then
    expect(PERSONA_ASSET_FILENAMES.kibitzer).toBe("kibitzer-persona.md")
    expect(persona.trim().length).toBeGreaterThan(0)
    expect(persona).toContain("Kibitzer")
  })
})
