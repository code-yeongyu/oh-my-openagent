/// <reference path="../../../bun-test.d.ts" />

import { afterEach, describe, expect, mock, test } from "bun:test"

import { _resetForTesting, setMainSession, subagentSessions } from "../../features/claude-code-session-state"
import {
  clearTeamSessionRegistry,
  registerTeamSession,
} from "../../features/team-mode/team-session-registry"
import {
  AUTO_SLASH_COMMAND_TAG_CLOSE,
  AUTO_SLASH_COMMAND_TAG_OPEN,
} from "../auto-slash-command/constants"
import {
  BTW_AUTO_SLASH_COMMAND_MARKER,
  type MessageWithParts,
} from "../btw-context-strip/predicates"
import {
  BTW_TOOL_GUARD_DENIAL_MESSAGE,
  createBtwToolGuardHook,
  type BtwToolGuardClient,
} from "./hook"
import { _resetBtwTurnStateForTesting, markBtwTurnActive } from "./turn-state"

type SessionInfo = {
  parentID?: string
}

function createUserMessage(text: string): MessageWithParts {
  return {
    info: { role: "user" },
    parts: [{ type: "text", text }],
  }
}

function createAssistantMessage(text: string): MessageWithParts {
  return {
    info: { role: "assistant" },
    parts: [{ type: "text", text }],
  }
}

function createBtwMessage(question: string): MessageWithParts {
  const message = createUserMessage(
    [
      AUTO_SLASH_COMMAND_TAG_OPEN,
      "# BTW Command",
      "",
      `**User Arguments**: ${question}`,
      AUTO_SLASH_COMMAND_TAG_CLOSE,
    ].join("\n"),
  )
  const part = message.parts[0]
  if (part && typeof part === "object") {
    Object.assign(part, { [BTW_AUTO_SLASH_COMMAND_MARKER]: true })
  }

  return message
}

function createClient(messages: MessageWithParts[], sessionInfo: SessionInfo = {}): BtwToolGuardClient {
  const getSession: BtwToolGuardClient["session"]["get"] = mock(async () => ({ data: sessionInfo }))
  const getMessages: BtwToolGuardClient["session"]["messages"] = mock(async () => ({ data: messages }))

  return {
    session: {
      get: getSession,
      messages: getMessages,
    },
  }
}

function getBeforeHook(client: BtwToolGuardClient) {
  const hook = createBtwToolGuardHook({ client })["tool.execute.before"]
  if (!hook) {
    throw new Error("btw tool guard hook missing tool.execute.before handler")
  }

  return hook
}

async function runHook(client: BtwToolGuardClient, sessionID = "main-session"): Promise<void> {
  const hook = getBeforeHook(client)
  await hook(
    { tool: "read", sessionID, callID: "call-1" },
    { args: { filePath: "/tmp/example.txt" } },
  )
}

async function expectHookToThrow(client: BtwToolGuardClient, message: string): Promise<void> {
  let thrown: unknown
  try {
    await runHook(client)
  } catch (error) {
    thrown = error
  }

  expect(thrown).toBeDefined()
  expect(String(thrown)).toContain(message)
}

async function expectHookToAllow(client: BtwToolGuardClient, sessionID = "main-session"): Promise<void> {
  let thrown: unknown
  try {
    await runHook(client, sessionID)
  } catch (error) {
    thrown = error
  }

  expect(thrown).toBeUndefined()
}

describe("btw tool guard", () => {
  afterEach(() => {
    _resetForTesting()
    clearTeamSessionRegistry()
    _resetBtwTurnStateForTesting()
  })

  describe("#given the latest user message is btw-marked in the primary session", () => {
    describe("#when the model attempts to call a tool", () => {
      test("#then denies the tool call with the read-only /btw message", async () => {
        setMainSession("main-session")
        const client = createClient([
          createUserMessage("normal opening"),
          createAssistantMessage("normal answer"),
          createBtwMessage("answer privately without tools"),
        ])

        await expectHookToThrow(client, BTW_TOOL_GUARD_DENIAL_MESSAGE)
      })
    })
  })

  describe("#given the latest user message is not btw-marked in the primary session", () => {
    describe("#when the model attempts to call a tool", () => {
      test("#then allows the tool call", async () => {
        setMainSession("main-session")
        const client = createClient([
          createBtwMessage("earlier private aside"),
          createAssistantMessage("earlier private answer"),
          createUserMessage("normal follow-up"),
        ])

        await expectHookToAllow(client)
      })
    })
  })

  describe("#given a sub-session has a btw-marked latest user message", () => {
    describe("#when the sub-session model attempts to call a tool", () => {
      test("#then leaves the tool call untouched", async () => {
        setMainSession("main-session")
        subagentSessions.add("child-session")
        const client = createClient([createBtwMessage("subagent private aside")])

        await expectHookToAllow(client, "child-session")
      })
    })
  })

  describe("#given a team session has a btw-marked latest user message", () => {
    describe("#when the team member attempts to call a tool", () => {
      test("#then leaves the tool call untouched", async () => {
        setMainSession("main-session")
        registerTeamSession("team-session", {
          teamRunId: "11111111-1111-4111-8111-111111111111",
          memberName: "member-one",
          role: "member",
        })
        const client = createClient([createBtwMessage("team private aside")])

        await expectHookToAllow(client, "team-session")
      })
    })
  })

  describe("#given session metadata reports a parent session", () => {
    describe("#when the child session has a btw-marked latest user message", () => {
      test("#then leaves the tool call untouched", async () => {
        const client = createClient([createBtwMessage("metadata child aside")], {
          parentID: "parent-session",
        })

        await expectHookToAllow(client, "child-session")
      })
    })
  })

  describe("#given session.messages() rejects while the local /btw turn state is active", () => {
    describe("#when the model attempts to call a tool", () => {
      test("#then fails closed and denies the tool call", async () => {
        setMainSession("main-session")
        markBtwTurnActive("main-session")
        const client: BtwToolGuardClient = {
          session: {
            get: mock(async () => ({ data: {} })),
            messages: mock(async () => {
              throw new Error("transient SDK failure")
            }),
          },
        }

        await expectHookToThrow(client, BTW_TOOL_GUARD_DENIAL_MESSAGE)
      })
    })
  })

  describe("#given session.messages() rejects with no local /btw turn state", () => {
    describe("#when the model attempts to call a tool on a normal turn", () => {
      test("#then allows the tool call so transient SDK failures cannot brick normal turns", async () => {
        setMainSession("main-session")
        const client: BtwToolGuardClient = {
          session: {
            get: mock(async () => ({ data: {} })),
            messages: mock(async () => {
              throw new Error("transient SDK failure")
            }),
          },
        }

        await expectHookToAllow(client)
      })
    })
  })
})
