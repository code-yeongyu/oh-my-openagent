import { existsSync } from "node:fs"
import { fileURLToPath } from "node:url"

import type { ComponentLogger } from "./types"

import { createSdkRootProvisioning, DAG_SDK_ROOT_ENV } from "./sdk-root-provisioning"
export { DAG_SDK_ROOT_ENV } from "./sdk-root-provisioning"

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
  return createSdkRootProvisioning({
    envKey: DAG_SDK_ROOT_ENV,
    packagedRelativeDir: "../runtime/dag",
    sourceTreeRelativeDir: "../../plugin/runtime/dag",
    baseDir,
    ...(options.logger === undefined ? {} : { logger: options.logger }),
  })
}
