import { describe, it, expect, mock, spyOn } from "bun:test"
import type { RunContext, Todo, ChildSession, SessionStatus } from "./types"

const createMockContext = (overrides: {
  todo?: Todo[]
  childrenBySession?: Record<string, ChildSession[]>
  statuses?: Record<string, SessionStatus>
} = {}): RunContext => {
  const {
    todo = [],
    childrenBySession = { "test-session": [] },
    statuses = {},
  } = overrides

  return {
    client: {
      session: {
        todo: mock(() => Promise.resolve({ data: todo })),
        children: mock((opts: { path: { id: string } }) =>
          Promise.resolve({ data: childrenBySession[opts.path.id] ?? [] })
        ),
        status: mock(() => Promise.resolve({ data: statuses })),
      },
    } as unknown as RunContext["client"],
    sessionID: "test-session",
    directory: "/test",
    abortController: new AbortController(),
  }
}

describe("checkCompletionConditions", () => {
  it("returns true when no todos and no children", async () => {
    // #given
    spyOn(console, "log").mockImplementation(() => {})
    const ctx = createMockContext()
    const { checkCompletionConditions } = await import("./completion")

    // #when
    const result = await checkCompletionConditions(ctx)

    // #then
    expect(result).toBe(true)
  })

  it("returns false when incomplete todos exist", async () => {
    // #given
    spyOn(console, "log").mockImplementation(() => {})
    const ctx = createMockContext({
      todo: [
        { id: "1", content: "Done", status: "completed", priority: "high" },
        { id: "2", content: "WIP", status: "in_progress", priority: "high" },
      ],
    })
    const { checkCompletionConditions } = await import("./completion")

    // #when
    const result = await checkCompletionConditions(ctx)

    // #then
    expect(result).toBe(false)
  })

  it("returns true when all todos completed or cancelled", async () => {
    // #given
    spyOn(console, "log").mockImplementation(() => {})
    const ctx = createMockContext({
      todo: [
        { id: "1", content: "Done", status: "completed", priority: "high" },
        { id: "2", content: "Skip", status: "cancelled", priority: "medium" },
      ],
    })
    const { checkCompletionConditions } = await import("./completion")

    // #when
    const result = await checkCompletionConditions(ctx)

    // #then
    expect(result).toBe(true)
  })

  it("returns false when child session is busy", async () => {
    // #given
    spyOn(console, "log").mockImplementation(() => {})
    const ctx = createMockContext({
      childrenBySession: {
        "test-session": [{ id: "child-1" }],
        "child-1": [],
      },
      statuses: { "child-1": { type: "busy" } },
    })
    const { checkCompletionConditions } = await import("./completion")

    // #when
    const result = await checkCompletionConditions(ctx)

    // #then
    expect(result).toBe(false)
  })

  it("returns true when all children idle", async () => {
    // #given
    spyOn(console, "log").mockImplementation(() => {})
    const ctx = createMockContext({
      childrenBySession: {
        "test-session": [{ id: "child-1" }, { id: "child-2" }],
        "child-1": [],
        "child-2": [],
      },
      statuses: {
        "child-1": { type: "idle" },
        "child-2": { type: "idle" },
      },
    })
    const { checkCompletionConditions } = await import("./completion")

    // #when
    const result = await checkCompletionConditions(ctx)

    // #then
    expect(result).toBe(true)
  })

  it("returns false when grandchild is busy (recursive)", async () => {
    // #given
    spyOn(console, "log").mockImplementation(() => {})
    const ctx = createMockContext({
      childrenBySession: {
        "test-session": [{ id: "child-1" }],
        "child-1": [{ id: "grandchild-1" }],
        "grandchild-1": [],
      },
      statuses: {
        "child-1": { type: "idle" },
        "grandchild-1": { type: "busy" },
      },
    })
    const { checkCompletionConditions } = await import("./completion")

    // #when
    const result = await checkCompletionConditions(ctx)

    // #then
    expect(result).toBe(false)
  })

  it("returns true when all descendants idle (recursive)", async () => {
    // #given
    spyOn(console, "log").mockImplementation(() => {})
    const ctx = createMockContext({
      childrenBySession: {
        "test-session": [{ id: "child-1" }],
        "child-1": [{ id: "grandchild-1" }],
        "grandchild-1": [{ id: "great-grandchild-1" }],
        "great-grandchild-1": [],
      },
      statuses: {
        "child-1": { type: "idle" },
        "grandchild-1": { type: "idle" },
        "great-grandchild-1": { type: "idle" },
      },
    })
    const { checkCompletionConditions } = await import("./completion")

    // #when
    const result = await checkCompletionConditions(ctx)

    // #then
    expect(result).toBe(true)
  })
})
