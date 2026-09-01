import { afterEach, describe, expect, it, mock } from "bun:test"

import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import {
  BTW_BOUNDARY_SENTINEL,
  BTW_PARENT_CONTEXT_MAX_BYTES,
  BTW_PARENT_CONTEXT_MAX_MESSAGES,
  createBtwSideContextInjectorHook,
} from "./context-injector"
import {
  BTW_SIDE_METADATA_KEY,
  createBtwSideMetadata,
} from "./metadata"
import {
  isTrackedBtwSideSession,
  resetBtwSideSessionRegistryForTesting,
} from "./server-session-registry"

type TestPart = {
  id: string
  sessionID: string
  messageID: string
  type: "text"
  text: string
  synthetic?: boolean
}

type TestMessage = {
  info: {
    id: string
    sessionID: string
    role: "user" | "assistant"
    time: {
      created: number
      completed?: number
    }
    agent?: string
    model?: {
      providerID: string
      modelID: string
    }
  }
  parts: TestPart[]
}

function createMessage(args: {
  id: string
  sessionID: string
  role: "user" | "assistant"
  text: string
  completed?: boolean
}): TestMessage {
  return {
    info: {
      id: args.id,
      sessionID: args.sessionID,
      role: args.role,
      time: {
        created: 1,
        ...(args.completed ? { completed: 2 } : {}),
      },
      ...(args.role === "user"
        ? {
            agent: "sisyphus",
            model: {
              providerID: "openai",
              modelID: "gpt-5.4",
            },
          }
        : {}),
    },
    parts: [
      {
        id: `part_${args.id}`,
        sessionID: args.sessionID,
        messageID: args.id,
        type: "text",
        text: args.text,
      },
    ],
  }
}

function createClient(args: {
  sideSessionID: string
  parentSessionID: string
  boundaryMessageID: string
  parentMessages: TestMessage[]
  failMessages?: boolean
}) {
  return {
    session: {
      get: mock(async ({ path }: { path: { id: string } }) => ({
        data:
          path.id === args.sideSessionID
            ? {
                id: args.sideSessionID,
                metadata: {
                  [BTW_SIDE_METADATA_KEY]: createBtwSideMetadata({
                    parentSessionID: args.parentSessionID,
                    boundaryMessageID: args.boundaryMessageID,
                  }),
                },
              }
            : {
                id: path.id,
              },
      })),
      messages: mock(async () => {
        if (args.failMessages) {
          throw new Error("parent messages unavailable")
        }
        return {
          data: args.parentMessages,
        }
      }),
    },
  }
}

