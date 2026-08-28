import { describe, expect, test } from "bun:test"
import { createLiveThreadSurface, resolveThreadSocket } from "./live-surface"

describe("live thread socket discovery", () => {
  test("operator override wins", () => {
    expect(resolveThreadSocket({ SENPI_RPC_SOCKET: "/tmp/override.sock" })).toBe("/tmp/override.sock")
  })
  test("canonical and env branches resolve through resolveAgentHome", async () => {
    const { resolveAgentHome } = await import("../agent-home/resolve-agent-home")
    expect(resolveAgentHome({ env: {}, homeDir: "/h", exists: (path) => path === "/h/.omo/agent/settings.json" })).toBe("/h/.omo/agent")
    expect(resolveAgentHome({ env: { OMO_CODING_AGENT_DIR: "/configured" }, homeDir: "/h", exists: () => false })).toBe("/configured")
  })
  test("resolveAgentHome supports flat and standalone fallback", async () => {
    const { resolveAgentHome } = await import("../agent-home/resolve-agent-home")
    expect(resolveAgentHome({ env: {}, homeDir: "/h", exists: (path) => path === "/h/.omo/settings.json" })).toBe("/h/.omo")
    expect(resolveAgentHome({ env: {}, homeDir: "/h", exists: () => false })).toBe("/h/.senpi/agent")
  })
  test("missing socket returns undefined", () => {
    expect(createLiveThreadSurface({} as never)).toBeUndefined()
  })
})
