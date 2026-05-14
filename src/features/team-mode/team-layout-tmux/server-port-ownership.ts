// Detects whether the current process owns a local LISTEN socket.
//
// On Linux, reads /proc/<pid>/net/tcp (and tcp6) to find sockets in state 0A
// (LISTEN) bound to a local interface (127.0.0.1 or 0.0.0.0). Returns the
// first port found. On non-Linux platforms, ownership is assumed to avoid
// blocking macOS/Windows development.

import { readFile as fsReadFile } from "node:fs/promises"
import { log } from "../../../shared"

export type ServerPortOwnership = {
  hasOwnPort: boolean
  port?: number   // present when hasOwnPort
  reason?: string // present when !hasOwnPort
}

export type ServerPortOwnershipDeps = {
  readFile: (path: string) => Promise<string>
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

function parseTcpContent(content: string): number | null {
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
    return parseInt(hexPort, 16)
  }
  return null
}

let _platformWarned = false

export const defaultDeps: ServerPortOwnershipDeps = {
  readFile: (path: string) => fsReadFile(path, "utf8"),
}

export async function detectServerPortOwnership(opts?: {
  pid?: number
  deps?: ServerPortOwnershipDeps
}): Promise<ServerPortOwnership> {
  const pid = opts?.pid ?? process.pid
  const deps = opts?.deps ?? defaultDeps

  if (process.platform !== "linux") {
    if (!_platformWarned) {
      _platformWarned = true
      log("[server-port-ownership] platform unsupported, assuming port ownership")
    }
    return { hasOwnPort: true, reason: "platform unsupported, assuming ownership" }
  }

  const tcpPath = `/proc/${pid}/net/tcp`
  let tcpContent: string
  try {
    tcpContent = await deps.readFile(tcpPath)
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { hasOwnPort: false, reason: `${tcpPath} not found` }
    }
    throw err
  }

  const port = parseTcpContent(tcpContent)
  if (port !== null) {
    return { hasOwnPort: true, port }
  }

  // Try tcp6; ENOENT is non-fatal on kernels that omit it
  const tcp6Path = `/proc/${pid}/net/tcp6`
  try {
    const tcp6Content = await deps.readFile(tcp6Path)
    const port6 = parseTcpContent(tcp6Content)
    if (port6 !== null) {
      return { hasOwnPort: true, port: port6 }
    }
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
      throw err
    }
    // ENOENT on tcp6 is expected on some kernels — continue
  }

  return { hasOwnPort: false, reason: `no LISTEN socket on ${tcpPath}` }
}

export function _resetPlatformWarnForTests(): void {
  _platformWarned = false
}
