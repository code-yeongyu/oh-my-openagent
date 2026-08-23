import { describe, expect, it, mock } from "bun:test"

import { BTW_SIDE_METADATA_KEY } from "./metadata"
import {
  classifyBtwSessionCatalog,
  loadBtwSessionCatalog,
  type BtwCatalogSession,
} from "./tui-session-catalog"

function session(input: {
  id: string
  title?: string
  created: number
  updated?: number
  parentSessionID?: string
}): BtwCatalogSession {
  return {
    id: input.id,
    title: input.title ?? input.id,
    time: {
      created: input.created,
      updated: input.updated ?? input.created,
    },
    ...(input.parentSessionID
      ? {
          metadata: {
            [BTW_SIDE_METADATA_KEY]: {
              version: 1,
              parent_session_id: input.parentSessionID,
              boundary_message_id: "msg_boundary",
            },
          },
        }
      : {}),
  }
}

describe("loadBtwSessionCatalog", () => {
  it("#given a full first response #when the catalog loads #then it widens the limit until every retained side is visible", async () => {
    // given
    const sessions = [
      session({ id: "ses_parent", created: 1 }),
      session({
        id: "ses_side_1",
        created: 2,
        parentSessionID: "ses_parent",
      }),
      session({
        id: "ses_side_2",
        created: 3,
        parentSessionID: "ses_parent",
      }),
    ]
    const listSessions = mock(async ({ limit }: { limit: number }) => ({
      data: sessions.slice(0, limit),
    }))

    // when
    const result = await loadBtwSessionCatalog({
      currentSessionID: "ses_parent",
      directory: "/tmp/project",
      listSessions,
      initialLimit: 2,
      maximumLimit: 8,
    })

    // then
    expect(listSessions.mock.calls.map(([input]) => input.limit)).toEqual([
      2,
      4,
    ])
    expect(result.catalog?.sides.map((side) => side.id)).toEqual([
      "ses_side_1",
      "ses_side_2",
    ])
    expect(result.truncated).toBe(false)
  })

  it("#given a full maximum response #when the catalog loads #then it reports possible truncation", async () => {
    // given
    const sessions = Array.from({ length: 4 }, (_, index) =>
      session({
        id: index === 0 ? "ses_parent" : `ses_side_${index}`,
        created: index,
        ...(index > 0 ? { parentSessionID: "ses_parent" } : {}),
      }),
    )

    // when
    const result = await loadBtwSessionCatalog({
      currentSessionID: "ses_parent",
      directory: "/tmp/project",
      listSessions: async ({ limit }) => ({
        data: sessions.slice(0, limit),
      }),
      initialLimit: 2,
      maximumLimit: 4,
    })

    // then
    expect(result.truncated).toBe(true)
  })
})

describe("classifyBtwSessionCatalog", () => {
  it("#given mixed metadata rows #when a parent catalog is classified #then only valid matching sides remain oldest first", () => {
    // given
    const sessions = [
      session({ id: "ses_parent", created: 1 }),
      session({
        id: "ses_side_newer",
        title: "BTW · newer",
        created: 30,
        updated: 100,
        parentSessionID: "ses_parent",
      }),
      session({
        id: "ses_side_older",
        title: "BTW · older",
        created: 20,
        updated: 200,
        parentSessionID: "ses_parent",
      }),
      session({ id: "ses_other_parent", created: 2 }),
      session({
        id: "ses_other_side",
        created: 3,
        parentSessionID: "ses_other_parent",
      }),
      {
        ...session({ id: "ses_invalid", created: 4 }),
        metadata: {
          [BTW_SIDE_METADATA_KEY]: {
            version: 99,
            parent_session_id: "ses_parent",
            boundary_message_id: "msg_boundary",
          },
        },
      },
    ]

    // when
    const result = classifyBtwSessionCatalog(sessions, "ses_parent")

    // then
    expect(result?.main.id).toBe("ses_parent")
    expect(result?.sides.map((side) => side.id)).toEqual([
      "ses_side_older",
      "ses_side_newer",
    ])
  })

  it("#given a retained side route #when its catalog is classified #then it resolves the original parent scope", () => {
    // given
    const sessions = [
      session({ id: "ses_parent", created: 1 }),
      session({
        id: "ses_side_1",
        created: 2,
        parentSessionID: "ses_parent",
      }),
      session({
        id: "ses_side_2",
        created: 3,
        parentSessionID: "ses_parent",
      }),
    ]

    // when
    const result = classifyBtwSessionCatalog(sessions, "ses_side_2")

    // then
    expect(result?.main.id).toBe("ses_parent")
    expect(result?.sides.map((side) => side.id)).toEqual([
      "ses_side_1",
      "ses_side_2",
    ])
  })

  it("#given a stale side whose parent row is missing #when classified #then no unsafe navigation catalog is returned", () => {
    // given
    const sessions = [
      session({
        id: "ses_orphan",
        created: 2,
        parentSessionID: "ses_missing",
      }),
    ]

    // when
    const result = classifyBtwSessionCatalog(sessions, "ses_orphan")

    // then
    expect(result).toBeUndefined()
  })
})
