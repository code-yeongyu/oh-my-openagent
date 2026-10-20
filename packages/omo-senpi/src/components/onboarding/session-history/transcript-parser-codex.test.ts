import { describe, expect, it } from "bun:test"

import { encodeRecord } from "./test-support"
import { parseAgentSessionTranscript } from "./transcript-parser"

const lastActiveAtMs = Date.parse("2026-08-24T12:00:00.000Z")
const meta = encodeRecord({ type: "session_meta", payload: { id: "codex-session" } })
const responseUser = (text: string, metadata?: unknown, timestamp?: string) =>
  encodeRecord({ type: "response_item", ...(timestamp ? { timestamp } : {}), payload: { type: "message", role: "user", ...(metadata === undefined ? {} : { internal_chat_message_metadata_passthrough: metadata }), content: [{ type: "input_text", text }] } })
const userEvent = (message: string, timestamp?: string) =>
  encodeRecord({ type: "event_msg", ...(timestamp ? { timestamp } : {}), payload: { type: "user_message", message } })
const assistant = (text: string, timestamp?: string) =>
  encodeRecord({ type: "response_item", ...(timestamp ? { timestamp } : {}), payload: { type: "message", role: "assistant", content: [{ type: "output_text", text }] } })
const parse = (lines: Array<string>) => parseAgentSessionTranscript({ contents: lines.join("\n"), source: "codex", fallbackSessionId: "fallback", lastActiveAtMs })
const assistantRun = (count: number) => Array.from({ length: count }, (_, index) => assistant(`Assistant message ${index}`, `2026-08-24T11:${String(index % 60).padStart(2, "0")}:00.000Z`))

describe("parseAgentSessionTranscript Codex canonical turns (parity with desktop)", () => {
  it("#given injected instructions in the same turn #when parsed #then keeps only the visible user event", () => {
    // when
    const thread = parse([meta, responseUser("<user_instructions>\nInternal setup instructions\n</user_instructions>", { turn_id: "turn-1" }), userEvent("Fix the actual bug"), responseUser("Fix the actual bug", { turn_id: "turn-1" }), assistant("Fixed")])

    // then
    expect(thread?.messages.map((message) => message.text)).toEqual(["Fix the actual bug", "Fixed"])
  })

  it("#given a long Codex transcript capped at 200 messages #when parsed #then keeps the canonical first prompt", () => {
    // given
    const canonicalPrompt = "\n  Keep the canonical prompt  \n"
    const canonicalTimestamp = "2026-08-24T10:01:00.000Z"

    // when
    const thread = parse([meta, responseUser("Keep the canonical prompt", undefined, "2026-08-24T10:00:00.000Z"), userEvent(canonicalPrompt, canonicalTimestamp), ...assistantRun(200)])

    // then
    expect(thread?.messages).toHaveLength(200)
    expect(thread?.messages[0]).toMatchObject({ role: "user", text: canonicalPrompt, createdAt: canonicalTimestamp })
  })

  it("#given a later user message remains after the cap #when parsed #then restores the canonical first prompt", () => {
    // given
    const canonicalPrompt = "\n  Keep the canonical prompt  \n"
    const canonicalTimestamp = "2026-08-24T10:01:00.000Z"

    // when
    const thread = parse([
      meta,
      responseUser("Keep the canonical prompt", { turn_id: "turn-1" }, "2026-08-24T10:00:00.000Z"),
      userEvent(canonicalPrompt, canonicalTimestamp),
      ...assistantRun(198),
      userEvent("Keep this later prompt", "2026-08-24T11:58:30.000Z"),
      assistant("Keep this latest response", "2026-08-24T11:59:00.000Z"),
    ])

    // then
    expect(thread?.messages).toHaveLength(200)
    expect(thread?.messages[0]).toMatchObject({ role: "user", text: canonicalPrompt, createdAt: canonicalTimestamp })
    expect(thread?.messages.filter((message) => message.text.trim() === canonicalPrompt.trim())).toHaveLength(1)
    expect(thread?.messages.some((message) => message.text === "Keep this later prompt")).toBe(true)
    expect(thread?.messages.at(-1)?.text).toBe("Keep this latest response")
  })

  it("#given turn ids repeating after an assistant #when parsed #then keeps mixed-format response users", () => {
    // when
    const thread = parse([
      meta,
      responseUser("Keep this older prompt", { turn_id: "turn-older" }),
      userEvent("Keep this newer prompt"),
      responseUser("Keep this newer prompt", { turn_id: "turn-newer" }),
      assistant("Ask again when needed"),
      responseUser("Keep this newer prompt", { turn_id: "turn-newer" }),
    ])

    // then
    expect(thread?.messages.map((message) => message.text)).toEqual(["Keep this older prompt", "Keep this newer prompt", "Ask again when needed", "Keep this newer prompt"])
  })

  it("#given ambiguous turn metadata #when parsed #then preserves response user text", () => {
    // when
    const thread = parse([meta, responseUser("Keep this legacy prompt", ["unexpected"]), responseUser("Keep this prompt with a blank turn ID", { turn_id: "   " })])

    // then
    expect(thread?.messages.map((message) => message.text)).toEqual(["Keep this legacy prompt", "Keep this prompt with a blank turn ID"])
  })

  it("#given generated response context in the turn #when parsed #then uses the canonical event", () => {
    // when
    const thread = parse([
      meta,
      responseUser("<environment_context>\n<cwd>/tmp/project</cwd>\n<shell>zsh</shell>\n</environment_context>", { turn_id: "turn-1" }),
      responseUser("# AGENTS.md instructions for /tmp/project\n\n<INSTRUCTIONS>\nPrivate project rules\n</INSTRUCTIONS>", { turn_id: "turn-1" }),
      userEvent("Do something here so it looks like a real project."),
      responseUser("Do something here so it looks like a real project.", { turn_id: "turn-1" }),
      assistant("Created the project."),
    ])

    // then
    expect(thread?.title).toBe("Do something here so it looks like a real project.")
    expect(thread?.messages.map((message) => message.text)).toEqual(["Do something here so it looks like a real project.", "Created the project."])
  })
})
