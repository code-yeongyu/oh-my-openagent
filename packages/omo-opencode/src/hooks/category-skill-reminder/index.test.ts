import { afterEach, describe, expect, test } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk"
import type { AvailableSkill } from "../../agents/dynamic-agent-prompt-builder"
import {
  _resetForTesting,
  updateSessionAgent,
} from "../../features/claude-code-session-state"
import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import { createCategorySkillReminderHook } from "./index"

const REMINDER_MARKER = "[Category+Skill Reminder]"

function createHook(availableSkills: AvailableSkill[] = []) {
  return createCategorySkillReminderHook(
    unsafeTestValue({
      client: { tui: { showToast: async () => {} } },
    }),
    availableSkills,
  )
}

function createOutput(text = "result") {
  return { title: "", output: text, metadata: {} }
}

type MessageWithParts = {
  info: Message
  parts: Part[]
}

function createUserTurn(
  sessionID: string,
  text: string,
  options: { id?: string; synthetic?: boolean } = {},
): MessageWithParts {
  const messageID = options.id ?? `msg_${sessionID}`
  return {
    info: {
      id: messageID,
      sessionID,
      role: "user",
      time: { created: 1 },
      agent: "sisyphus",
      model: { providerID: "test", modelID: "test" },
    },
    parts: [{
      id: `prt_${messageID}`,
      sessionID,
      messageID,
      type: "text",
      text,
      ...(options.synthetic === true ? { synthetic: true } : {}),
    }],
  }
}

function findReminderParts(messages: MessageWithParts[]): Part[] {
  return messages.flatMap((message) => message.parts).filter(
    (part) => part.type === "text"
      && part.synthetic === true
      && part.text.includes(REMINDER_MARKER),
  )
}

async function transformMessages(
  hook: ReturnType<typeof createHook>,
  messages: MessageWithParts[],
): Promise<void> {
  await hook["experimental.chat.messages.transform"]({}, { messages })
}

async function useTools(input: {
  hook: ReturnType<typeof createHook>
  sessionID: string
  tools: readonly string[]
  output?: ReturnType<typeof createOutput>
  agent?: string
}): Promise<ReturnType<typeof createOutput>> {
  const output = input.output ?? createOutput()
  for (const [index, tool] of input.tools.entries()) {
    await input.hook["tool.execute.after"]({
      tool,
      sessionID: input.sessionID,
      callID: String(index + 1),
      ...(input.agent === undefined ? {} : { agent: input.agent }),
    }, output)
  }
  return output
}

afterEach(() => {
  _resetForTesting()
})

