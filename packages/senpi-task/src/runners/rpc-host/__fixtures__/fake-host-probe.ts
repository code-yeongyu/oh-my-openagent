import { connectFakeHost } from "./fake-host-transport"

import type { SenpiHostProtocolInfo } from "../../../lazy/senpi-barrel"

/**
 * The fake daemon's identity half: what it answers `get_protocol_info` with, and the out-of-band
 * probe a client makes against it (one short-lived connection, one line, one answer).
 */

export const FAKE_HOST_CAPABILITIES = [
  "multi_session",
  "extension_events",
  "session_context",
  "session_kind",
  "retain_on_disconnect",
  "auto_title_per_session",
  "generation_handoff",
] as const

export interface FakeHostIdentityOptions {
  readonly capabilities?: readonly string[]
  readonly protocolVersion?: number
  readonly instanceId?: string
  readonly generation?: number
  readonly engineVersion?: string
  readonly engineOrdinal?: readonly number[]
  readonly launchProfile?: Readonly<Record<string, unknown>>
}

export function fakeProtocolInfo(options: FakeHostIdentityOptions): Readonly<Record<string, unknown>> {
  const engineVersion = options.engineVersion ?? "2026.9.18"
  return {
    protocolVersion: options.protocolVersion ?? 1,
    serverVersion: engineVersion,
    instanceId: options.instanceId ?? "fake-instance",
    generation: options.generation ?? 1,
    engineVersion,
    engineOrdinal: [...(options.engineOrdinal ?? [2026, 9, 18, 0, 0])],
    capabilities: [...(options.capabilities ?? FAKE_HOST_CAPABILITIES)],
    launch_profile: options.launchProfile ?? { profile_id: "fake-profile" },
  }
}

/**
 * `list_sessions` straight off the wire, with the `include_workers` gate the pinned engine client
 * cannot forward yet (its `listSessions()` takes no options, so worker rows stay hidden through it).
 * A lifecycle suite therefore asks the daemon here to see what a newer client will see.
 */
export async function listFakeHostSessions(
  socketPath: string,
  options: { readonly includeWorkers?: boolean } = {},
): Promise<readonly string[]> {
  const request = JSON.stringify({
    id: "fake-list",
    type: "list_sessions",
    include_workers: options.includeWorkers === true,
  })
  const reply = await askFakeHost(socketPath, request)
  const sessions = reply === undefined ? undefined : (reply as { sessions?: unknown }).sessions
  if (!Array.isArray(sessions)) return []
  return sessions.flatMap((row: unknown) => {
    const path = typeof row === "object" && row !== null ? (row as { sessionPath?: unknown }).sessionPath : undefined
    return typeof path === "string" ? [path] : []
  })
}

export async function probeFakeHost(socketPath: string): Promise<SenpiHostProtocolInfo | undefined> {
  const data = await askFakeHost(socketPath, '{"id":"fake-probe","type":"get_protocol_info"}')
  return data === undefined ? undefined : readProtocolInfo(data)
}

/** One short-lived connection, one command, one answer: the fixture's out-of-band request shape. */
function askFakeHost(socketPath: string, request: string): Promise<Readonly<Record<string, unknown>> | undefined> {
  return new Promise<Readonly<Record<string, unknown>> | undefined>((resolve) => {
    const socket = connectFakeHost(socketPath)
    let buffer = ""
    const finish = (data: Readonly<Record<string, unknown>> | undefined): void => {
      socket.destroy()
      resolve(data)
    }
    socket.setEncoding("utf8")
    socket.on("connect", () => socket.write(`${request}\n`))
    socket.on("data", (chunk: string) => {
      buffer += chunk
      const newline = buffer.indexOf("\n")
      if (newline !== -1) finish(readResponseData(buffer.slice(0, newline)))
    })
    socket.on("error", () => finish(undefined))
  })
}

function readResponseData(line: string): Readonly<Record<string, unknown>> | undefined {
  const parsed: unknown = JSON.parse(line)
  if (typeof parsed !== "object" || parsed === null || !("data" in parsed)) return undefined
  const data = parsed.data
  return typeof data === "object" && data !== null ? { ...data } : undefined
}

function readProtocolInfo(info: Readonly<Record<string, unknown>>): SenpiHostProtocolInfo | undefined {
  const capabilities = info.capabilities
  if (typeof info.instanceId !== "string" || typeof info.engineVersion !== "string") return undefined
  if (typeof info.protocolVersion !== "number" || !Array.isArray(capabilities)) return undefined
  return {
    protocolVersion: info.protocolVersion,
    instanceId: info.instanceId,
    generation: typeof info.generation === "number" ? info.generation : 0,
    engineVersion: info.engineVersion,
    engineOrdinal: Array.isArray(info.engineOrdinal) ? info.engineOrdinal.map(Number) : [],
    capabilities: capabilities.map(String),
  }
}
