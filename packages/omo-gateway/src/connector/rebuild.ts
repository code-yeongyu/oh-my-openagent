// How the connector CLI builds (and, after a fatal stop, rebuilds) its adapter. The first build
// uses the surface and credentials the command already checked. A rebuild re-reads the gateway
// section (when the caller can), re-selects the surface and re-runs the credential custody check,
// so a fixed config or credential file is what the new adapter gets; a config or credential that
// is still unusable is another AdapterFatal, and the connector stays stopped.

import { readdir } from "node:fs/promises"
import { join } from "node:path"
import { AdapterFatal, type SurfaceAdapter } from "../adapter/contract"
import type { AdapterFactory } from "./cli"
import { CredentialsRefused, expandHome, resolveCredentials, type ConnectorSurface, type Credentials } from "./credentials"
import { selectSurface, type ConnectArgs } from "./select"
import { watchForChange } from "./watch"

export type RebuildOptions = {
  factory: AdapterFactory
  args: ConnectArgs
  scope: string
  account_id: string
  surface: ConnectorSurface
  credentials: Credentials
  agentDir: string
  env: Readonly<Record<string, string | undefined>>
  home: string
  configPath: string | undefined
  reloadGateway: (() => Promise<unknown>) | undefined
  log: (line: string) => void
}

export type AdapterBuilder = {
  createAdapter: () => Promise<SurfaceAdapter>
  waitForChange: (signal: AbortSignal) => Promise<boolean>
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

async function credentialPaths(surface: ConnectorSurface, home: string): Promise<string[]> {
  if (surface.credentials_file !== undefined) return [expandHome(surface.credentials_file, home)]
  if (surface.credentials_dir === undefined) return []
  const dir = expandHome(surface.credentials_dir, home)
  const entries = await readdir(dir).catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return []
    throw error
  })
  return [dir, ...entries.map((entry) => join(dir, entry))]
}

export function adapterBuilder(options: RebuildOptions): AdapterBuilder {
  const platform = options.surface.platform
  let surface = options.surface
  let credentials = options.credentials
  let built = false

  const reselect = async (): Promise<ConnectorSurface> => {
    if (options.reloadGateway === undefined) return surface
    let section: unknown
    try {
      section = await options.reloadGateway()
    } catch (error) {
      throw new AdapterFatal(platform, "config", `the gateway config cannot be used: ${message(error)}`)
    }
    const selected = selectSurface(section, options.args)
    if (selected.kind === "error") throw new AdapterFatal(platform, "config", selected.message)
    if (selected.account_id !== options.account_id) {
      throw new AdapterFatal(platform, "config", `the config now names account ${selected.account_id} for this surface; run omo gateway connect again`)
    }
    return selected.surface
  }

  const refresh = async (): Promise<void> => {
    surface = await reselect()
    try {
      credentials = await resolveCredentials(surface, { env: options.env, home: options.home })
    } catch (error) {
      if (error instanceof CredentialsRefused) throw new AdapterFatal(platform, "credentials", error.message)
      throw error
    }
  }

  return {
    createAdapter: async () => {
      if (built) await refresh()
      built = true
      return options.factory({ scope: options.scope, surface, credentials, agentDir: options.agentDir, log: options.log })
    },
    waitForChange: async (signal) => {
      const paths = [...(options.configPath === undefined ? [] : [options.configPath]), ...(await credentialPaths(surface, options.home))]
      return watchForChange(paths)(signal)
    },
  }
}
