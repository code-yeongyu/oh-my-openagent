import { homedir } from "node:os"

import { deviceServiceStateDir } from "@oh-my-opencode/device-service-core/state-dir"

import type { MachineHubTransport } from "../../vendor/bunshin-ts/index.js"
import { createRelayTransport, relayStatus } from "../../vendor/bunshin-ts-relay/index.js"

import { BunshinSessionError } from "./bunshin-ts-errors"

export { BunshinSessionError }
export type { BunshinFailure, BunshinSessionErrorCode } from "./bunshin-ts-errors"

const TRANSPORT_CHOICE_ENV = "BUNSHIN_TS_TRANSPORT"
// The host session id, sent with each relay batch as attribution only.
const SESSION_REF_ENV = "PI_SESSION_ID"

export type TransportChoice = "auto" | "relay" | "hub"
const CHOICES: readonly TransportChoice[] = ["auto", "relay", "hub"]

export type PickTransportDeps = Readonly<{
  relayStatus: (options?: { stateDir?: string }) => Promise<{ connected: boolean }>
  /** The home the state dir resolves under (tests); absent, the user's own. */
  home?: string
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

// The device service's local API rule (#13597): an absolute OMO_DEVICE_SERVICE_STATE_DIR, else the discovery file
// beside the default dir, else the default. Resolved here, so the vendored relay SDK never guesses.
const stateDirOf = (env: Env, deps: PickTransportDeps): string =>
  deviceServiceStateDir(process.platform, env, deps.home ?? homedir())

const relayTransport = (env: Env, stateDir: string): MachineHubTransport => {
  const sessionRef = nonEmpty(env[SESSION_REF_ENV])
  return createRelayTransport({ stateDir, ...(sessionRef === undefined ? {} : { sessionRef }) })
}

const parseChoice = (raw: string | undefined): TransportChoice => {
  const value = nonEmpty(raw)?.toLowerCase() ?? "auto"
  const choice = CHOICES.find((candidate) => candidate === value)
  if (choice === undefined) {
    throw new BunshinSessionError(
      "bad_choice",
      `${TRANSPORT_CHOICE_ENV}=${raw} is not one of ${CHOICES.join(", ")}`,
      `set ${TRANSPORT_CHOICE_ENV} to one of ${CHOICES.join(", ")}, or unset it for auto`,
    )
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
  const stateDir = stateDirOf(env, deps)
  if (choice === "relay") return relayTransport(env, stateDir)
  if (choice === "hub") {
    if (deps.hub === undefined)
      throw new BunshinSessionError(
        "hub_not_bundled",
        "hub transport is not bundled in this build",
        `set ${TRANSPORT_CHOICE_ENV}=relay (or unset it) to reach devices through this device's device service`,
      )
    return deps.hub.create()
  }
  const status = await deps.relayStatus({ stateDir })
  if (status.connected) return relayTransport(env, stateDir)
  if (deps.hub !== undefined && (await deps.hub.configResolves())) return deps.hub.create()
  throw new BunshinSessionError(
    "no_transport",
    "no transport: the device service is not connected and no hub transport is available",
    "start this device's device service and sign in (`omo remote status` shows its state), then retry",
  )
}
