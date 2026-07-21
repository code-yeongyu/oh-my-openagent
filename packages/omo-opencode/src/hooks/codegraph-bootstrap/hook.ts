import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import {
  CODEGRAPH_PINNED_VERSION,
  buildCodegraphEnv,
  ensureCodegraphGitignored,
  ensureCodegraphProvisioned,
  prepareCodegraphWorkspace,
  resolveCodegraphCommand,
  resolveCodegraphNodeSupport,
  type BuildCodegraphEnvOptions,
  type CodegraphCommandResolution,
  type CodegraphNodeSupport,
  type CodegraphProvisionResult,
  type CodegraphWorkspacePreparation,
  type PrepareCodegraphWorkspaceOptions,
  type ResolveCodegraphCommandOptions,
} from "@oh-my-opencode/utils"

import type { CodegraphConfig } from "../../config"
import { log } from "../../shared"
import type { CodegraphCommandResult } from "./command-runner"
import { runCodegraphCommand } from "./command-runner"
import { resolveCodegraphProjectRoot } from "./project-root"
import { decideCodegraphStartupAction } from "./status"

export interface CodegraphBootstrapContext {
  readonly directory: string
}

export interface CodegraphBootstrapEventInput {
  readonly event: {
    readonly properties?: unknown
    readonly type: string
  }
}

export interface CodegraphBootstrapDeps {
  readonly buildEnv: (options?: BuildCodegraphEnvOptions) => Record<string, string>
  readonly ensureGitignored: (projectRoot: string) => boolean
  readonly ensureProvisioned: (options: {
    readonly installDir?: string
    readonly lockDir: string
    readonly version: typeof CODEGRAPH_PINNED_VERSION
  }) => Promise<CodegraphProvisionResult>
  readonly log: (message: string, data?: Record<string, unknown>) => void
  readonly nodeSupport: () => CodegraphNodeSupport
  readonly prepareWorkspace: (
    projectRoot: string,
    options?: PrepareCodegraphWorkspaceOptions,
  ) => CodegraphWorkspacePreparation
  readonly resolveCommand: (options?: ResolveCodegraphCommandOptions) => CodegraphCommandResolution
  readonly runCommand: (
    projectRoot: string,
    command: string,
    args: readonly string[],
    options: { readonly env: Record<string, string>; readonly timeoutMs: number },
  ) => Promise<CodegraphCommandResult>
  readonly schedule: (task: () => Promise<void>) => void
}

const CODEGRAPH_VERSION = CODEGRAPH_PINNED_VERSION
const COMMAND_TIMEOUT_MS = 60_000
const bootstrappedProjects = new Set<string>()

function defaultSchedule(task: () => Promise<void>): void {
  const timer = setTimeout(() => {
    void task()
  }, 0)
  timer.unref?.()
}

function defaultInstallDir(): string {
  return join(homedir(), ".omo", "codegraph")
}

function provisionedBinFromInstallDir(installDir: string | undefined): string | null {
  if (installDir === undefined) return null
  const binaryName = process.platform === "win32" ? "codegraph.cmd" : "codegraph"
  const candidate = join(installDir, "bin", binaryName)
  return existsSync(candidate) ? candidate : null
}

function codegraphEnv(deps: CodegraphBootstrapDeps, config: Partial<CodegraphConfig>): Record<string, string> {
  const env = deps.buildEnv()
  return config.install_dir === undefined
    ? env
    : { ...env, CODEGRAPH_INSTALL_DIR: config.install_dir }
}

function resolveInitialCommand(
  deps: CodegraphBootstrapDeps,
  config: Partial<CodegraphConfig>,
): CodegraphCommandResolution {
  return deps.resolveCommand({
    provisioned: () => provisionedBinFromInstallDir(config.install_dir),
  })
}

async function resolveOrProvisionCommand(
  deps: CodegraphBootstrapDeps,
  config: Partial<CodegraphConfig>,
): Promise<CodegraphCommandResolution | null> {
  const resolved = resolveInitialCommand(deps, config)
  if (resolved.exists) return resolved
  if (config.auto_provision === false) return null
  const nodeSupport = deps.nodeSupport()
  if (!nodeSupport.supported) {
    deps.log("[codegraph-bootstrap] CodeGraph unsupported on this Node runtime; skipping bootstrap", {
      major: nodeSupport.major,
      reason: nodeSupport.reason,
      source: resolved.source,
    })
    return null
  }

  const installDir = config.install_dir ?? defaultInstallDir()
  const provisioned = await deps.ensureProvisioned({
    installDir,
    lockDir: join(installDir, "locks"),
    version: CODEGRAPH_VERSION,
  })
  if (!provisioned.provisioned || provisioned.binPath === undefined) {
    deps.log("[codegraph-bootstrap] CodeGraph unavailable; skipping bootstrap", {
      error: provisioned.error ?? "provisioning did not produce a binary",
      source: resolved.source,
    })
    return null
  }

  return { argsPrefix: [], command: provisioned.binPath, exists: true, source: "provisioned" }
}

