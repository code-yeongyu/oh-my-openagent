import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import type { ComponentLogger } from "./types"

export const DAG_SDK_ROOT_ENV = "OMO_DAG_SDK_ROOT"
export const AGENT_TOOLKIT_SDK_ROOT_ENV = "OMO_AGENT_TOOLKIT_SDK_ROOT"

export interface SdkRootProvisioningOptions {
  envKey: string
  packagedRelativeDir: string
  sourceTreeRelativeDir: string
  baseDir?: string
  logger?: ComponentLogger
}

export function createSdkRootProvisioning(options: SdkRootProvisioningOptions): () => void {
  return () => {
    try {
      const packagedDir = options.baseDir ?? fileURLToPath(new URL(options.packagedRelativeDir, import.meta.url))
      const sourceTreeDir = options.baseDir ?? fileURLToPath(new URL(options.sourceTreeRelativeDir, import.meta.url))
      const baseDir = existsSync(packagedDir) ? packagedDir : sourceTreeDir
      if (!existsSync(baseDir)) return
      process.env[options.envKey] = baseDir
    } catch (error) {
      options.logger?.warn(options.envKey === DAG_SDK_ROOT_ENV
        ? "omo-senpi dag sdk root provisioning failed"
        : "omo-senpi agent toolkit sdk root provisioning failed", { error })
    }
  }
}
