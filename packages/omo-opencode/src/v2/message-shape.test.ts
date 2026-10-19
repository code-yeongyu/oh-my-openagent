import { describe, expect, test } from "bun:test"
import { TeamModeConfigSchema } from "../config/schema/team-mode"
import { createTeamModeStatusInjector } from "../hooks/team-mode-status-injector"
import { hookMessagesToV1, storedMessagesToV1, writeHookMessagesBack } from "./message-shape"

type Message = { id?: string; role: string; content: Array<Record<string, unknown>> }

// Provider history of an agent loop after a read pulled in instructions: the latest
// user-role message sits between two tool steps.
function history(): Message[] {
  return [
    { id: "msg_1", role: "user", content: [{ type: "text", text: "Implement the plan." }] },
    { id: "msg_2", role: "assistant", content: [{ type: "tool-call", id: "call_1", name: "read" }] },
    { role: "tool", content: [{ type: "tool-result", id: "call_1", name: "read" }] },
    { id: "msg_3", role: "user", content: [{ type: "text", text: "Instructions from: AGENTS.md\nUse team mode for audits." }] },
    {
      id: "msg_4",
      role: "assistant",
      content: [
        { type: "reasoning", text: "Run the tests." },
        { type: "tool-call", id: "call_2", name: "shell" },
      ],
    },
    { role: "tool", content: [{ type: "tool-result", id: "call_2", name: "shell" }] },
  ]
}

function shape(messages: Message[]): string[] {
  return messages.map((message) => `${message.role}[${message.content.map((part) => part.type).join(",")}]`)
}

describe("writeHookMessagesBack", () => {
  test("writes the messages after an inserted one back to the messages they came from", () => {
    const messages = history()
    const view = hookMessagesToV1(messages, "ses_1")
    view.splice(3, 0, {
      info: { sessionID: "ses_1", role: "user" },
      parts: [{ type: "text", text: "<status/>", synthetic: true }],
    })

    const next = writeHookMessagesBack(messages, view)

    expect(shape(next)).toEqual([
      "user[text]",
      "assistant[tool-call]",
      "tool[tool-result]",
      "user[text]",
      "user[text]",
      "assistant[reasoning,tool-call]",
      "tool[tool-result]",
    ])
    expect(next[4]).toBe(messages[3])
    expect(next[5]).toBe(messages[4])
    expect(next[6]).toBe(messages[5])
  })

  test("keeps the team-mode status injection from moving tool calls into a tool message", async () => {
    const messages = history()
    const view = hookMessagesToV1(messages, "ses_1")
    const injector = createTeamModeStatusInjector(TeamModeConfigSchema.parse({ enabled: true }))
    await injector["experimental.chat.messages.transform"]?.({ sessionID: "ses_1" }, { messages: view as never })
    expect(view).toHaveLength(messages.length + 1)

    const next = writeHookMessagesBack(messages, view)

    const toolParts = next.filter((message) => message.role === "tool").flatMap((message) => message.content)
    expect(toolParts.map((part) => part.type)).toEqual(["tool-result", "tool-result"])
    expect(next.at(-2)?.content.map((part) => part.type)).toEqual(["reasoning", "tool-call"])
  })

  test("writes in-place part edits back and drops removed messages", () => {
    const messages = history()
    const view = hookMessagesToV1(messages, "ses_1")
    view[3]?.parts.unshift({ type: "text", text: "<reminder/>", synthetic: true })
    view.splice(0, 1)

    const next = writeHookMessagesBack(messages, view)

    expect(next).toHaveLength(messages.length - 1)
    expect(next[0]).toBe(messages[1])
    expect(next[2]).toBe(messages[3])
    expect(messages[3]?.content.map((part) => part.text)).toEqual([
      "<reminder/>",
      "Instructions from: AGENTS.md\nUse team mode for audits.",
    ])
  })
})

describe("storedMessagesToV1", () => {
  // OpenCode 2 stores a tool call as { type: "tool", id, name, state } (seen in session_message rows
  // on 2.0.32); the v1 hook code reads part.tool and part.callID.
  test("aliases the stored tool part name and id to the v1 tool and callID fields", () => {
    const view = storedMessagesToV1(
      [
        {
          type: "assistant",
          id: "msg_1",
          agent: "build",
          model: { providerID: "anthropic", modelID: "claude" },
          content: [
            { type: "reasoning", text: "Run it." },
            {
              type: "tool",
              id: "call_1",
              name: "execute",
              executed: true,
              state: { status: "completed", input: { code: "1" }, content: [], metadata: {} },
              time: { start: 1, end: 2 },
            },
          ],
        },
      ],
      "ses_1",
    )
    expect(view).toHaveLength(1)
    expect(view[0]?.parts[0]).toEqual({ type: "reasoning", text: "Run it." })
    expect(view[0]?.parts[1]).toMatchObject({
      type: "tool",
      id: "call_1",
      name: "execute",
      tool: "execute",
      callID: "call_1",
      state: { status: "completed", input: { code: "1" } },
    })
  })

  test("keeps an explicit v1 tool field and leaves non-tool parts untouched", () => {
    const view = storedMessagesToV1(
      [
        {
          type: "assistant",
          id: "msg_1",
          content: [
            { type: "tool", id: "call_1", name: "bash", tool: "Bash", callID: "call_legacy", state: { status: "completed", input: {} } },
            { type: "text", text: "done" },
          ],
        },
      ],
      "ses_1",
    )
    expect(view[0]?.parts[0]).toMatchObject({ tool: "Bash", callID: "call_legacy", name: "bash" })
    expect(view[0]?.parts[1]).toEqual({ type: "text", text: "done" })
  })

  test("does not add v1 aliases to the hook message view that is written back to the host", () => {
    const stored = { type: "assistant", id: "msg_1", content: [{ type: "tool", id: "call_1", name: "read", state: { status: "completed", input: {} } }] }
    const view = hookMessagesToV1([stored], "ses_1")
    expect(view[0]?.parts[0]).not.toHaveProperty("tool")
    expect(view[0]?.parts[0]).not.toHaveProperty("callID")
  })
})
