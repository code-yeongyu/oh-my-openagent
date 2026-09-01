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
}

const defaultBaseDir = fileURLToPath(new URL("../runtime/agent-toolkit", import.meta.url))

export function createToolkitPathProvisioning(options: ToolkitPathProvisioningOptions = {}): () => void {
  const baseDir = options.baseDir ?? defaultBaseDir
  const logger = options.logger

  return () => {
    try {
      if (!existsSync(baseDir)) return
      prependPathEntry(baseDir)
      setToolkitBinWhenUnset(baseDir)
    } catch (error) {
      // A broken PATH must never kill extension activation: log and continue.
      logger?.warn("omo-senpi toolkit path provisioning failed", { error })
    }
  }
}

function prependPathEntry(baseDir: string): void {
  const current = process.env.PATH ?? ""
  if (current.split(delimiter)[0] === baseDir) return
  process.env.PATH = current === "" ? baseDir : `${baseDir}${delimiter}${current}`
}

function setToolkitBinWhenUnset(baseDir: string): void {
  const current = process.env[TOOLKIT_BIN_ENV]
  if (current !== undefined && current !== "") return
  process.env[TOOLKIT_BIN_ENV] = join(baseDir, "cli.js")
}
