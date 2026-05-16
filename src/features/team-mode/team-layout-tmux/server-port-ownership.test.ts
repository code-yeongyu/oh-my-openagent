/// <reference types="bun-types" />

import { describe, expect, it } from "bun:test"
import { detectServerPortOwnership, type ServerPortOwnershipDeps } from "./server-port-ownership"

// /proc/net/tcp header line
const TCP_HEADER =
  "  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n"

// Build a single /proc/net/tcp row. state defaults to "0A" (LISTEN).
function tcpRow(localAddr: string, state = "0A"): string {
  return `   0: ${localAddr} 00000000:0000 ${state} 00000000:00000000 00:00000000 00000000 1000        0 12345 1 0000000000000000 100 0 0 10 0\n`
}

function makeDeps(files: Record<string, string>): ServerPortOwnershipDeps {
  return {
    readFile: async (path: string) => {
      if (Object.prototype.hasOwnProperty.call(files, path)) {
        return files[path]!
      }
      const err = Object.assign(new Error(`ENOENT: no such file or directory, open '${path}'`), {
        code: "ENOENT",
      })
      throw err
    },
  }
}

describe("detectServerPortOwnership", () => {
  const pid = 99999

  it("returns hasOwnPort:true with decoded port when one LISTEN socket exists on 127.0.0.1", async () => {
    // 0100007F:1F90 → 127.0.0.1:8080 (0x1F90 = 8080)
    const content = TCP_HEADER + tcpRow("0100007F:1F90")
    const deps = makeDeps({ [`/proc/${pid}/net/tcp`]: content })

    const result = await detectServerPortOwnership({ pid, deps })

    expect(result.hasOwnPort).toBe(true)
    expect(result.port).toBe(0x1f90) // 8080
  })

  it("returns hasOwnPort:false with reason when no LISTEN socket exists", async () => {
    // state 01 = ESTABLISHED, not a LISTEN socket
    const content = TCP_HEADER + tcpRow("0100007F:1F90", "01")
    const deps = makeDeps({
      [`/proc/${pid}/net/tcp`]: content,
      [`/proc/${pid}/net/tcp6`]: TCP_HEADER, // empty — no rows
    })

    const result = await detectServerPortOwnership({ pid, deps })

    expect(result.hasOwnPort).toBe(false)
    expect(result.reason).toContain("no LISTEN socket")
  })

  it("returns hasOwnPort:true with a port when multiple LISTEN sockets exist", async () => {
    // Two LISTEN sockets: 0100007F:1F90 (8080) and 00000000:2000 (8192)
    const content =
      TCP_HEADER + tcpRow("0100007F:1F90") + "   1: 00000000:2000 00000000:0000 0A 00000000:00000000 00:00000000 00000000 1000        0 12346 1 0000000000000000 100 0 0 10 0\n"
    const deps = makeDeps({ [`/proc/${pid}/net/tcp`]: content })

    const result = await detectServerPortOwnership({ pid, deps })

    expect(result.hasOwnPort).toBe(true)
    // Must return one of the two ports (cast away undefined to satisfy toContain overload)
    expect([0x1f90, 0x2000]).toContain(result.port as number)
  })

  it("returns hasOwnPort:false with path-specific reason when /proc tcp file is not found", async () => {
    // No files → readFile throws ENOENT for every path
    const deps = makeDeps({})

    const result = await detectServerPortOwnership({ pid, deps })

    expect(result.hasOwnPort).toBe(false)
    expect(result.reason).toMatch(/\/proc\/\d+\/net\/tcp not found/)
  })

  // #4071 finding 1: simulate macOS from a Linux runner via injected platform dep.
  // With injected readFile present, the deps path must be consulted BEFORE the
  // platform fallback so the parsing path is exercisable on any host.
  it("on simulated darwin with injected readFile → parses normally (does NOT short-circuit to 'assume ownership')", async () => {
    const content = TCP_HEADER + tcpRow("0100007F:1F90")
    const deps: ServerPortOwnershipDeps = {
      readFile: async (path: string) => {
        if (path === `/proc/${pid}/net/tcp`) return content
        const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" })
        throw err
      },
      getPlatform: () => "darwin",
    }

    const result = await detectServerPortOwnership({ pid, deps })

    expect(result.hasOwnPort).toBe(true)
    expect(result.port).toBe(0x1f90)
    expect(result.reason).toBeUndefined()
  })

  it("on simulated darwin when injected readFile raises ENOENT → falls back to 'assume ownership'", async () => {
    const deps: ServerPortOwnershipDeps = {
      readFile: async () => {
        const err = Object.assign(new Error("ENOENT"), { code: "ENOENT" })
        throw err
      },
      getPlatform: () => "darwin",
    }

    const result = await detectServerPortOwnership({ pid, deps })

    expect(result.hasOwnPort).toBe(true)
    expect(result.reason).toMatch(/platform unsupported/)
  })

  // #4071 finding 2: ownership anchored to the actual OpenCode server URL port.
  it("with expectedPort matching a parsed LISTEN port → returns hasOwnPort:true with that port", async () => {
    const content =
      TCP_HEADER +
      tcpRow("0100007F:1F90") +
      "   1: 00000000:2000 00000000:0000 0A 00000000:00000000 00:00000000 00000000 1000        0 12346 1 0000000000000000 100 0 0 10 0\n"
    const deps = makeDeps({ [`/proc/${pid}/net/tcp`]: content })

    const result = await detectServerPortOwnership({ pid, expectedPort: 0x2000, deps })

    expect(result.hasOwnPort).toBe(true)
    expect(result.port).toBe(0x2000)
  })

  it("with expectedPort NOT matching any parsed LISTEN port → returns hasOwnPort:false naming the expected port", async () => {
    const content = TCP_HEADER + tcpRow("0100007F:1F90")
    const deps = makeDeps({ [`/proc/${pid}/net/tcp`]: content })

    const result = await detectServerPortOwnership({ pid, expectedPort: 9999, deps })

    expect(result.hasOwnPort).toBe(false)
    expect(result.reason).toContain("9999")
  })
})
