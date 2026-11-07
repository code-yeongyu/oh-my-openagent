import { isAbsolute, resolve } from "node:path"

import {
  type BootstrapDependencies,
  bootstrapDeviceService,
  DEVICE_SERVICE_VERSION,
  deviceServiceHost,
  installDeviceService,
} from "../device-service-core/src/index.ts"
import packageJson from "./package.json" with { type: "json" }
import { statusLines } from "./remote-render"

// `omo remote bootstrap`: the device service bootstrap every interactive omo start runs in the background (the
// omo-senpi device-service component starts it). One JSON line with --json: {state: "connected", status} or
// {state, notice}; the component shows the notice for every stop but signed_out.

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

export async function runBootstrapVerb(io: BootstrapIo, setup: BootstrapSetup, json: boolean): Promise<"connected" | "stopped"> {
  const outcome = await bootstrapDeviceService({ accountShow: io.accountShow, stateDir: io.stateDir, connect: io.connect, ...setup })
  if (outcome.kind === "stopped") {
    if (json) io.output(JSON.stringify({ state: outcome.state, notice: outcome.notice }))
    else io.error(outcome.notice)
    return "stopped"
  }
  try {
    if (json) io.output(JSON.stringify({ state: "connected", status: outcome.status }))
    else for (const line of statusLines(outcome.status, outcome.service.serviceVersion)) io.output(line)
  } finally {
    outcome.service.close()
  }
  return "connected"
}
