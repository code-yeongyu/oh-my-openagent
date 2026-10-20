import { describe, expect, it } from "bun:test"

import { encodeRecord, makeRecordLimitTranscript } from "./test-support"
import { parseAgentSessionTranscript } from "./transcript-parser"

const lastActiveAtMs = Date.parse("2026-08-24T12:00:00.000Z")

describe("parseAgentSessionTranscript (parity with desktop)", () => {
  for (const overflow of [false, true]) {
    it(`#given the exact record limit with overflow=${overflow} #when parsed #then honors the 100,000 record cap`, () => {
      // when
      const thread = parseAgentSessionTranscript({ contents: makeRecordLimitTranscript("/project", overflow), source: "codex", fallbackSessionId: "unused", lastActiveAtMs })

      // then
      if (overflow) expect(thread).toBeNull()
      else expect(thread?.messages.map((message) => message.text)).toEqual(["First prompt"])
    })
  }

  it("#given a Claude transcript #when parsed #then keeps text and titles while dropping malformed and tool records", () => {
    // given
    const contents = [
      "not valid json",
      JSON.stringify({ type: "ai-title", aiTitle: "Fix authentication" }),
      JSON.stringify({ type: "user", sessionId: "claude-session", isMeta: true, message: { role: "user", content: "Injected skill instructions" } }),
      JSON.stringify({ type: "user", sessionId: "claude-session", isCompactSummary: true, message: { role: "user", content: "Injected compaction summary" } }),
      JSON.stringify({ type: "user", sessionId: "claude-session", timestamp: "2026-08-24T10:00:00.000Z", message: { role: "user", content: [{ type: "text", text: "Fix authentication" }] } }),
      JSON.stringify({ type: "user", sessionId: "claude-session", message: { role: "user", content: [{ type: "tool_result", text: "hidden" }] } }),
      JSON.stringify({ type: "assistant", sessionId: "claude-session", message: { role: "assistant", model: "claude-sonnet-5", content: [{ type: "text", text: "Updated the login flow" }] } }),
      JSON.stringify({ type: "assistant", sessionId: "claude-session", message: { role: "assistant", model: "<synthetic>", content: [{ type: "text", text: "The provider request failed" }] } }),
    ].join("\n")

    // when
    const thread = parseAgentSessionTranscript({ contents, source: "claudeAgent", fallbackSessionId: "fallback", lastActiveAtMs })

    // then
    expect(thread).toMatchObject({
      providerSessionId: "claude-session",
      title: "Fix authentication",
      model: "claude-sonnet-5",
      messages: [
        { role: "user", text: "Fix authentication" },
        { role: "assistant", text: "Updated the login flow" },
        { role: "assistant", text: "The provider request failed" },
      ],
    })
  })

  it("#given a session without a visible user message #when parsed #then skips it", () => {
    // when
    const thread = parseAgentSessionTranscript({ contents: JSON.stringify({ type: "assistant", message: { role: "assistant", content: "Done" } }), source: "claudeAgent", fallbackSessionId: "claude-session", lastActiveAtMs })

    // then
    expect(thread).toBeNull()
  })

  it("#given assistant output past the message limit #when parsed #then keeps the first prompt", () => {
    // given
    const contents = [
      encodeRecord({ type: "user", sessionId: "claude-session", message: { role: "user", content: "Keep this prompt" } }),
      ...Array.from({ length: 250 }, (_, index) => encodeRecord({ type: "assistant", message: { role: "assistant", content: `Assistant update ${index}` } })),
    ].join("\n")

    // when
    const thread = parseAgentSessionTranscript({ contents, source: "claudeAgent", fallbackSessionId: "fallback", lastActiveAtMs })

    // then
    expect(thread?.messages).toHaveLength(200)
    expect(thread?.messages[0]?.text).toBe("Keep this prompt")
    expect(thread?.messages.at(-1)?.text).toBe("Assistant update 249")
  })

  it("#given a forked Codex session #when parsed #then uses the first valid session id", () => {
    // given
    const contents = [
      encodeRecord({ type: "session_meta", payload: { id: "fork-session", forked_from_id: "parent-session" } }),
      encodeRecord({ type: "session_meta", payload: { id: "parent-session" } }),
      encodeRecord({ type: "event_msg", payload: { type: "user_message", message: "Continue in the fork" } }),
    ].join("\n")

    // when / then
    expect(parseAgentSessionTranscript({ contents, source: "codex", fallbackSessionId: "fallback", lastActiveAtMs })?.providerSessionId).toBe("fork-session")
  })

  it("#given a Codex transcript without session metadata #when parsed #then skips it", () => {
    // given
    const contents = encodeRecord({ type: "event_msg", payload: { type: "user_message", message: "This transcript has no session metadata" } })

    // when / then
    expect(parseAgentSessionTranscript({ contents, source: "codex", fallbackSessionId: "rollout-2026-08-24T12-00-00-not-a-session-id", lastActiveAtMs })).toBeNull()
  })

  it("#given response-only Codex context markup #when parsed #then preserves it", () => {
    // given
    const context = "<environment_context>\n<cwd>/tmp/project</cwd>\n</environment_context>"
    const contents = [
      encodeRecord({ type: "session_meta", payload: { id: "codex-session" } }),
      encodeRecord({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: context }] } }),
      encodeRecord({ type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Initialize Git and add a README." }] } }),
    ].join("\n")

    // when
    const thread = parseAgentSessionTranscript({ contents, source: "codex", fallbackSessionId: "fallback", lastActiveAtMs })

    // then
    expect(thread?.title).toBe("<environment_context>")
    expect(thread?.messages.map((message) => message.text)).toEqual([context, "Initialize Git and add a README."])
  })

  for (const [name, prompt, title] of [
    ["context markup", "<environment_context>\n<cwd>/tmp/project</cwd>\n</environment_context>\n\nCreate a useful project.", "<environment_context>"],
    ["a request heading", "\n  ## My request for Codex:\n\nFix the visible bug", "## My request for Codex:"],
  ] as const) {
    it(`#given a canonical Codex event starting with ${name} #when parsed #then preserves it`, () => {
      // given
      const contents = [encodeRecord({ type: "session_meta", payload: { id: "codex-session" } }), encodeRecord({ type: "event_msg", payload: { type: "user_message", message: prompt } })].join("\n")

      // when
      const thread = parseAgentSessionTranscript({ contents, source: "codex", fallbackSessionId: "fallback", lastActiveAtMs })

      // then
      expect(thread?.title).toBe(title)
      expect(thread?.messages.map((message) => message.text)).toEqual([prompt])
    })
  }

  it("#given context markup quoted inside visible user text #when parsed #then keeps it", () => {
    // given
    const quoted = "Do not remove this example:\n<environment_context>\n<cwd>/tmp/example</cwd>\n</environment_context>"
    const contents = [encodeRecord({ type: "session_meta", payload: { id: "codex-session" } }), encodeRecord({ type: "event_msg", payload: { type: "user_message", message: quoted } })].join("\n")

    // when / then
    expect(parseAgentSessionTranscript({ contents, source: "codex", fallbackSessionId: "fallback", lastActiveAtMs })?.messages.map((message) => message.text)).toEqual([quoted])
  })
})
