import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

import type { ComponentLogger } from "./types"

export const DAG_SDK_ROOT_ENV = "OMO_DAG_SDK_ROOT"

export interface DagSdkRootProvisioningOptions {
  // Defaults to the running extension's own ../runtime/dag (extensions/omo.js layout), falling back
  // to the source tree's plugin/runtime/dag so dev runs export a real directory too. Tests inject a
  // temp-dir fixture through this seam.
  baseDir?: string
  logger?: ComponentLogger
}

function resolveDefaultBaseDir(importerUrl: string = import.meta.url): string {
  const packagedDir = fileURLToPath(new URL("../runtime/dag", importerUrl))
  if (existsSync(packagedDir)) return packagedDir

  const sourceTreeDir = fileURLToPath(new URL("../../plugin/runtime/dag", importerUrl))
  return existsSync(sourceTreeDir) ? sourceTreeDir : packagedDir
}

export function createDagSdkRootProvisioning(options: DagSdkRootProvisioningOptions = {}): () => void {
  const baseDir = options.baseDir ?? resolveDefaultBaseDir()
  const logger = options.logger

  return () => {
    try {
      // Never publish a path that is not there: an eval cell importing from a missing root gets a
      // worse error than one that finds the env unset.
      if (!existsSync(baseDir)) return
      process.env[DAG_SDK_ROOT_ENV] = baseDir
    } catch (error) {
      // Env provisioning must never kill extension activation: log and continue.
      logger?.warn("omo-senpi dag sdk root provisioning failed", { error })
    }
  }
}
