import { describe, expect, it } from "bun:test"
import {
  createDirectoryBoundClient,
  withDirectoryArgs,
  wrapSessionWithDirectory,
} from "./session-directory-injection"

describe("withDirectoryArgs", () => {
  it("adds query.directory when args is undefined", () => {
    // given
    const directory = "/repo/worktree"

    // when
    const next = withDirectoryArgs(undefined, directory)

    // then
    expect(next).toEqual({ query: { directory } })
  })

  it("merges query and preserves existing keys", () => {
    // given
    const directory = "/repo/worktree"

    // when
    const next = withDirectoryArgs(
      { query: { limit: 10 } },
      directory,
    )

    // then
    expect(next).toEqual({ query: { limit: 10, directory } })
  })

  it("preserves caller-provided query.directory", () => {
    // given
    const input = { query: { directory: "/explicit", limit: 5 } }

    // when
    const next = withDirectoryArgs(input, "/ignored")

    // then
    expect(next).toBe(input)
  })

  it("overwrites malformed query with a directory-only object", () => {
    // given
    const directory = "/repo/worktree"
    const input = { query: "not-an-object" as unknown as Record<string, unknown> }

    // when
    const next = withDirectoryArgs(input, directory)

    // then
    expect(next).toEqual({ query: { directory } })
  })
})

describe("wrapSessionWithDirectory", () => {
  it("injects query.directory only for allowlisted methods", () => {
    // given
    const calls: Record<string, unknown[]> = {}
    const session = {
      get: (args?: unknown) => {
        calls.get = [args]
        return args
      },
      status: (args?: unknown) => {
        calls.status = [args]
        return args
      },
    }

    const wrapped = wrapSessionWithDirectory(session, "/repo/worktree", new Set(["get"]))

    // when
    wrapped.get({ query: { limit: 1 } })
    wrapped.status({ query: { limit: 1 } })

    // then
    expect(calls.get[0]).toEqual({ query: { limit: 1, directory: "/repo/worktree" } })
    expect(calls.status[0]).toEqual({ query: { limit: 1 } })
  })

  it("does not override caller-provided query.directory", () => {
    // given
    let seen: unknown
    const session = {
      get: (args?: unknown) => {
        seen = args
        return args
      },
    }

    const wrapped = wrapSessionWithDirectory(session, "/repo/worktree", new Set(["get"]))

    // when
    wrapped.get({ query: { directory: "/explicit" } })

    // then
    expect(seen).toEqual({ query: { directory: "/explicit" } })
  })
})

describe("createDirectoryBoundClient", () => {
  it("returns the original client when session is missing", () => {
    // given
    const client: { foo: number; session?: unknown } = { foo: 1 }

    // when
    const next = createDirectoryBoundClient(client, "/repo/worktree")

    // then
    expect(next).toBe(client)
  })

  it("does not mutate the original client and wraps session methods", () => {
    // given
    let seen: unknown
    const client = {
      session: {
        get: (args?: unknown) => {
          seen = args
          return args
        },
      },
      other: 123,
    }

    // when
    const next = createDirectoryBoundClient(client, "/repo/worktree")

    // then
    expect(next).not.toBe(client)
    expect(next.other).toBe(123)
    expect(next.session).not.toBe(client.session)

    next.session.get({ query: { limit: 3 } })
    expect(seen).toEqual({ query: { limit: 3, directory: "/repo/worktree" } })
  })
})