describe("category-skill-reminder hook", () => {
  test.each(["Sisyphus", "Atlas", "sisyphus-junior"])(
    "#given target agent %s #when three delegatable tools finish #then one reminder is injected before the user text",
    async (agent) => {
      const hook = createHook()
      const sessionID = `target-${agent}`
      updateSessionAgent(sessionID, agent)

      const output = await useTools({ hook, sessionID, tools: ["edit", "bash", "write"] })
      const messages = [createUserTurn(sessionID, "continue working")]
      await transformMessages(hook, messages)

      expect(output.output).toBe("result")
      expect(findReminderParts(messages)).toHaveLength(1)
      expect(messages[0]?.parts[0]).toMatchObject({ synthetic: true, type: "text" })
      expect(messages[0]?.parts[1]).toMatchObject({ text: "continue working", type: "text" })
    },
  )

  test("#given a non-target agent #when three delegatable tools finish #then no reminder is queued", async () => {
    const hook = createHook()
    const sessionID = "librarian-session"
    updateSessionAgent(sessionID, "librarian")

    const output = await useTools({ hook, sessionID, tools: ["edit", "edit", "edit"] })
    const messages = [createUserTurn(sessionID, "continue")]
    await transformMessages(hook, messages)

    expect(output.output).toBe("result")
    expect(findReminderParts(messages)).toHaveLength(0)
  })

  test("#given a later message belongs to another session #when one session has a queued reminder #then the reminder stays with its request", async () => {
    const hook = createHook()
    const targetSessionID = "target-session"
    const otherSessionID = "other-session"
    updateSessionAgent(targetSessionID, "Sisyphus")
    await useTools({ hook, sessionID: targetSessionID, tools: ["read", "grep", "glob"] })
    const targetMessage = createUserTurn(targetSessionID, "target request")
    const otherMessage = createUserTurn(otherSessionID, "other request")

    await transformMessages(hook, [targetMessage, otherMessage])

    expect(findReminderParts([targetMessage])).toHaveLength(1)
    expect(findReminderParts([otherMessage])).toHaveLength(0)
  })

  test("#given no tracked agent #when the tool input identifies Sisyphus #then the reminder is injected", async () => {
    const hook = createHook()
    const sessionID = "input-agent-session"

    const output = await useTools({
      hook,
      sessionID,
      tools: ["edit", "edit", "edit"],
      agent: "Sisyphus",
    })
    const messages = [createUserTurn(sessionID, "continue")]
    await transformMessages(hook, messages)

    expect(output.output).toBe("result")
    expect(findReminderParts(messages)).toHaveLength(1)
  })

  test.each([
    { delegationTool: "task", order: "before", tools: ["task", "edit", "edit", "edit"] },
    { delegationTool: "task", order: "after", tools: ["edit", "edit", "edit", "task"] },
    { delegationTool: "call_omo_agent", order: "before", tools: ["call_omo_agent", "edit", "edit", "edit"] },
    { delegationTool: "call_omo_agent", order: "after", tools: ["edit", "edit", "edit", "call_omo_agent"] },
  ])(
    "#given $delegationTool finishes $order the threshold #when messages transform runs #then no reminder is injected",
    async ({ tools }) => {
      const hook = createHook()
      const sessionID = "delegation-session"
      updateSessionAgent(sessionID, "Sisyphus")

      const output = await useTools({
        hook,
        sessionID,
        tools,
      })
      const messages = [createUserTurn(sessionID, "continue")]
      await transformMessages(hook, messages)

      expect(output.output).toBe("result")
      expect(findReminderParts(messages)).toHaveLength(0)
    },
  )

  test("#given mixed tools #when fewer than three delegatable tools finish #then no reminder is injected", async () => {
    const hook = createHook()
    const sessionID = "mixed-tools-session"
    updateSessionAgent(sessionID, "Sisyphus")

    const output = await useTools({
      hook,
      sessionID,
      tools: ["edit", "lsp_goto_definition", "read", "lsp_symbols"],
    })
    const messages = [createUserTurn(sessionID, "continue")]
    await transformMessages(hook, messages)

    expect(output.output).toBe("result")
    expect(findReminderParts(messages)).toHaveLength(0)
  })

  test("#given the third eligible tool call #when the reminder is queued #then tool output remains byte-identical", async () => {
    const hook = createHook()
    const sessionID = "byte-identical-session"
    const original = "stdout\r\nwith trailing bytes\u0000\n"
    const output = createOutput(original)
    updateSessionAgent(sessionID, "Sisyphus")

    await useTools({ hook, sessionID, tools: ["read", "grep", "bash"], output })

    expect(output.output).toBe(original)
  })

  test("#given a queued reminder and no real user text #when messages transform retries #then pending is retained", async () => {
    const hook = createHook()
    const sessionID = "pending-without-text"
    updateSessionAgent(sessionID, "Sisyphus")
    await useTools({ hook, sessionID, tools: ["read", "grep", "glob"] })

    const noText = createUserTurn(sessionID, "unused")
    noText.parts = []
    await transformMessages(hook, [])
    await transformMessages(hook, [noText])
    await transformMessages(hook, [createUserTurn(sessionID, "internal", { synthetic: true })])
    const realMessages = [createUserTurn(sessionID, "real user text", { id: "msg_real" })]
    await transformMessages(hook, realMessages)

    expect(findReminderParts(realMessages)).toHaveLength(1)
  })

  test("#given multiple real and synthetic user texts #when a reminder is pending #then exactly one is inserted before the latest real text", async () => {
    const hook = createHook()
    const sessionID = "latest-real-text"
    updateSessionAgent(sessionID, "Sisyphus")
    await useTools({ hook, sessionID, tools: ["edit", "write", "bash"] })

    const latestTurn = createUserTurn(sessionID, "earlier text in latest turn", { id: "msg_latest" })
    latestTurn.parts.push(
      {
        id: "prt_internal",
        sessionID,
        messageID: "msg_latest",
        type: "text",
        text: "internal context",
        synthetic: true,
      },
      {
        id: "prt_latest_real",
        sessionID,
        messageID: "msg_latest",
        type: "text",
        text: "latest real text",
      },
    )
    const messages = [
      createUserTurn(sessionID, "older real text", { id: "msg_old" }),
      latestTurn,
      createUserTurn(sessionID, "synthetic tail", { id: "msg_tail", synthetic: true }),
    ]

    await transformMessages(hook, messages)
    await transformMessages(hook, messages)

    const reminderIndex = latestTurn.parts.findIndex(
      (part) => part.type === "text" && part.text.includes(REMINDER_MARKER),
    )
    const latestTextIndex = latestTurn.parts.findIndex(
      (part) => part.type === "text" && part.text === "latest real text",
    )
    expect(findReminderParts(messages)).toHaveLength(1)
    expect(reminderIndex).toBe(latestTextIndex - 1)
    expect(latestTurn.parts[reminderIndex]).toMatchObject({
      messageID: "msg_latest",
      sessionID,
      synthetic: true,
      type: "text",
    })
  })

  test("#given a reminder is inserted #when transforms and tools repeat without assistant completion #then the same bytes appear only once", async () => {
    const hook = createHook()
    const sessionID = "once-session"
    updateSessionAgent(sessionID, "Sisyphus")
    const firstOutput = await useTools({ hook, sessionID, tools: ["edit", "edit", "edit"] })
    const firstMessages = [createUserTurn(sessionID, "first continuation")]
    await transformMessages(hook, firstMessages)
    const injectedBytes = JSON.stringify(findReminderParts(firstMessages)[0])
    await transformMessages(hook, firstMessages)

    const secondOutput = await useTools({ hook, sessionID, tools: ["edit", "edit", "edit"] })
    const secondMessages = [createUserTurn(sessionID, "second continuation", { id: "msg_second" })]
    await transformMessages(hook, secondMessages)

    expect(firstOutput.output).toBe("result")
    expect(secondOutput.output).toBe("result")
    expect(findReminderParts(firstMessages)).toHaveLength(1)
    expect(JSON.stringify(findReminderParts(firstMessages)[0])).toBe(injectedBytes)
    expect(findReminderParts(secondMessages)).toHaveLength(0)
  })

  test("#given a reminder is pending #when the session is deleted #then pending state and counts are cleared", async () => {
    const hook = createHook()
    const sessionID = "delete-session"
    updateSessionAgent(sessionID, "Sisyphus")
    await useTools({ hook, sessionID, tools: ["edit", "edit", "edit"] })

    await hook.event({ event: { type: "session.deleted", properties: { info: { id: sessionID } } } })
    const clearedMessages = [createUserTurn(sessionID, "after deletion")]
    await transformMessages(hook, clearedMessages)
    const output = await useTools({ hook, sessionID, tools: ["edit", "edit", "edit"] })
    const freshMessages = [createUserTurn(sessionID, "after fresh threshold", { id: "msg_fresh" })]
    await transformMessages(hook, freshMessages)

    expect(output.output).toBe("result")
    expect(findReminderParts(clearedMessages)).toHaveLength(0)
    expect(findReminderParts(freshMessages)).toHaveLength(1)
  })

  test("#given mixed-case tool names #when the threshold is reached #then counting and delegation remain case-insensitive", async () => {
    const hook = createHook()
    updateSessionAgent("case-count", "Sisyphus")
    updateSessionAgent("case-delegate", "Sisyphus")

    const counted = await useTools({ hook, sessionID: "case-count", tools: ["EDIT", "Edit", "edit"] })
    const delegated = await useTools({ hook, sessionID: "case-delegate", tools: ["TASK", "edit", "edit", "edit"] })
    const countedMessages = [createUserTurn("case-count", "continue counted")]
    const delegatedMessages = [createUserTurn("case-delegate", "continue delegated")]
    await transformMessages(hook, countedMessages)
    await transformMessages(hook, delegatedMessages)

    expect(counted.output).toBe("result")
    expect(delegated.output).toBe("result")
    expect(findReminderParts(countedMessages)).toHaveLength(1)
    expect(findReminderParts(delegatedMessages)).toHaveLength(0)
  })

  test.each([
    {
      name: "built-in skills",
      skills: [
        { name: "frontend", description: "Frontend UI/UX work", location: "plugin" },
        { name: "git-master", description: "Git operations", location: "plugin" },
      ] satisfies AvailableSkill[],
      expected: ["**Built-in**:", "frontend", "load_skills=[\"frontend\""],
    },
    {
      name: "user skills",
      skills: [
        { name: "frontend", description: "Frontend UI/UX work", location: "plugin" },
        { name: "react-19", description: "React expertise", location: "user" },
      ] satisfies AvailableSkill[],
      expected: ["**⚡ YOUR SKILLS (PRIORITY)**", "react-19", "load_skills=[\"react-19\""],
    },
    {
      name: "no skills",
      skills: [] satisfies AvailableSkill[],
      expected: [REMINDER_MARKER, "load_skills=[]"],
    },
  ])("#given $name #when the reminder fires #then it formats the available skills", async ({ skills, expected }) => {
    const hook = createHook(skills)
    const sessionID = `skills-${skills.length}`
    updateSessionAgent(sessionID, "Sisyphus")

    const output = await useTools({ hook, sessionID, tools: ["read", "read", "read"] })
    const messages = [createUserTurn(sessionID, "continue")]
    await transformMessages(hook, messages)

    expect(output.output).toBe("result")
    const reminder = findReminderParts(messages)[0]
    expect(reminder?.type).toBe("text")
    if (reminder?.type !== "text") throw new Error("expected reminder text part")
    for (const text of expected) expect(reminder.text).toContain(text)
  })
})
