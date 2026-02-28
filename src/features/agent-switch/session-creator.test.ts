/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { createFreshSession } from "./session-creator"

describe("session-creator", () => {
  describe("#given SDK response with data wrapper", () => {
    test("#when create returns { data: { id } }, #then extracts session ID", async () => {
      const client = {
        session: {
          create: async () => ({ data: { id: "new-session-123" } }),
        },
      }

      const result = await createFreshSession({
        client,
        sourceSessionID: "source-ses",
        targetAgent: "atlas",
      })

      expect(result).toBe("new-session-123")
    })
  })

  describe("#given SDK response without data wrapper", () => {
    test("#when create returns { id } directly, #then extracts session ID", async () => {
      const client = {
        session: {
          create: async () => ({ id: "direct-session-456" }),
        },
      }

      const result = await createFreshSession({
        client,
        sourceSessionID: "source-ses",
        targetAgent: "prometheus",
      })

      expect(result).toBe("direct-session-456")
    })
  })

  describe("#given create not available", () => {
    test("#when session.create is undefined, #then throws", async () => {
      const client = { session: {} }

      await expect(
        createFreshSession({
          client: client as any,
          sourceSessionID: "source-ses",
          targetAgent: "atlas",
        }),
      ).rejects.toThrow("session.create not available")
    })
  })

  describe("#given invalid response", () => {
    test("#when create returns no id, #then throws", async () => {
      const client = {
        session: {
          create: async () => ({ data: {} }),
        },
      }

      await expect(
        createFreshSession({
          client,
          sourceSessionID: "source-ses",
          targetAgent: "atlas",
        }),
      ).rejects.toThrow("failed to extract session ID")
    })
  })

  describe("#given parentID and title", () => {
    test("#when creating session, #then passes sourceSessionID as parentID", async () => {
      let capturedInput: Record<string, unknown> | undefined
      const client = {
        session: {
          create: async (input?: { body?: Record<string, unknown> }) => {
            capturedInput = input?.body
            return { id: "new-ses" }
          },
        },
      }

      await createFreshSession({
        client,
        sourceSessionID: "parent-ses-id",
        targetAgent: "atlas",
      })

      expect(capturedInput).toEqual({
        parentID: "parent-ses-id",
        title: "atlas (handoff)",
      })
    })
  })
})
