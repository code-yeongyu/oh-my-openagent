import { afterEach, describe, expect, it, mock } from "bun:test"

import { unsafeTestValue } from "../../../../../test-support/unsafe-test-value"
import {
  BTW_BOUNDARY_SENTINEL,
  BTW_BOUNDARY_TEXT,
  btwBoundaryMessageID,
  createBtwSideContextInjectorHook,
} from "./context-injector"
import {
  BTW_SIDE_METADATA_KEY,
  createBtwSideMetadata,
} from "./metadata"
import { resetBtwSideSessionRegistryForTesting } from "./server-session-registry"

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
  parentMessages: () => TestMessage[]
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
      messages: mock(async () => ({
        data: args.parentMessages(),
      })),
    },
  }
}

describe("btw boundary front-load and parent snapshot pinning", () => {
  afterEach(() => {
    resetBtwSideSessionRegistryForTesting()
  })

  it("#given a side session #when messages transform runs #then the pinned boundary message is the first stable content", async () => {
    // given
    const parentSessionID = "ses_parent_front"
    const sideSessionID = "ses_side_front"
    const client = createClient({
      sideSessionID,
      parentSessionID,
      boundaryMessageID: "msg_parent_2",
      parentMessages: () => [
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
      ],
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
          text: "what changed?",
        }),
      ],
    })

    // when
    await hook["experimental.chat.messages.transform"]!({}, output)

    // then
    const messages = output.messages as TestMessage[]
    expect(messages[0].info.id).toBe(btwBoundaryMessageID(sideSessionID))
    expect(messages[0].info.role).toBe("user")
    expect(messages[0].parts).toHaveLength(1)
    expect(messages[0].parts[0].text).toBe(BTW_BOUNDARY_TEXT)
    expect(messages.map((message) => message.info.id)).toEqual([
      btwBoundaryMessageID(sideSessionID),
      "msg_parent_1",
      "msg_parent_2",
      "msg_side_1",
    ])
    const allText = messages.flatMap((message) =>
      message.parts.map((part) => part.text),
    )
    expect(
      allText.filter((text: string) => text.includes(BTW_BOUNDARY_SENTINEL)),
    ).toHaveLength(1)
  })

  it("#given parent growth across turns #when the second turn transforms #then the boundary stays first and the parent snapshot bytes are pinned", async () => {
    // given
    const parentSessionID = "ses_parent_grow"
    const sideSessionID = "ses_side_grow"
    let parentStore: TestMessage[] = [
      createMessage({
        id: "msg_parent_1",
        sessionID: parentSessionID,
        role: "user",
        text: "stable parent context",
      }),
      createMessage({
        id: "msg_parent_2",
        sessionID: parentSessionID,
        role: "assistant",
        text: "first answer",
        completed: true,
      }),
    ]
    const client = createClient({
      sideSessionID,
      parentSessionID,
      boundaryMessageID: "msg_parent_2",
      parentMessages: () => parentStore,
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
    const firstParentBytes = JSON.stringify(
      (firstTurn.messages as TestMessage[]).filter(
        (message) => message.info.sessionID === parentSessionID,
      ),
    )

    // parent grows after the snapshot was pinned
    parentStore = [
      ...parentStore,
      createMessage({
        id: "msg_parent_3",
        sessionID: parentSessionID,
        role: "user",
        text: "later parent growth that must not mutate the side prefix",
      }),
    ]
    const secondTurn = unsafeTestValue({
      messages: [
        createMessage({
          id: "msg_side_1",
          sessionID: sideSessionID,
          role: "user",
          text: "first question",
        }),
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
    const messages = secondTurn.messages as TestMessage[]
    expect(messages[0].info.id).toBe(btwBoundaryMessageID(sideSessionID))
    const secondParentBytes = JSON.stringify(
      messages.filter((message) => message.info.sessionID === parentSessionID),
    )
    expect(secondParentBytes).toBe(firstParentBytes)
    expect(secondParentBytes).not.toContain("later parent growth")
    expect(client.session.messages).toHaveBeenCalledTimes(1)
  })
})
