import { describe, expect, test } from "bun:test"
import { createLiveThreadSurface, resolveThreadSocket } from "./live-surface"

describe("live thread socket discovery", () => {
  test("uses the operator socket override first", () => {
    const old = process.env.SENPI_RPC_SOCKET
    process.env.SENPI_RPC_SOCKET = "/tmp/override.sock"
    try { expect(resolveThreadSocket(() => "/tmp/agent")).toBe("/tmp/override.sock") } finally { if (old === undefined) delete process.env.SENPI_RPC_SOCKET; else process.env.SENPI_RPC_SOCKET = old }
  })
  test("uses Senpi getAgentDir fallback with agent segment", () => {
    const old = process.env.SENPI_RPC_SOCKET
    delete process.env.SENPI_RPC_SOCKET
    try { expect(resolveThreadSocket(() => "/Users/test/.omo/agent")).toBe("/Users/test/.omo/agent/rpc/rpc.sock") } finally { if (old !== undefined) process.env.SENPI_RPC_SOCKET = old }
  })
  test("returns undefined when the discovered socket is absent", () => {
    const old = process.env.SENPI_RPC_SOCKET
    process.env.SENPI_RPC_SOCKET = "/definitely/missing/thread.sock"
    try { expect(createLiveThreadSurface({} as never)).toBeUndefined() } finally { if (old === undefined) delete process.env.SENPI_RPC_SOCKET; else process.env.SENPI_RPC_SOCKET = old }
  })
})
