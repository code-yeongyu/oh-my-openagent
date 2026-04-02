import { describe, it, expect, beforeEach } from "bun:test"
import { ZellijAdapter } from "./zellij-adapter"

const mockConfig = { enabled: true }

function makeTrackingSpawn() {
  const calls: string[][] = []
  const encoder = new TextEncoder()
  const fn = (args: string[]) => {
    calls.push([...args])
    const isCat = args[0] === "cat"
    const content = isCat ? "%1\n" : ""
    return {
      exited: Promise.resolve(0),
      stdout: new ReadableStream({ start(c) { if (content) c.enqueue(encoder.encode(content)); c.close() } }),
      stderr: new ReadableStream({ start(c) { c.close() } }),
    }
  }
  return { calls, fn: fn as unknown as typeof Bun.spawn }
}

describe("ZellijAdapter pane stacking and naming", () => {
  describe("anchor pane (first spawn)", () => {
    it("uses the provided direction flag for the anchor pane", async () => {
      //#given
      const { calls, fn } = makeTrackingSpawn()
      const adapter = new ZellijAdapter(mockConfig, undefined, fn)

      //#when
      await adapter.spawnPane("echo cmd", { label: "pane-1", direction: "horizontal" })

      //#then the new-pane call should include -d right
      const newPaneCall = calls.find(args => args[2] === "new-pane")
      expect(newPaneCall).toBeDefined()
      expect(newPaneCall).toContain("-d")
      expect(newPaneCall![newPaneCall!.indexOf("-d") + 1]).toBe("right")
    })

    it("defaults to -d down when no direction provided for anchor pane", async () => {
      //#given
      const { calls, fn } = makeTrackingSpawn()
      const adapter = new ZellijAdapter(mockConfig, undefined, fn)

      //#when
      await adapter.spawnPane("echo cmd", { label: "pane-anchor-default" })

      //#then defaults to down
      const newPaneCall = calls.find(args => args[2] === "new-pane")
      expect(newPaneCall).toBeDefined()
      expect(newPaneCall![newPaneCall!.indexOf("-d") + 1]).toBe("down")
    })

    it("uses label as pane name when no displayName provided", async () => {
      //#given
      const { calls, fn } = makeTrackingSpawn()
      const adapter = new ZellijAdapter(mockConfig, undefined, fn)

      //#when
      await adapter.spawnPane("echo cmd", { label: "my-label" })

      //#then -n flag uses label
      const newPaneCall = calls.find(args => args[2] === "new-pane")
      expect(newPaneCall).toBeDefined()
      expect(newPaneCall![newPaneCall!.indexOf("-n") + 1]).toBe("my-label")
    })

    it("uses displayName as pane name when provided", async () => {
      //#given
      const { calls, fn } = makeTrackingSpawn()
      const adapter = new ZellijAdapter(mockConfig, undefined, fn)

      //#when
      await adapter.spawnPane("echo cmd", { label: "ses_abc123", displayName: "Agent: My Task" })

      //#then -n flag uses displayName not label
      const newPaneCall = calls.find(args => args[2] === "new-pane")
      expect(newPaneCall).toBeDefined()
      expect(newPaneCall![newPaneCall!.indexOf("-n") + 1]).toBe("Agent: My Task")
    })
  })

  describe("subsequent panes (stacking)", () => {
    it("always uses -d down for non-anchor panes regardless of direction option", async () => {
      //#given - first pane establishes anchor
      const { calls, fn } = makeTrackingSpawn()
      const adapter = new ZellijAdapter(mockConfig, undefined, fn)
      await adapter.spawnPane("echo first", { label: "anchor-pane" })
      calls.length = 0

      //#when spawning second pane with an explicit different direction
      await adapter.spawnPane("echo second", { label: "stacked-pane", direction: "right" })

      //#then non-anchor pane always uses -d down
      const newPaneCall = calls.find(args => args[2] === "new-pane")
      expect(newPaneCall).toBeDefined()
      expect(newPaneCall).toContain("-d")
      expect(newPaneCall![newPaneCall!.indexOf("-d") + 1]).toBe("down")
    })

    it("calls stack-panes after spawning subsequent pane", async () => {
      //#given - first pane establishes anchor
      const { calls, fn } = makeTrackingSpawn()
      const adapter = new ZellijAdapter(mockConfig, undefined, fn)
      await adapter.spawnPane("echo first", { label: "anchor-pane" })
      calls.length = 0

      //#when spawning second pane
      await adapter.spawnPane("echo second", { label: "second-pane" })

      //#then stack-panes is called to stack with anchor
      const stackCall = calls.find(args => args[2] === "stack-panes")
      expect(stackCall).toBeDefined()
    })

    it("does not call stack-panes for the first pane", async () => {
      //#given fresh adapter (no anchor established yet)
      const { calls, fn } = makeTrackingSpawn()
      const adapter = new ZellijAdapter(mockConfig, undefined, fn)

      //#when spawning only the first pane
      await adapter.spawnPane("echo first", { label: "only-pane" })

      //#then no stack-panes call for anchor pane
      const stackCall = calls.find(args => args[2] === "stack-panes")
      expect(stackCall).toBeUndefined()
    })

    it("uses displayName for non-anchor pane name", async () => {
      //#given
      const { calls, fn } = makeTrackingSpawn()
      const adapter = new ZellijAdapter(mockConfig, undefined, fn)
      await adapter.spawnPane("echo first", { label: "anchor" })
      calls.length = 0

      //#when
      await adapter.spawnPane("echo second", { label: "ses_xyz", displayName: "Agent: Search" })

      //#then -n flag uses displayName instead of label
      const newPaneCall = calls.find(args => args[2] === "new-pane")
      expect(newPaneCall).toBeDefined()
      expect(newPaneCall![newPaneCall!.indexOf("-n") + 1]).toBe("Agent: Search")
    })
  })
})
