import { homedir } from "node:os"
import { join } from "node:path"

import {
  CODEGRAPH_PINNED_VERSION,
  ensureCodegraphProvisioned,
  type CodegraphProvisionResult,
} from "@oh-my-opencode/utils"

export interface OpenCodeCodegraphInstallOptions {
  readonly homeDir?: string
  readonly log?: (message: string) => void
  readonly provisioner?: (options: {
    readonly installDir: string
    readonly lockDir: string
    readonly version: typeof CODEGRAPH_PINNED_VERSION
  }) => Promise<CodegraphProvisionResult>
}

export async function installCodegraphForOpenCode(options: OpenCodeCodegraphInstallOptions = {}): Promise<void> {
  const installDir = join(options.homeDir ?? homedir(), ".omo", "codegraph")
  const provisioner = options.provisioner ?? ensureCodegraphProvisioned
  try {
    const result = await provisioner({
      installDir,
      lockDir: join(installDir, "locks"),
      version: CODEGRAPH_PINNED_VERSION,
    })
    if (!result.provisioned) {
      options.log?.(`[codegraph] skipped provisioning: ${result.error ?? "provisioning did not produce a binary"}`)
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    options.log?.(`[codegraph] skipped provisioning: ${message}`)
  }
}
