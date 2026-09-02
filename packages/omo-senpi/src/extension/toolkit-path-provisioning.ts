import { existsSync } from "node:fs"
import { delimiter, join } from "node:path"
import { fileURLToPath } from "node:url"

import type { ComponentLogger } from "./types"

export const TOOLKIT_BIN_ENV = "OMO_AGENT_TOOLKIT_BIN"

export interface ToolkitPathProvisioningOptions {
  // Defaults to the running extension's own ../runtime/agent-toolkit (extensions/omo.js layout).
  // The source tree has no src/runtime, so dev runs take the absent-dir branch; tests inject a
  // temp-dir fixture through this seam.
  baseDir?: string
  logger?: ComponentLogger
  // Defaults to process.env. Injectable so the Windows PATH-casing regression (#6689) is
  // provable on any host: the inherited variable arrives as `Path` there, and a hardcoded
  // uppercase write would create a second key that shadows the full value in child spawns.
  env?: Record<string, string | undefined>
}

const defaultBaseDir = fileURLToPath(new URL("../runtime/agent-toolkit", import.meta.url))

export function createToolkitPathProvisioning(options: ToolkitPathProvisioningOptions = {}): () => void {
  const baseDir = options.baseDir ?? defaultBaseDir
  const logger = options.logger
  const env = options.env ?? process.env

  return () => {
    try {
      if (!existsSync(baseDir)) return
      prependPathEntry(env, baseDir)
      setToolkitBinWhenUnset(env, baseDir)
    } catch (error) {
      // A broken PATH must never kill extension activation: log and continue.
      logger?.warn("omo-senpi toolkit path provisioning failed", { error })
    }
  }
}

function resolvePathEnvKey(env: Record<string, string | undefined>): string {
  return Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH"
}

function prependPathEntry(env: Record<string, string | undefined>, baseDir: string): void {
  const pathKey = resolvePathEnvKey(env)
  const current = env[pathKey] ?? ""
  if (current.split(delimiter)[0] === baseDir) return
  env[pathKey] = current === "" ? baseDir : `${baseDir}${delimiter}${current}`
}

function setToolkitBinWhenUnset(env: Record<string, string | undefined>, baseDir: string): void {
  const current = env[TOOLKIT_BIN_ENV]
  if (current !== undefined && current !== "") return
  env[TOOLKIT_BIN_ENV] = join(baseDir, "cli.js")
}
