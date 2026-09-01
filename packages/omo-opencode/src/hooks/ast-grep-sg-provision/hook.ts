import { homedir } from "node:os"
import { join } from "node:path"

import { astGrepRuntimeDir, findSgBinarySync, provisionSgBinary, type SgProvisionOptions, type SgResolverOptions } from "@oh-my-opencode/utils"

import { log } from "../../shared"

export interface AstGrepSgProvisionEventInput {
  readonly event: {
    readonly type: string
  }
}

export interface AstGrepSgProvisionDeps {
  readonly arch?: string
  readonly findSgBinary: (options: SgResolverOptions) => string | null
  readonly homeDir: () => string
  readonly log: (message: string, data?: Record<string, unknown>) => void
  readonly platform?: NodeJS.Platform
  readonly provisionSgBinary: (options: SgProvisionOptions) => Promise<string>
  readonly schedule: (task: () => Promise<void>) => void
}

const provisionedTargets = new Set<string>()

function defaultSchedule(task: () => Promise<void>): void {
  const timer = setTimeout(() => {
    void task()
  }, 0)
  timer.unref?.()
}

async function runProvision(targetDir: string, deps: AstGrepSgProvisionDeps): Promise<void> {
  try {
    const binaryPath = await deps.provisionSgBinary({ arch: deps.arch, platform: deps.platform, targetDir })
    deps.log("[ast-grep-sg-provision] Provisioning finished", { binaryPath, targetDir })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    deps.log("[ast-grep-sg-provision] Provisioning failed", { error: message, targetDir })
  }
}

const defaultDeps: AstGrepSgProvisionDeps = {
  findSgBinary: findSgBinarySync,
  homeDir: homedir,
  log,
  provisionSgBinary,
  schedule: defaultSchedule,
}

export function clearAstGrepSgProvisionTargetsForTesting(): void {
  provisionedTargets.clear()
}

export function createAstGrepSgProvisionHook(depsOverride: Partial<AstGrepSgProvisionDeps> = {}) {
  const deps: AstGrepSgProvisionDeps = { ...defaultDeps, ...depsOverride }
  const platform = deps.platform ?? process.platform
  const targetDir = astGrepRuntimeDir(join(deps.homeDir(), ".omo"), platform, deps.arch ?? process.arch)

  return {
    event(input: AstGrepSgProvisionEventInput): void {
      try {
        if (input.event.type !== "session.created") return
        if (provisionedTargets.has(targetDir)) return
        if (deps.findSgBinary({ runtimeDir: targetDir }) !== null) return
        provisionedTargets.add(targetDir)
        deps.schedule(() => runProvision(targetDir, deps))
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        deps.log("[ast-grep-sg-provision] Event handler failed", { error: message })
      }
    },
  }
}
