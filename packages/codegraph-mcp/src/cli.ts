#!/usr/bin/env node
import { existsSync, realpathSync } from "node:fs"
import { homedir } from "node:os"
import { basename, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

import {
  buildCodegraphEnv,
  CODEGRAPH_VERSION,
  ensureCodegraphProvisioned,
  resolveCodegraphCommand,
} from "@oh-my-opencode/utils/codegraph"
import type { ResolveCodegraphCommandOptions } from "@oh-my-opencode/utils/codegraph"

import { createProjectSynchronizer } from "./project-sync.js"
import { runCodegraphMcpProxy } from "./proxy.js"
import type { CodegraphCommandSpec } from "./types.js"

export type CodegraphCliEnv = Record<string, string | undefined>

export interface CodegraphMcpCliEnvOptions {
  readonly homeDir: string
  readonly input: CodegraphCliEnv
}

type CodegraphProvisioner = typeof ensureCodegraphProvisioned
type CodegraphResolver = typeof resolveCodegraphCommand

export interface ResolveOrProvisionCommandDeps {
  readonly ensureProvisioned?: CodegraphProvisioner
  readonly fileExists?: ResolveCodegraphCommandOptions["fileExists"]
  readonly resolveCommand?: CodegraphResolver
}

export async function runCodegraphMcpCli(): Promise<number> {
  const homeDir = homedir()
  const env = createCodegraphMcpCliEnv({ homeDir, input: process.env })
  const command = await resolveOrProvisionCommand(homeDir, env)
  const synchronizer = createProjectSynchronizer({ command, env, homeDir })
  return runCodegraphMcpProxy({
    autoInit: env["OMO_CODEGRAPH_AUTO_INIT"] !== "0",
    command,
    cwd: process.cwd(),
    env,
    synchronizer,
  })
}

export function createCodegraphMcpCliEnv(options: CodegraphMcpCliEnvOptions): CodegraphCliEnv {
  const safeDefaults = buildCodegraphEnv({ homeDir: options.homeDir })
  return {
    ...options.input,
    ...safeDefaults,
    ...(options.input["CODEGRAPH_INSTALL_DIR"] === undefined
      ? {}
      : { CODEGRAPH_INSTALL_DIR: options.input["CODEGRAPH_INSTALL_DIR"] }),
  }
}

export async function resolveOrProvisionCommand(
  homeDir: string,
  env: CodegraphCliEnv,
  deps: ResolveOrProvisionCommandDeps = {},
): Promise<CodegraphCommandSpec> {
  const fileExists = deps.fileExists ?? existsSync
  const installDir = env["CODEGRAPH_INSTALL_DIR"] ?? join(homeDir, ".omo", "codegraph")
  const provisioned = () => {
    const candidate = join(installDir, "bin", process.platform === "win32" ? "codegraph.cmd" : "codegraph")
    return fileExists(candidate) ? candidate : null
  }
  const resolved = (deps.resolveCommand ?? resolveCodegraphCommand)({ env, homeDir, provisioned })
  if (resolved.exists) return resolved

  const result = await (deps.ensureProvisioned ?? ensureCodegraphProvisioned)({
    installDir,
    lockDir: join(installDir, ".locks"),
    version: CODEGRAPH_VERSION,
  })
  if (!result.provisioned || result.binPath === undefined) {
    throw new Error(result.error ?? "CodeGraph provisioning did not produce a binary")
  }
  return { argsPrefix: [], command: result.binPath }
}

if (isDirectInvocation(process.argv[1])) {
  runCodegraphMcpCli().then(
    (exitCode) => {
      process.exitCode = exitCode
    },
    (error: unknown) => {
      process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)
      process.exitCode = 1
    },
  )
}

function isDirectInvocation(argvPath: string | undefined): boolean {
  if (argvPath === undefined) return false
  const modulePath = fileURLToPath(import.meta.url)
  const moduleName = basename(modulePath)
  if (moduleName !== "cli.js" && moduleName !== "cli.ts") return false
  return realpathSync(resolve(argvPath)) === realpathSync(modulePath)
}
