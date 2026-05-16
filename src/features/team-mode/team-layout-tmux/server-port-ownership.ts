// Detects whether the current process owns a local LISTEN socket on a
// specific port (when expectedPort is provided) or any local LISTEN socket
// (when expectedPort is omitted).
//
// On Linux, reads /proc/<pid>/net/tcp (and tcp6) to find sockets in state 0A
// (LISTEN) bound to a local interface (127.0.0.1 / 0.0.0.0 / :: / ::1). On
// non-Linux platforms, the real /proc filesystem doesn't exist; readFile
// throws ENOENT and the function falls through to a platform-aware path
// that "assumes ownership" (so macOS/Windows users aren't blocked).
//
// IMPORTANT (#4071 review): tests inject `readFile` via deps to exercise
// the parsing path on any host. The function MUST honor injected deps
// before short-circuiting on platform — otherwise tests on Linux runners
// that simulate macOS by mocking `os.platform()` would never reach the
// parsing logic, and the no-ownership path would never be testable on
// non-Linux CI hosts. The deps-injected readFile is consulted first; only
// when it raises ENOENT (i.e. the real fs has no /proc) does the platform
// fallback trigger.

import { readFile as fsReadFile } from "node:fs/promises"
import { log } from "../../../shared"

export type ServerPortOwnership = {
  hasOwnPort: boolean
  port?: number   // present when hasOwnPort
  reason?: string // present when !hasOwnPort
}

export type ServerPortOwnershipDeps = {
  readFile: (path: string) => Promise<string>
  // Injected so tests can simulate non-Linux platforms without an actual
  // macOS host. Defaults to () => process.platform.
  getPlatform?: () => NodeJS.Platform | string
}

const LISTEN_STATE = "0A"

// IPv4 local addresses in /proc/net/tcp little-endian hex format
const IPV4_LOOPBACK_HEX = "0100007F" // 127.0.0.1
const IPV4_WILDCARD_HEX = "00000000" // 0.0.0.0

// IPv6 local addresses in /proc/net/tcp6 little-endian 128-bit hex format
const IPV6_WILDCARD_HEX = "00000000000000000000000000000000" // ::
const IPV6_LOOPBACK_HEX = "00000000000000000000000001000000" // ::1
const IPV6_MAPPED_LOOPBACK_HEX = "0000000000000000FFFF00000100007F" // ::ffff:127.0.0.1

function isLocalAddress(hexIp: string): boolean {
  return (
    hexIp === IPV4_LOOPBACK_HEX ||
    hexIp === IPV4_WILDCARD_HEX ||
    hexIp === IPV6_WILDCARD_HEX ||
    hexIp === IPV6_LOOPBACK_HEX ||
    hexIp === IPV6_MAPPED_LOOPBACK_HEX
  )
}

function parseTcpListenPorts(content: string): number[] {
  const ports: number[] = []
  const lines = content.split("\n")
  // Skip header line (index 0)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]?.trim()
    if (!line) continue
    const fields = line.split(/\s+/)
    // field[1] = local_address (HEXIP:HEXPORT), field[3] = state
    const localAddr = fields[1]
    const state = fields[3]
    if (!localAddr || !state) continue
    if (state !== LISTEN_STATE) continue
    const colonIdx = localAddr.indexOf(":")
    if (colonIdx === -1) continue
    const hexIp = localAddr.slice(0, colonIdx)
    const hexPort = localAddr.slice(colonIdx + 1)
    if (!isLocalAddress(hexIp)) continue
    const parsed = parseInt(hexPort, 16)
    if (Number.isFinite(parsed)) ports.push(parsed)
  }
  return ports
}

function selectPort(ports: number[], expectedPort?: number): number | null {
  if (ports.length === 0) return null
  if (expectedPort === undefined) return ports[0] ?? null
  return ports.includes(expectedPort) ? expectedPort : null
}

let _platformWarned = false

export const defaultDeps: ServerPortOwnershipDeps = {
  readFile: (path: string) => fsReadFile(path, "utf8"),
  getPlatform: () => process.platform,
}

export async function detectServerPortOwnership(opts?: {
  pid?: number
  // When provided, ownership is only reported as true if the pid owns a
  // LISTEN socket on this exact port. Required (#4071 finding 2) so the
  // function is anchored to the actual OpenCode server URL, not just any
  // local listener.
  expectedPort?: number
  deps?: ServerPortOwnershipDeps
}): Promise<ServerPortOwnership> {
  const pid = opts?.pid ?? process.pid
  const deps = opts?.deps ?? defaultDeps
  const platform = (deps.getPlatform ?? defaultDeps.getPlatform!)()

  const tcpPath = `/proc/${pid}/net/tcp`
  // Consult injected/real readFile FIRST so test scaffolding can exercise
  // the parsing path on any host. On non-Linux real fs this raises ENOENT
  // and we fall through to the platform-assume branch below.
  let tcpContent: string | null = null
  try {
    tcpContent = await deps.readFile(tcpPath)
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code
    if (code !== "ENOENT") throw err
    // ENOENT — fall through to platform handling.
    if (platform !== "linux") {
      if (!_platformWarned) {
        _platformWarned = true
        log("[server-port-ownership] platform unsupported (real fs has no /proc), assuming port ownership")
      }
      return { hasOwnPort: true, reason: "platform unsupported, assuming ownership" }
    }
    return { hasOwnPort: false, reason: `${tcpPath} not found` }
  }

  const tcpPorts = parseTcpListenPorts(tcpContent)
  const tcpMatch = selectPort(tcpPorts, opts?.expectedPort)
  if (tcpMatch !== null) {
    return { hasOwnPort: true, port: tcpMatch }
  }

  // Try tcp6; ENOENT is non-fatal on kernels that omit it
  const tcp6Path = `/proc/${pid}/net/tcp6`
  try {
    const tcp6Content = await deps.readFile(tcp6Path)
    const tcp6Ports = parseTcpListenPorts(tcp6Content)
    const tcp6Match = selectPort(tcp6Ports, opts?.expectedPort)
    if (tcp6Match !== null) {
      return { hasOwnPort: true, port: tcp6Match }
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err
    }
    // ENOENT on tcp6 is expected on some kernels — continue
  }

  const expectedSuffix = opts?.expectedPort !== undefined
    ? ` matching expected port ${opts.expectedPort}`
    : ""
  return { hasOwnPort: false, reason: `no LISTEN socket${expectedSuffix} on ${tcpPath}` }
}

export function _resetPlatformWarnForTests(): void {
  _platformWarned = false
}