async function runBootstrap(
  projectRoot: string,
  config: Partial<CodegraphConfig>,
  deps: CodegraphBootstrapDeps,
): Promise<void> {
  try {
    const autoInit = config.auto_init !== false
    const codegraphPath = join(projectRoot, ".codegraph")
    if (!autoInit && !existsSync(codegraphPath)) {
      deps.log("[codegraph-bootstrap] CodeGraph auto_init disabled and .codegraph not present; skipping bootstrap", {
        projectRoot,
      })
      return
    }

    const command = await resolveOrProvisionCommand(deps, config)
    if (command === null) {
      deps.log("[codegraph-bootstrap] CodeGraph unavailable; skipping bootstrap", { projectRoot })
      return
    }
    const nodeSupport = deps.nodeSupport()
    if (command.source !== "bundled" && command.source !== "env" && !nodeSupport.supported) {
      deps.log("[codegraph-bootstrap] CodeGraph unsupported on this Node runtime; skipping bootstrap", {
        major: nodeSupport.major,
        projectRoot,
        reason: nodeSupport.reason,
      })
      return
    }

    const workspace = deps.prepareWorkspace(projectRoot)
    deps.ensureGitignored(projectRoot)
    const env = codegraphEnv(deps, config)
    const status = await deps.runCommand(projectRoot, command.command, [...command.argsPrefix, "status", "--json"], {
      env,
      timeoutMs: COMMAND_TIMEOUT_MS,
    })
    const decision = decideCodegraphStartupAction(status)
    if (decision.kind === "skip") {
      deps.log("[codegraph-bootstrap] CodeGraph status failed; skipping bootstrap", { projectRoot, reason: decision.reason })
      return
    }

    const actionArgs = command.argsPrefix.concat(decision.kind === "init" ? ["init"] : ["sync"])
    const action = await deps.runCommand(projectRoot, command.command, actionArgs, { env, timeoutMs: COMMAND_TIMEOUT_MS })
    deps.log("[codegraph-bootstrap] CodeGraph bootstrap finished", {
      action: decision.kind,
      exitCode: action.exitCode,
      mode: workspace.mode,
      projectRoot,
      timedOut: action.timedOut,
    })
  } catch (error) {
    if (error instanceof Error) {
      deps.log("[codegraph-bootstrap] Bootstrap failed", { error: error.message, projectRoot })
      return
    }
    deps.log("[codegraph-bootstrap] Bootstrap failed", { error: String(error), projectRoot })
  }
}

const defaultDeps: CodegraphBootstrapDeps = {
  buildEnv: buildCodegraphEnv,
  ensureGitignored: ensureCodegraphGitignored,
  ensureProvisioned: ensureCodegraphProvisioned,
  log,
  nodeSupport: resolveCodegraphNodeSupport,
  prepareWorkspace: prepareCodegraphWorkspace,
  resolveCommand: resolveCodegraphCommand,
  runCommand: runCodegraphCommand,
  schedule: defaultSchedule,
}

export function clearCodegraphBootstrapProjectsForTesting(): void {
  bootstrappedProjects.clear()
}

export function createCodegraphBootstrapHook(
  ctx: CodegraphBootstrapContext,
  config: Partial<CodegraphConfig> | undefined,
  depsOverride: Partial<CodegraphBootstrapDeps> = {},
) {
  const deps: CodegraphBootstrapDeps = { ...defaultDeps, ...depsOverride }
  const codegraphConfig = config ?? {}

  return {
    event(input: CodegraphBootstrapEventInput): void {
      try {
        if (input.event.type !== "session.created") return
        if (codegraphConfig.enabled === false) return

        const projectRoot = resolveCodegraphProjectRoot(input.event.properties, ctx.directory)
        if (bootstrappedProjects.has(projectRoot)) return

        bootstrappedProjects.add(projectRoot)
        deps.schedule(() => runBootstrap(projectRoot, codegraphConfig, deps))
      } catch (error) {
        if (error instanceof Error) {
          deps.log("[codegraph-bootstrap] Event handler failed", { error: error.message })
          return
        }
        deps.log("[codegraph-bootstrap] Event handler failed", { error: String(error) })
      }
    },
  }
}
