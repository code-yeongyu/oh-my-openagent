import { describe, expect, it } from "bun:test"
import type { Client } from "@modelcontextprotocol/sdk/client/index.js"
import { discoverValidAgentType, waitForIndexReady } from "./mcb-roundtrip-helpers"

const FAKE_CLIENT = {} as Client

describe("mcb-integration/mcb-roundtrip-helpers", () => {
  //#given session create attempts with failing then successful candidate
  //#when discoverValidAgentType probes candidates
  //#then it returns the first working candidate
  it("returns first successful agent_type candidate", async () => {
    const seenCandidates: string[] = []
    const discovered = await discoverValidAgentType(FAKE_CLIENT, {
      candidates: ["alpha", "beta", "gamma"],
      callTool: async (_client, _name, args) => {
        seenCandidates.push(String(args.agent_type ?? ""))
        return { content: [{ type: "text", text: "ok" }], isError: args.agent_type !== "gamma" }
      },
    })

    expect(discovered).toBe("gamma")
    expect(seenCandidates).toEqual(["alpha", "beta", "gamma"])
  })

  //#given all session create attempts fail
  //#when discoverValidAgentType probes candidates
  //#then it returns null
  it("returns null when no agent_type candidate succeeds", async () => {
    const discovered = await discoverValidAgentType(FAKE_CLIENT, {
      candidates: ["alpha", "beta"],
      callTool: async () => ({ content: [{ type: "text", text: "invalid" }], isError: true }),
    })

    expect(discovered).toBeNull()
  })

  //#given index status reports completion
  //#when waitForIndexReady polls status
  //#then it returns true
  it("returns true when status includes ready keyword", async () => {
    const ready = await waitForIndexReady(FAKE_CLIENT, "test-collection", {
      intervalMs: 1,
      maxWaitMs: 50,
      callTool: async () => ({ content: [{ type: "text", text: "Indexing Status: Complete" }], isError: false }),
    })

    expect(ready).toBe(true)
  })

  //#given index status transitions from running to idle
  //#when waitForIndexReady polls status
  //#then it returns true after progress is observed
  it("returns true after observing active state then idle", async () => {
    let callCount = 0
    const ready = await waitForIndexReady(FAKE_CLIENT, "test-collection", {
      intervalMs: 1,
      maxWaitMs: 100,
      callTool: async () => {
        callCount += 1
        if (callCount === 1) {
          return { content: [{ type: "text", text: "Indexing Status: Running" }], isError: false }
        }
        return { content: [{ type: "text", text: "Indexing Status: Idle" }], isError: false }
      },
    })

    expect(ready).toBe(true)
    expect(callCount).toBeGreaterThanOrEqual(2)
  })

  //#given index status never becomes ready
  //#when waitForIndexReady polls until timeout
  //#then it returns false
  it("returns false on timeout", async () => {
    const ready = await waitForIndexReady(FAKE_CLIENT, "test-collection", {
      intervalMs: 1,
      maxWaitMs: 10,
      callTool: async () => ({ content: [{ type: "text", text: "Indexing Status: Running" }], isError: false }),
    })

    expect(ready).toBe(false)
  })
})