describe("createBtwSideContextInjectorHook", () => {
  afterEach(() => {
    resetBtwSideSessionRegistryForTesting()
  })

  it("#given a normal session #when messages transform runs #then the request is unchanged", async () => {
    // given
    const sessionID = "ses_main"
    const messages = [
      createMessage({
        id: "msg_main",
        sessionID,
        role: "user",
        text: "continue the implementation",
      }),
    ]
    const client = createClient({
      sideSessionID: "ses_side",
      parentSessionID: sessionID,
      boundaryMessageID: "msg_main",
      parentMessages: [],
    })
    const hook = createBtwSideContextInjectorHook({
      client: unsafeTestValue(client),
    })
    const output = unsafeTestValue({ messages })

    // when
    await hook["experimental.chat.messages.transform"]!({}, output)

    // then
    expect(output.messages).toEqual(messages)
    expect(client.session.messages).not.toHaveBeenCalled()
  })

  it("#given a side session #when messages transform runs #then bounded parent context precedes one boundary sentinel", async () => {
    // given
    const parentSessionID = "ses_parent"
    const sideSessionID = "ses_side"
    const parentMessages = [
      createMessage({
        id: "msg_parent_1",
        sessionID: parentSessionID,
        role: "user",
        text: "implement the feature",
      }),
      createMessage({
        id: "msg_parent_2",
        sessionID: parentSessionID,
        role: "assistant",
        text: "working on it",
        completed: true,
      }),
      createMessage({
        id: "msg_parent_3",
        sessionID: parentSessionID,
        role: "assistant",
        text: "newer partial output",
      }),
    ]
    const sideMessages = [
      createMessage({
        id: "msg_side_1",
        sessionID: sideSessionID,
        role: "user",
        text: "what changed?",
      }),
    ]
    const client = createClient({
      sideSessionID,
      parentSessionID,
      boundaryMessageID: "msg_parent_2",
      parentMessages,
    })
    const hook = createBtwSideContextInjectorHook({
      client: unsafeTestValue(client),
    })
    const output = unsafeTestValue({ messages: sideMessages })

    // when
    await hook["experimental.chat.messages.transform"]!({}, output)

    // then
    expect(output.messages.map((message: TestMessage) => message.info.id)).toEqual([
      "msg_parent_1",
      "msg_parent_2",
      "msg_side_1",
    ])
    const allText = output.messages.flatMap((message: TestMessage) =>
      message.parts.map((part) => part.text),
    )
    expect(allText.filter((text: string) => text.includes(BTW_BOUNDARY_SENTINEL))).toHaveLength(1)
    expect(allText).not.toContain("newer partial output")
    const sidePartIDs = output.messages
      .find((message: TestMessage) => message.info.id === "msg_side_1")
      ?.parts.map((part: TestPart) => part.id)
    expect(new Set(sidePartIDs).size).toBe(sidePartIDs?.length)
  })

  it("#given a persisted first side turn #when a second turn transforms #then bounded parent context is injected again", async () => {
    // given
    const parentSessionID = "ses_parent"
    const sideSessionID = "ses_side"
    const parentMessages = [
      createMessage({
        id: "msg_parent_1",
        sessionID: parentSessionID,
        role: "user",
        text: "stable parent context",
      }),
    ]
    const client = createClient({
      sideSessionID,
      parentSessionID,
      boundaryMessageID: "msg_parent_1",
      parentMessages,
    })
    const hook = createBtwSideContextInjectorHook({
      client: unsafeTestValue(client),
    })
    const firstTurn = unsafeTestValue({
      messages: [
        createMessage({
          id: "msg_side_1",
          sessionID: sideSessionID,
          role: "user",
          text: "first question",
        }),
      ],
    })
    await hook["experimental.chat.messages.transform"]!({}, firstTurn)
    const persistedSideMessages = firstTurn.messages.filter(
      (message: TestMessage) => message.info.sessionID === sideSessionID,
    )
    const secondTurn = unsafeTestValue({
      messages: [
        ...persistedSideMessages,
        createMessage({
          id: "msg_side_answer",
          sessionID: sideSessionID,
          role: "assistant",
          text: "first answer",
          completed: true,
        }),
        createMessage({
          id: "msg_side_2",
          sessionID: sideSessionID,
          role: "user",
          text: "second question",
        }),
      ],
    })

    // when
    await hook["experimental.chat.messages.transform"]!({}, secondTurn)

    // then
    expect(secondTurn.messages[0].info.id).toBe("msg_parent_1")
    const boundaryParts = secondTurn.messages.flatMap((message: TestMessage) =>
      message.parts.filter((part) => part.text.includes(BTW_BOUNDARY_SENTINEL)),
    )
    expect(boundaryParts).toHaveLength(1)
    expect(client.session.messages).toHaveBeenCalledTimes(1)
  })

  it("#given a transient metadata error #when the next transform retries #then side context injection recovers", async () => {
    // given
    const parentSessionID = "ses_parent"
    const sideSessionID = "ses_side"
    let metadataAttempts = 0
    const client = {
      session: {
        get: mock(async () => {
          metadataAttempts += 1
          if (metadataAttempts === 1) {
            return {
              error: {
                name: "TemporaryError",
              },
            }
          }
          return {
            data: {
              id: sideSessionID,
              metadata: {
                [BTW_SIDE_METADATA_KEY]: createBtwSideMetadata({
                  parentSessionID,
                  boundaryMessageID: "msg_parent_1",
                }),
              },
            },
          }
        }),
        messages: mock(async () => ({
          data: [
            createMessage({
              id: "msg_parent_1",
              sessionID: parentSessionID,
              role: "user",
              text: "recovered parent context",
            }),
          ],
        })),
      },
    }
    const hook = createBtwSideContextInjectorHook({
      client: unsafeTestValue(client),
    })
    const firstOutput = unsafeTestValue({
      messages: [
        createMessage({
          id: "msg_side_1",
          sessionID: sideSessionID,
          role: "user",
          text: "first attempt",
        }),
      ],
    })
    const secondOutput = unsafeTestValue({
      messages: [
        createMessage({
          id: "msg_side_2",
          sessionID: sideSessionID,
          role: "user",
          text: "second attempt",
        }),
      ],
    })
    await hook["experimental.chat.messages.transform"]!({}, firstOutput)
    expect(isTrackedBtwSideSession(sideSessionID)).toBe(true)
    expect(firstOutput.messages[0].info.id).toBe("msg_parent_1")
    expect(metadataAttempts).toBe(2)

    // when
    await hook["experimental.chat.messages.transform"]!({}, secondOutput)

    // then
    expect(firstOutput.messages).toHaveLength(2)
    expect(secondOutput.messages[0].info.id).toBe("msg_parent_1")
    expect(metadataAttempts).toBe(2)
    expect(isTrackedBtwSideSession(sideSessionID)).toBe(true)
  })

  it("#given a transient normal-session metadata error #when immediate retry confirms no BTW metadata #then the turn remains unrestricted", async () => {
    // given
    const sessionID = "ses_normal"
    let attempts = 0
    const hook = createBtwSideContextInjectorHook({
      client: unsafeTestValue({
        session: {
          get: async () => {
            attempts += 1
            return attempts === 1
              ? { error: { name: "TemporaryError" } }
              : { data: { id: sessionID } }
          },
        },
      }),
    })
    const output = () =>
      unsafeTestValue({
        messages: [
          createMessage({
            id: `msg_${attempts}`,
            sessionID,
            role: "user",
            text: "normal request",
          }),
        ],
      })

    // when
    await hook["experimental.chat.messages.transform"]!({}, output())

    // then
    expect(isTrackedBtwSideSession(sessionID)).toBe(false)
    expect(attempts).toBe(2)
  })

  it("#given persistent metadata errors #when a request cannot be classified #then the turn is rejected before tools or idle", async () => {
    // given
    const sessionID = "ses_unclassified"
    const hook = createBtwSideContextInjectorHook({
      client: unsafeTestValue({
        session: {
          get: async () => ({
            error: {
              name: "TemporaryError",
            },
          }),
        },
      }),
    })
    const output = unsafeTestValue({
      messages: [
        createMessage({
          id: "msg_unclassified",
          sessionID,
          role: "user",
          text: "do not run unclassified",
        }),
      ],
    })

    // when
    const transform =
      hook["experimental.chat.messages.transform"]!({}, output)

    // then
    await expect(transform).rejects.toThrow(
      "Unable to classify session for BTW isolation.",
    )
    expect(isTrackedBtwSideSession(sessionID)).toBe(false)
  })

  it("#given a parent request #when a side session exists #then side messages never enter the parent", async () => {
    // given
    const parentSessionID = "ses_parent"
    const parentRequest = [
      createMessage({
        id: "msg_parent_1",
        sessionID: parentSessionID,
        role: "user",
        text: "keep working",
      }),
    ]
    const client = createClient({
      sideSessionID: "ses_side",
      parentSessionID,
      boundaryMessageID: "msg_parent_1",
      parentMessages: [
        createMessage({
          id: "msg_side_secret",
          sessionID: "ses_side",
          role: "user",
          text: "private side question",
        }),
      ],
    })
    const hook = createBtwSideContextInjectorHook({
      client: unsafeTestValue(client),
    })
    const output = unsafeTestValue({ messages: parentRequest })

    // when
    await hook["experimental.chat.messages.transform"]!({}, output)

    // then
    expect(output.messages).toEqual(parentRequest)
    expect(JSON.stringify(output.messages)).not.toContain("private side question")
  })

  it("#given parent context cannot be read #when the side request transforms #then the side request remains usable", async () => {
    // given
    const sideSessionID = "ses_side"
    const sideMessages = [
      createMessage({
        id: "msg_side_1",
        sessionID: sideSessionID,
        role: "user",
        text: "answer without inherited context",
      }),
    ]
    const client = createClient({
      sideSessionID,
      parentSessionID: "ses_parent",
      boundaryMessageID: "msg_parent_1",
      parentMessages: [],
      failMessages: true,
    })
    const hook = createBtwSideContextInjectorHook({
      client: unsafeTestValue(client),
    })
    const output = unsafeTestValue({ messages: sideMessages })

    // when
    await hook["experimental.chat.messages.transform"]!({}, output)

    // then
    expect(output.messages).toEqual(sideMessages)
    expect(output.messages[0].parts[0].text).toContain(
      BTW_BOUNDARY_SENTINEL,
    )
    expect(output.messages[0].parts[1].text).toBe(
      "answer without inherited context",
    )
  })

  it("#given an oversized parent prefix #when a side request transforms #then inherited context stays within byte and message budgets", async () => {
    // given
    const sideSessionID = "ses_side"
    const parentSessionID = "ses_parent"
    const parentMessages = Array.from({ length: 100 }, (_, index) =>
      createMessage({
        id: `msg_parent_${index}`,
        sessionID: parentSessionID,
        role: index % 2 === 0 ? "user" : "assistant",
        text: `${index}:${"x".repeat(4096)}`,
      }),
    )
    Object.assign(parentMessages[99].info, {
      system: "s".repeat(BTW_PARENT_CONTEXT_MAX_BYTES * 2),
    })
    const boundaryMessageID = "msg_parent_99"
    const client = createClient({
      sideSessionID,
      parentSessionID,
      boundaryMessageID,
      parentMessages,
    })
    const hook = createBtwSideContextInjectorHook({
      client: unsafeTestValue(client),
    })
    const output = unsafeTestValue({
      messages: [
        createMessage({
          id: "msg_side_1",
          sessionID: sideSessionID,
          role: "user",
          text: "use bounded context",
        }),
      ],
    })

    // when
    await hook["experimental.chat.messages.transform"]!({}, output)

    // then
    const inherited = output.messages.filter(
      (message: TestMessage) => message.info.sessionID === parentSessionID,
    )
    const inheritedBytes = new TextEncoder().encode(
      JSON.stringify(inherited),
    ).byteLength
    expect(inherited.length).toBeLessThanOrEqual(
      BTW_PARENT_CONTEXT_MAX_MESSAGES,
    )
    expect(inheritedBytes).toBeLessThanOrEqual(
      BTW_PARENT_CONTEXT_MAX_BYTES,
    )
    expect(inherited.at(-1)?.info.id).toBe(boundaryMessageID)
  })
})
