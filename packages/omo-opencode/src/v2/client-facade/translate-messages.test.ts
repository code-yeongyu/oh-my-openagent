import { describe, expect, it } from "bun:test"
import type { V2SessionMessage } from "../context-types"
import { translateMessages } from "./translate-messages"

const base = { sessionID: "ses_1", directory: "/work/app/packages/web", worktree: "/work/app" }
const initial = { agent: "Sisyphus", model: { providerID: "anthropic", id: "claude-opus" } }
const tokens = { input: 10, output: 5, reasoning: 2, cache: { read: 1, write: 0 } }

type AssistantMessage = Extract<V2SessionMessage, { type: "assistant" }>

function user(id: string, text: string, created = 1_000): V2SessionMessage {
  return { type: "user", id, text, time: { created } }
}

function translate(messages: V2SessionMessage[]) {
  return translateMessages({ ...base, messages, initial })
}

describe("translateMessages", () => {
  describe("#given user messages", () => {
    it("#when translated #then they become 1.x user messages with the current agent, model and a text part", () => {
      // given / when
      const [message] = translate([user("msg_1", "fix the bug")])

      // then
      expect(message?.info).toMatchObject({
        id: "msg_1",
        sessionID: "ses_1",
        role: "user",
        time: { created: 1_000 },
        agent: "Sisyphus",
        model: { providerID: "anthropic", modelID: "claude-opus" },
      })
      expect(message?.parts).toEqual([{ id: "msg_1:0", sessionID: "ses_1", messageID: "msg_1", type: "text", text: "fix the bug" }])
    })

    it("#when agent or model switches precede a later user message #then that message carries the switched values", () => {
      // given
      const messages: V2SessionMessage[] = [
        user("msg_1", "first"),
        { type: "agent-switched", id: "msg_2", agent: "Atlas - Plan Executor", time: { created: 1_100 } },
        { type: "model-switched", id: "msg_3", model: { providerID: "openai", id: "gpt-x", variant: "high" }, time: { created: 1_200 } },
        user("msg_4", "second", 1_300),
      ]

      // when
      const translated = translate(messages)

      // then
      expect(translated.map((message) => message.info.id)).toEqual(["msg_1", "msg_4"])
      expect(translated[0]?.info).toMatchObject({ agent: "Sisyphus" })
      expect(translated[1]?.info).toMatchObject({
        agent: "Atlas - Plan Executor",
        model: { providerID: "openai", modelID: "gpt-x" },
        variant: "high",
      })
    })

    it("#when a user message has files #then they become file parts", () => {
      // given
      const message: V2SessionMessage = { type: "user", id: "msg_1", text: "see", time: { created: 1 }, files: [{ uri: "file:///a.png", name: "a.png" }] }

      // when
      const [translated] = translate([message])

      // then
      expect(translated?.parts[1]).toMatchObject({ type: "file", url: "file:///a.png", filename: "a.png" })
    })
  })

  describe("#given injected context messages", () => {
    it("#when synthetic, system or skill messages appear #then they are user messages with synthetic text parts", () => {
      // given
      const messages: V2SessionMessage[] = [
        { type: "synthetic", id: "msg_1", text: "<system-reminder>a</system-reminder>", time: { created: 1 } },
        { type: "system", id: "msg_2", text: "b", time: { created: 2 } },
        { type: "skill", id: "msg_3", name: "git-master", text: "c", time: { created: 3 } },
      ]

      // when
      const translated = translate(messages)

      // then
      expect(translated.map((message) => message.info.role)).toEqual(["user", "user", "user"])
      for (const message of translated) expect(message.parts[0]).toMatchObject({ type: "text", synthetic: true })
      expect(translated[0]?.parts[0]).toMatchObject({ text: "<system-reminder>a</system-reminder>" })
    })
  })

  describe("#given an assistant message", () => {
    const assistant: AssistantMessage = {
      type: "assistant",
      id: "msg_2",
      agent: "Sisyphus",
      model: { providerID: "anthropic", id: "claude-opus", variant: "high" },
      time: { created: 2_000, completed: 2_900 },
      finish: "tool-calls",
      cost: 0.12,
      tokens,
      content: [
        { type: "reasoning", text: "thinking", time: { created: 2_010, completed: 2_020 } },
        { type: "text", text: "let me look" },
        {
          type: "tool",
          id: "call_1",
          name: "shell",
          state: { status: "completed", input: { command: "ls" }, content: [{ type: "text", text: "a.ts" }, { type: "text", text: "b.ts" }], metadata: { exit: 0 } },
          time: { created: 2_030, ran: 2_040, completed: 2_050 },
        },
      ],
    }

    it("#when translated #then the info carries parent, agent, model, usage, finish and paths", () => {
      // given / when
      const translated = translate([user("msg_1", "list files"), assistant])

      // then
      expect(translated[1]?.info).toMatchObject({
        id: "msg_2",
        sessionID: "ses_1",
        role: "assistant",
        parentID: "msg_1",
        agent: "Sisyphus",
        mode: "Sisyphus",
        providerID: "anthropic",
        modelID: "claude-opus",
        variant: "high",
        finish: "tool-calls",
        cost: 0.12,
        tokens,
        time: { created: 2_000, completed: 2_900 },
        path: { cwd: "/work/app/packages/web", root: "/work/app" },
      })
    })

    it("#when translated #then parts run step-start, reasoning, text, tool with 1.x names, step-finish", () => {
      // given / when
      const parts = translate([user("msg_1", "list files"), assistant])[1]?.parts ?? []

      // then
      expect(parts.map((part) => part.type)).toEqual(["step-start", "reasoning", "text", "tool", "step-finish"])
      expect(parts[1]).toMatchObject({ text: "thinking", time: { start: 2_010, end: 2_020 } })
      expect(parts[3]).toMatchObject({
        callID: "call_1",
        tool: "bash",
        state: {
          status: "completed",
          input: { command: "ls" },
          output: "a.ts\nb.ts",
          metadata: { exit: 0 },
          time: { start: 2_040, end: 2_050 },
        },
      })
      expect(parts[4]).toMatchObject({ reason: "tool-calls", cost: 0.12, tokens })
    })

    it("#when tools are streaming, running or failed #then their 1.x states are pending, running and error", () => {
      // given
      const message: AssistantMessage = {
        ...assistant,
        time: { created: 2_000 },
        content: [
          { type: "tool", id: "a", name: "glob", state: { status: "streaming", input: '{"pat' }, time: { created: 1 } },
          { type: "tool", id: "b", name: "grep", state: { status: "running", input: { pattern: "x" }, metadata: {} }, time: { created: 2, ran: 3 } },
          { type: "tool", id: "c", name: "read", state: { status: "error", input: { path: "/x" }, error: { type: "tool.execution", message: "boom" } }, time: { created: 4, completed: 5 } },
        ],
      }

      // when
      const parts = translate([message])[0]?.parts.filter((part) => part.type === "tool") ?? []

      // then
      expect(parts.map((part) => (part.state as { status: string }).status)).toEqual(["pending", "running", "error"])
      expect(parts[2]).toMatchObject({ state: { error: "boom" } })
    })

    it("#when the assistant failed #then the info has a 1.x error and no completed time", () => {
      // given
      const failed: AssistantMessage = { ...assistant, content: [], error: { type: "provider.invalid-request", message: "Model gone", status: 410 }, time: { created: 2_000 }, finish: "error" }

      // when
      const info = translate([failed])[0]?.info

      // then
      expect(info?.error).toMatchObject({ name: "provider.invalid-request", data: { message: "Model gone" } })
      expect(info?.time).toEqual({ created: 2_000 })
    })
  })

  describe("#given entries with no 1.x counterpart", () => {
    it("#when idle, shell and location-switched entries appear #then they are dropped", () => {
      // given
      const messages: V2SessionMessage[] = [
        user("msg_1", "a"),
        { type: "idle", id: "msg_2", time: { created: 2 } },
        { type: "shell", id: "msg_3", time: { created: 3 } },
        { type: "location-switched", id: "msg_4", time: { created: 4 } },
      ]

      // when / then
      expect(translate(messages).map((message) => message.info.id)).toEqual(["msg_1"])
    })
  })

  describe("#given an execution that ended without succeeding", () => {
    const failedIdle: V2SessionMessage = {
      type: "idle",
      id: "msg_9",
      outcome: "failed",
      error: { type: "provider.no-route", message: "Model unavailable: opencode/x" },
      time: { created: 9_000 },
    }

    it("#when no assistant message recorded the failure #then a 1.x assistant error message stands in for it", () => {
      // given / when
      const translated = translate([user("msg_1", "hi"), failedIdle])

      // then
      expect(translated.map((message) => message.info.role)).toEqual(["user", "assistant"])
      expect(translated[1]?.info).toMatchObject({
        id: "msg_9",
        parentID: "msg_1",
        agent: "Sisyphus",
        error: { name: "provider.no-route", data: { message: "Model unavailable: opencode/x" } },
        time: { created: 9_000, completed: 9_000 },
      })
      expect(translated[1]?.parts).toEqual([])
    })

    it("#when the assistant message before it already carries the error #then no second message is added", () => {
      // given
      const failedAssistant: AssistantMessage = {
        type: "assistant",
        id: "msg_2",
        agent: "Sisyphus",
        model: { providerID: "anthropic", id: "claude-opus" },
        content: [],
        error: { type: "provider.no-route", message: "Model unavailable: opencode/x" },
        time: { created: 2_000 },
      }

      // when
      const translated = translate([user("msg_1", "hi"), failedAssistant, failedIdle])

      // then
      expect(translated.map((message) => message.info.id)).toEqual(["msg_1", "msg_2"])
    })

    it("#when the execution was interrupted #then the 1.x aborted error is reported", () => {
      // given
      const interrupted: V2SessionMessage = { type: "idle", id: "msg_9", outcome: "interrupted", time: { created: 9_000 } }

      // when
      const translated = translate([user("msg_1", "hi"), interrupted])

      // then
      expect(translated[1]?.info.error).toEqual({ name: "MessageAbortedError", data: { message: "Aborted" } })
    })

    it("#when the execution succeeded #then the idle entry adds nothing", () => {
      // given
      const succeeded: V2SessionMessage = { type: "idle", id: "msg_9", outcome: "succeeded", time: { created: 9_000 } }

      // when / then
      expect(translate([user("msg_1", "hi"), succeeded]).map((message) => message.info.id)).toEqual(["msg_1"])
    })
  })

  describe("#given a compaction entry", () => {
    it("#when it completed #then a compaction user message and a summary assistant message appear", () => {
      // given
      const messages: V2SessionMessage[] = [
        { type: "compaction", id: "msg_5", status: "completed", reason: "auto", summary: "we did X", time: { created: 5 } },
      ]

      // when
      const translated = translate(messages)

      // then
      expect(translated.map((message) => message.info.role)).toEqual(["user", "assistant"])
      expect(translated[0]?.parts[0]).toMatchObject({ type: "compaction", auto: true })
      expect(translated[1]?.info).toMatchObject({ summary: true, parentID: "msg_5" })
      expect(translated[1]?.parts[0]).toMatchObject({ type: "text", text: "we did X" })
    })

    it("#when it is still running #then only the compaction user message is present", () => {
      // given
      const messages: V2SessionMessage[] = [{ type: "compaction", id: "msg_5", status: "running", reason: "manual", time: { created: 5 } }]

      // when
      const translated = translate(messages)

      // then
      expect(translated).toHaveLength(1)
      expect(translated[0]?.parts[0]).toMatchObject({ type: "compaction", auto: false })
    })
  })
})
