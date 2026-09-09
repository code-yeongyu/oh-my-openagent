import { describe, expect, test } from "bun:test"
import { join, resolve } from "node:path"
import { createLiveThreadSurface, resolveThreadSocket } from "./live-surface"

describe("live thread socket discovery", () => {
  test("operator override wins", () => {
    expect(resolveThreadSocket({ SENPI_RPC_SOCKET: "/tmp/override.sock" })).toBe("/tmp/override.sock")
  })
  test("#given the desktop's OMO_RPC_SOCKET_PATH #when no engine RPC_SOCKET is set #then the desktop host socket is used", () => {
    expect(resolveThreadSocket({ OMO_RPC_SOCKET_PATH: "/h/.omo/agent/rpc-desktop/rpc.sock", OMO_CODING_AGENT_DIR: "/h/.omo/agent" })).toBe("/h/.omo/agent/rpc-desktop/rpc.sock")
  })
  test("#given brand and legacy RPC_SOCKET names #when several are set #then the brand name wins and blanks are skipped", () => {
    expect(resolveThreadSocket({ OMO_RPC_SOCKET: "/brand.sock", SENPI_RPC_SOCKET: "/legacy.sock", OMO_RPC_SOCKET_PATH: "/desktop.sock" })).toBe("/brand.sock")
    expect(resolveThreadSocket({ OMO_RPC_SOCKET: "  ", PI_RPC_SOCKET: "/pi.sock", OMO_RPC_SOCKET_PATH: "/desktop.sock" })).toBe("/pi.sock")
    expect(resolveThreadSocket({ OMO_CODING_AGENT_DIR: "/configured" })).toBe(join(resolve("/configured"), "rpc", "rpc.sock"))
  })
  test("canonical and env branches resolve through resolveAgentHome", async () => {
    const { resolveAgentHome } = await import("../agent-home/resolve-agent-home")
    const canonical = join("/h", ".omo", "agent")
    expect(resolveAgentHome({ env: {}, homeDir: "/h", exists: (path) => path === join(canonical, "settings.json") })).toBe(canonical)
    expect(resolveAgentHome({ env: { OMO_CODING_AGENT_DIR: "/configured" }, homeDir: "/h", exists: () => false })).toBe(resolve("/configured"))
  })
  test("resolveAgentHome supports flat and standalone fallback", async () => {
    const { resolveAgentHome } = await import("../agent-home/resolve-agent-home")
    const flat = join("/h", ".omo")
    expect(resolveAgentHome({ env: {}, homeDir: "/h", exists: (path) => path === join(flat, "settings.json") })).toBe(flat)
    expect(resolveAgentHome({ env: {}, homeDir: "/h", exists: () => false })).toBe(join("/h", ".senpi", "agent"))
  })
  test("always constructs a surface when the socket is absent at registration", () => {
    expect(createLiveThreadSurface({} as never, { env: { SENPI_RPC_SOCKET: "/missing.sock" }, exists: () => false })).toBeDefined()
  })
  test("returns typed host_unavailable when the socket is absent at call time", async () => {
    const surface = createLiveThreadSurface({} as never, { env: { SENPI_RPC_SOCKET: "/missing.sock" }, exists: () => false })
    await expect(surface.listSessions()).rejects.toThrow("host_unavailable:/missing.sock")
  })
})
