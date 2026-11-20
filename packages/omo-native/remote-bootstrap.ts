import { isAbsolute, resolve } from "node:path"

import {
  type BootstrapDependencies,
  type BootstrapOutcome,
  bootstrapDeviceService,
  DEVICE_SERVICE_VERSION,
  deviceServiceHost,
  installDeviceService,
} from "../device-service-core/src/index.ts"
import packageJson from "./package.json" with { type: "json" }
import { applyColdWake, type ColdWake } from "./remote-cold-wake"
import type { RemoteOptOut } from "./remote-opt-out"
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

// `quietSuppressed`: the setup after `omo login` says nothing when the install changed nothing because this machine has
// no reachable service manager; login succeeded, and `omo remote enable` / `omo remote status` still say why.
const bootstrap = async (io: BootstrapIo, setup: BootstrapSetup, json: boolean, quietSuppressed = false) => {
  const outcome = await bootstrapDeviceService({
    accountShow: io.accountShow,
    stateDir: io.stateDir,
    connect: io.connect,
    ...setup,
  })
  if (outcome.kind === "stopped" && !(quietSuppressed && outcome.suppressed === true)) {
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

/** What turns remote sessions on for this device beyond the bootstrap itself (omo#13602). */
export type RemoteSetup = {
  readonly coldWake: ColdWake
  readonly linkDevice: DeviceLink
  readonly optOut: RemoteOptOut
}

/**
 * `omo remote enable`: the bootstrap (install the pinned service when none runs, connect, register the refresher and
 * this agent dir), then the switch on, the device link and the always-on session host unit, and it clears a recorded
 * opt-out (omo#13594, omo#13602). Every step is idempotent, so running it again changes nothing already in place.
 * `afterLogin`: started by `omo login`, not typed by the user; an opt-out recorded by then keeps remote off instead.
 */
export async function runEnableVerb(
  io: BootstrapIo,
  setup: BootstrapSetup,
  remote: RemoteSetup,
  json: boolean,
  afterLogin = false,
): Promise<number> {
  const enabled = await enableRemote(io, setup, remote, json, afterLogin, (on) =>
    io.output(json ? JSON.stringify({ enabled: on }) : `Remote sessions are ${on ? "on" : "off"} for this device.`),
  )
  return enabled === "stopped" ? REMOTE_EXIT.unavailable : REMOTE_EXIT.ok
}

/** An opt-out on a connected service, as the bootstrap enforces it: the switch off if it is on, the unit removed. */
async function keepRemoteOff(
  outcome: Extract<BootstrapOutcome, { kind: "connected" }>,
  remote: RemoteSetup,
  io: BootstrapIo,
): Promise<void> {
  try {
    if (outcome.status.enabled) await outcome.service.setEnabled(false)
  } finally {
    outcome.service.close()
  }
  await applyColdWake(remote.coldWake, false, io.error)
}

async function enableRemote(
  io: BootstrapIo,
  setup: BootstrapSetup,
  remote: RemoteSetup,
  json: boolean,
  afterLogin: boolean,
  report: (enabled: boolean) => void,
  quietSuppressed = false,
): Promise<boolean | "stopped"> {
  const outcome = await bootstrap(io, setup, json, quietSuppressed)
  if (outcome.kind === "stopped") return "stopped"
  // Re-read after the install, which can take minutes (#13724 review M1): a `omo remote disable` typed meanwhile found
  // no service to switch off, so this enable, which login started, enforces it and leaves the record in place.
  if (afterLogin && remote.optOut.read()) {
    await keepRemoteOff(outcome, remote, io)
    report(false)
    return false
  }
  let enabled: boolean
  try {
    enabled = await outcome.service.setEnabled(true)
  } finally {
    outcome.service.close()
  }
  if (enabled) remote.optOut.clear()
  report(enabled)
  if (outcome.status.device === null && (await remote.linkDevice()) === "signed_out") io.error(NOT_LINKED)
  await applyColdWake(remote.coldWake, enabled, io.error)
  return enabled
}

/**
 * Starts `omo remote <verb>` in its own detached process, which outlives `omo login` (omo#13722): enable (with
 * --after-login) turns remote on unless an opt-out was recorded by the end of its install; bootstrap enforces a recorded
 * opt-out (the switch off, the unit removed) on the service it installs.
 */
export type BackgroundRemote = (verb: "enable" | "bootstrap") => void

/** What `omo login` prints when this device has no current device service yet and remote is turned on in the background. */
export const REMOTE_TURNING_ON_AFTER_SIGN_IN =
  "Remote is turning on for this device in the background. Check: omo remote status. Turn off: omo remote disable"

/** What `omo login` prints, and the desktop app shows after sign-in, once remote sessions are on (Q, omo#13602). */
export const REMOTE_ON_AFTER_SIGN_IN =
  "Remote is on for this device: other signed-in devices can reach it. Turn off: omo remote disable"
export const REMOTE_KEPT_OFF_AFTER_SIGN_IN =
  "Remote is off for this device, as you set it with omo remote disable. Turn on: omo remote enable"

/**
 * Right after a successful `omo login` (Q, omo#13602): remote sessions switch on, as `omo remote enable` turns them on,
 * and the user is told so in one line. A user who turned them off with `omo remote disable` keeps them off and is told
 * how to turn them on. A setup that stops (no device service for this platform, say) prints its notice instead.
 */
export async function runLoginSetup(
  io: BootstrapIo,
  setup: BootstrapSetup,
  remote: RemoteSetup,
  inBackground: BackgroundRemote,
): Promise<"on" | "kept_off" | "not_on" | "background"> {
  // Login never installs the device service itself (omo#13722): the download, the platform's permission steps and the
  // service registration can take minutes (on Windows: Task Scheduler, PowerShell), and children of the login process
  // would keep it from exiting. A device whose current service already runs is set up here; any other is handed to a
  // detached `omo remote enable`. The install's "changed nothing" outcome keeps the bootstrap quiet about it.
  let handedOff = false
  const handOff = (verb: "enable" | "bootstrap"): BootstrapSetup => ({
    ...setup,
    install: async () => {
      inBackground(verb)
      handedOff = true
      return { ok: false, state: "service_degraded", action: "", suppressed: true }
    },
  })
  if (remote.optOut.read()) {
    // Enforced now, not at the next omo start (#13602 security review M1): a switch that came back on is turned off and
    // the unit removed, as the bootstrap does for an opt-out. A setup that stops still leaves the record in charge.
    // A device with no current service (none, or an older one) gets it from a background omo remote bootstrap, which
    // turns the switch off and removes the unit on the service it installs, as login did inline before (#13724 M1).
    const outcome = await bootstrap(io, handOff("bootstrap"), false, true)
    if (outcome.kind === "connected") await keepRemoteOff(outcome, remote, io)
    io.output(REMOTE_KEPT_OFF_AFTER_SIGN_IN)
    return "kept_off"
  }
  const enabled = await enableRemote(io, handOff("enable"), remote, false, true, () => {}, true)
  if (handedOff) {
    io.output(REMOTE_TURNING_ON_AFTER_SIGN_IN)
    return "background"
  }
  if (enabled !== true) return "not_on"
  io.output(REMOTE_ON_AFTER_SIGN_IN)
  return "on"
}

/**
 * `omo remote bootstrap`, which every omo start and every `omo login` run: remote sessions are ON BY DEFAULT for a
 * signed-in device (Q, omo#13602). Unless this user recorded an opt-out, it links a sign-in the service has not seen and
 * installs the session host unit; a recorded opt-out turns the service's switch off again if it came back on, and
 * removes the unit. It never turns the switch on itself: an off set elsewhere (the desktop app) is respected.
 *
 * Design D r9 section 3 exception, extended from `enable` to the bootstrap (LEAD/Q ruling on omo#13602): the link reads
 * this OS user's stored credential, the store the bootstrap's own account check (`omo account show`) already reads, and
 * only while the service holds no device; it hands it over through the handoff a fresh `omo login` uses.
 */
export async function runBootstrapVerb(
  io: BootstrapIo,
  setup: BootstrapSetup,
  remote: RemoteSetup,
  json: boolean,
): Promise<"connected" | "stopped"> {
  const outcome = await bootstrap(io, setup, json)
  if (outcome.kind === "stopped") return "stopped"
  const optedOut = remote.optOut.read()
  let status = outcome.status
  try {
    if (optedOut && status.enabled) await outcome.service.setEnabled(false)
    if (!optedOut && status.enabled && status.device === null) await remote.linkDevice()
    if (optedOut || status.device === null) status = await outcome.service.status()
    if (json) io.output(JSON.stringify({ state: "connected", status }))
    else for (const line of statusLines(status, outcome.service.serviceVersion)) io.output(line)
  } finally {
    outcome.service.close()
  }
  // After the connection is closed: a changed table restarts the device service, which would cut it.
  await applyColdWake(remote.coldWake, !optedOut && status.state !== "disabled", io.error)
  return "connected"
}
