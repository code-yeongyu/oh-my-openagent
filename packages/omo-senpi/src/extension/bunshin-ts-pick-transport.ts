import type { MachineHubTransport } from "../../vendor/bunshin-ts/index.js"
import { createRelayTransport, relayStatus } from "../../vendor/bunshin-ts-relay/index.js"

const TRANSPORT_CHOICE_ENV = "BUNSHIN_TS_TRANSPORT"
const DEVICE_SERVICE_STATE_DIR_ENV = "OMO_DEVICE_SERVICE_STATE_DIR"
// The host session id, sent with each relay batch as attribution only.
const SESSION_REF_ENV = "PI_SESSION_ID"

export type TransportChoice = "auto" | "relay" | "hub"
const CHOICES: readonly TransportChoice[] = ["auto", "relay", "hub"]

export type BunshinSessionErrorCode = "no_transport" | "hub_not_bundled" | "bad_choice"

export class BunshinSessionError extends Error {
  readonly code: BunshinSessionErrorCode

  constructor(code: BunshinSessionErrorCode, message: string) {
    super(message)
    this.name = "BunshinSessionError"
    this.code = code
  }
}

export type PickTransportDeps = Readonly<{
  relayStatus: (options?: { stateDir?: string }) => Promise<{ connected: boolean }>
  // Absent in a build that does not bundle the hub transport.
  hub?: Readonly<{
    configResolves: () => Promise<boolean>
    create: () => MachineHubTransport
  }>
}>

const BUNDLED: PickTransportDeps = { relayStatus }

type Env = Readonly<Record<string, string | undefined>>

const nonEmpty = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim()
  return trimmed === undefined || trimmed === "" ? undefined : trimmed
}

const relayTransport = (env: Env): MachineHubTransport => {
  const stateDir = nonEmpty(env[DEVICE_SERVICE_STATE_DIR_ENV])
  const sessionRef = nonEmpty(env[SESSION_REF_ENV])
  return createRelayTransport({
    ...(stateDir === undefined ? {} : { stateDir }),
    ...(sessionRef === undefined ? {} : { sessionRef }),
  })
}

const parseChoice = (raw: string | undefined): TransportChoice => {
  const value = nonEmpty(raw)?.toLowerCase() ?? "auto"
  const choice = CHOICES.find((candidate) => candidate === value)
  if (choice === undefined) {
    throw new BunshinSessionError("bad_choice", `${TRANSPORT_CHOICE_ENV}=${raw} is not one of ${CHOICES.join(", ")}`)
  }
  return choice
}

/**
 * The transport a cell's fleet client rides. `relay` and `hub` are taken as asked; `auto` uses this device's
 * service when its status answers `connected`, else the hub when this build bundles it and a hub config
 * resolves. A service that is installed but insecure or unproven still throws from the status probe.
 */
export async function pickTransport(env: Env, deps: PickTransportDeps = BUNDLED): Promise<MachineHubTransport> {
  const choice = parseChoice(env[TRANSPORT_CHOICE_ENV])
  if (choice === "relay") return relayTransport(env)
  if (choice === "hub") {
    if (deps.hub === undefined) throw new BunshinSessionError("hub_not_bundled", "hub transport is not bundled in this build")
    return deps.hub.create()
  }
  const stateDir = nonEmpty(env[DEVICE_SERVICE_STATE_DIR_ENV])
  const status = await deps.relayStatus(stateDir === undefined ? {} : { stateDir })
  if (status.connected) return relayTransport(env)
  if (deps.hub !== undefined && (await deps.hub.configResolves())) return deps.hub.create()
  throw new BunshinSessionError("no_transport", "no transport: the device service is not connected and no hub transport is available")
}
