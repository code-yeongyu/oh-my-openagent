import { isAbsolute, resolve } from "node:path"

import {
  type BootstrapDependencies,
  bootstrapDeviceService,
  DEVICE_SERVICE_VERSION,
  deviceServiceHost,
  installDeviceService,
  type Status,
} from "../device-service-core/src/index.ts"
import packageJson from "./package.json" with { type: "json" }
import { applyColdWake, type ColdWake } from "./remote-cold-wake"
import { REMOTE_EXIT } from "./remote-exit"
import { statusLines } from "./remote-render"

// `omo remote bootstrap`: the device service bootstrap every interactive omo start runs in the background (the
// omo-senpi device-service component starts it). One JSON line with --json: {state: "connected", status} or
// {state, notice}; the component shows the notice for every stop but signed_out, store_unavailable and not_published.

/** Everything the bootstrap needs besides the account read, the state dir and the connection `omo remote` already has. */
export type BootstrapSetup = Omit<BootstrapDependencies, "accountShow" | "stateDir" | "connect">

type BootstrapIo = Pick<BootstrapDependencies, "accountShow" | "stateDir" | "connect"> & {
  readonly output: (line: string) => void
  readonly error: (line: string) => void
}

const UNSUPPORTED_HOST = "The OmO device service does not run on this platform yet."

/** This build's bootstrap inputs: the pinned release and its verified install and this omo binary; never a credential. */
export function deviceServiceBootstrapSetup(options: {
  readonly stateDir: string
  readonly binaryPath: string
  readonly agentDir: string
  readonly platform?: NodeJS.Platform
  readonly arch?: string
  /** Where the release comes from and how it is verified and installed; this build's defaults when absent. */
  readonly release?: Pick<Parameters<typeof installDeviceService>[0], "origin" | "fetch" | "releaseKeys" | "run">
}): BootstrapSetup {
  const host = deviceServiceHost(options.platform ?? process.platform, options.arch ?? process.arch)
  return {
    pinVersion: DEVICE_SERVICE_VERSION,
    install: async () =>
      host === undefined
        ? { ok: false, state: "service_degraded", action: UNSUPPORTED_HOST }
        : installDeviceService({
            ...options.release,
            version: DEVICE_SERVICE_VERSION,
            host,
            stateDir: options.stateDir,
            engineVersion: packageJson.dependencies["@code-yeongyu/senpi"],
          }),
    refresher: { binaryPath: options.binaryPath, version: packageJson.version },
    agentDir: options.agentDir,
  }
}

/**
 * The binary the service runs to refresh its token: the omo the engine was launched from (OMO_BIN), else this
 * compiled binary, else this npm launcher script.
 */
export function omoBinaryPath(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const declared = env.OMO_BIN
  if (declared !== undefined && isAbsolute(declared)) return declared
  const bun: unknown = Reflect.get(globalThis, "Bun")
  const embedded: unknown = typeof bun === "object" && bun !== null ? Reflect.get(bun, "embeddedFiles") : undefined
  if (Array.isArray(embedded) && embedded.length > 0) return process.execPath
  return resolve(process.argv[1] ?? process.execPath)
}

const bootstrap = async (io: BootstrapIo, setup: BootstrapSetup, json: boolean) => {
  const outcome = await bootstrapDeviceService({
    accountShow: io.accountShow,
    stateDir: io.stateDir,
    connect: io.connect,
    ...setup,
  })
  if (outcome.kind === "stopped") {
    if (json) io.output(JSON.stringify({ state: outcome.state, notice: outcome.notice }))
    else io.error(outcome.notice)
  }
  return outcome
}

/**
 * Hands the signed-in session's device keys to the running service through the handoff a fresh `omo login` uses;
 * "signed_out" when there is no signed-in session to hand over.
 */
export type DeviceLink = () => Promise<"linked" | "signed_out">

const NOT_LINKED = "This device is not linked to the OmO device service yet. Run omo login to link it."

/**
 * `omo remote enable`, the one command after `omo login` (omo#13594): the bootstrap (install the pinned service when none
 * runs, connect, register the refresher and this agent dir), then the switch on, then the always-on session host unit.
 * Every step is idempotent, so running it again changes nothing that is already in place.
 *
 * Design D r9 section 3 exception (LEAD ruling on omo#13602): a sign-in made before the service was installed never
 * reached it, and the background bootstrap must never read a credential. This explicit verb, and only while the service
 * holds no device, hands the signed-in session's keys over through `linkDevice`, the same handoff a fresh login makes.
 */
export async function runEnableVerb(
  io: BootstrapIo,
  setup: BootstrapSetup,
  coldWake: ColdWake,
  linkDevice: DeviceLink,
  json: boolean,
): Promise<number> {
  const outcome = await bootstrap(io, setup, json)
  if (outcome.kind === "stopped") return REMOTE_EXIT.unavailable
  let enabled: boolean
  try {
    enabled = await outcome.service.setEnabled(true)
  } finally {
    outcome.service.close()
  }
  if (json) io.output(JSON.stringify({ enabled }))
  else io.output(`Remote sessions are ${enabled ? "on" : "off"} for this device.`)
  if (outcome.status.device === null && (await linkDevice()) === "signed_out") io.error(NOT_LINKED)
  await applyColdWake(coldWake, enabled, io.error)
  return REMOTE_EXIT.ok
}

/** What one bootstrap ended with: connected with the service's status and version, or stopped with its notice. */
export type BootstrapOutcome =
  | { readonly kind: "connected"; readonly status: Status; readonly serviceVersion: string }
  | { readonly kind: "stopped"; readonly state: string; readonly notice: string }

/**
 * One bootstrap, then the session host unit to match the service's switch: the body of `omo remote bootstrap` and of the
 * internal entry the engine starts (`device-service-bootstrap-entry.ts`). It prints nothing.
 */
export async function bootstrapWithColdWake(
  io: Pick<BootstrapIo, "accountShow" | "stateDir" | "connect" | "error">,
  setup: BootstrapSetup,
  coldWake: ColdWake,
): Promise<BootstrapOutcome> {
  const outcome = await bootstrapDeviceService({
    accountShow: io.accountShow,
    stateDir: io.stateDir,
    connect: io.connect,
    ...setup,
  })
  if (outcome.kind === "stopped") return { kind: "stopped", state: outcome.state, notice: outcome.notice }
  const connected = {
    kind: "connected",
    status: outcome.status,
    serviceVersion: outcome.service.serviceVersion,
  } as const
  outcome.service.close()
  // After the connection is closed: a changed table restarts the device service, which would cut it.
  await applyColdWake(coldWake, outcome.status.state !== "disabled", io.error)
  return connected
}

export async function runBootstrapVerb(
  io: BootstrapIo,
  setup: BootstrapSetup,
  coldWake: ColdWake,
  json: boolean,
): Promise<"connected" | "stopped"> {
  const outcome = await bootstrapWithColdWake(io, setup, coldWake)
  if (outcome.kind === "stopped") {
    if (json) io.output(JSON.stringify({ state: outcome.state, notice: outcome.notice }))
    else io.error(outcome.notice)
    return "stopped"
  }
  if (json) io.output(JSON.stringify({ state: "connected", status: outcome.status }))
  else for (const line of statusLines(outcome.status, outcome.serviceVersion)) io.output(line)
  return "connected"
}
