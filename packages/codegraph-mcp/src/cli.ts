#!/usr/bin/env node
import { existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

import {
  buildCodegraphEnv,
  CODEGRAPH_VERSION,
  ensureCodegraphProvisioned,
  resolveCodegraphCommand,
} from "@oh-my-opencode/utils/codegraph"

import { createProjectSynchronizer } from "./project-sync.js"
import { runCodegraphMcpProxy } from "./proxy.js"
import type { CodegraphCommandSpec } from "./types.js"

export async function runCodegraphMcpCli(): Promise<number> {
  const homeDir = homedir()
  const env: Record<string, string | undefined> = { ...process.env, ...buildCodegraphEnv({ homeDir }) }
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

async function resolveOrProvisionCommand(
  homeDir: string,
  env: Record<string, string | undefined>,
): Promise<CodegraphCommandSpec> {
  const installDir = env["CODEGRAPH_INSTALL_DIR"] ?? join(homeDir, ".omo", "codegraph")
  const provisioned = () => {
    const candidate = join(installDir, "bin", process.platform === "win32" ? "codegraph.cmd" : "codegraph")
    return existsSync(candidate) ? candidate : null
  }
  const resolved = resolveCodegraphCommand({ env, homeDir, provisioned })
  if (resolved.exists) return resolved

  const result = await ensureCodegraphProvisioned({
    installDir,
    lockDir: join(installDir, ".locks"),
    version: CODEGRAPH_VERSION,
  })
  if (!result.provisioned || result.binPath === undefined) {
    throw new Error(result.error ?? "CodeGraph provisioning did not produce a binary")
  }
  return { argsPrefix: [], command: result.binPath }
}

runCodegraphMcpCli().then(
  (exitCode) => {
    process.exitCode = exitCode
  },
  (error: unknown) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)
    process.exitCode = 1
  },
)
