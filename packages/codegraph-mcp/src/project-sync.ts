import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

import { ensureCodegraphGitignored, prepareCodegraphWorkspace } from "@oh-my-opencode/utils/codegraph"
import { isPlainRecord } from "@oh-my-opencode/mcp-stdio-core"

import { runCodegraphCommand } from "./process.js"
import type {
  CodegraphCommandResult,
  CodegraphCommandRunner,
  CodegraphCommandSpec,
  CodegraphProjectSynchronizer,
} from "./types.js"

export interface CreateProjectSynchronizerOptions {
  readonly command: CodegraphCommandSpec
  readonly env: Record<string, string | undefined>
  readonly homeDir: string
  readonly run?: CodegraphCommandRunner
}

export type CodegraphProjectReadyResult =
  | {
      readonly action: "initialized" | "synced"
      readonly exitCode: number
      readonly projectRoot: string
      readonly timedOut: boolean
    }
  | {
      readonly action: "skipped"
      readonly projectRoot: string
    }

export class CodegraphProjectSyncError extends Error {
  readonly action: "init" | "status" | "sync"
  readonly projectRoot: string

  constructor(action: "init" | "status" | "sync", projectRoot: string, detail: string) {
    super(`CodeGraph ${action} failed in ${projectRoot}: ${detail}`)
    this.name = "CodegraphProjectSyncError"
    this.action = action
    this.projectRoot = projectRoot
  }
}

export function createProjectSynchronizer(options: CreateProjectSynchronizerOptions): CodegraphProjectSynchronizer {
  return {
    initialize: async (projectRoot, autoInit) => {
      await ensureCodegraphProjectReady(projectRoot, autoInit, options)
    },
    refresh: async (projectPath, autoInit) =>
      (await ensureCodegraphProjectReady(projectPath, autoInit, options)).action !== "skipped",
  }
}

export async function ensureCodegraphProjectReady(
  projectPath: string,
  autoInit: boolean,
  options: CreateProjectSynchronizerOptions,
): Promise<CodegraphProjectReadyResult> {
  const run = options.run ?? runCodegraphCommand
  const indexedRoot = findCodegraphRoot(projectPath)
  const projectRoot = indexedRoot ?? resolve(projectPath)
  if (indexedRoot === null) {
    if (!autoInit) return { action: "skipped", projectRoot }
    prepareCodegraphWorkspace(projectRoot, { homeDir: options.homeDir })
    ensureCodegraphGitignored(projectRoot)
  }

  const status = await run(projectRoot, options.command, ["status", "--json"], options.env)
  if (status.timedOut) throw new CodegraphProjectSyncError("status", projectRoot, "command timed out")
  const initialized = parseInitialized(status.stdout, status.stderr)
  if (initialized === false) {
    if (!autoInit) return { action: "skipped", projectRoot }
    const result = await runRequired("init", projectRoot, options, run)
    return { action: "initialized", exitCode: result.exitCode, projectRoot, timedOut: result.timedOut }
  }
  if (initialized === true) {
    const result = await runRequired("sync", projectRoot, options, run)
    return { action: "synced", exitCode: result.exitCode, projectRoot, timedOut: result.timedOut }
  }
  const detail = status.stderr.trim() || `status exited ${status.exitCode}`
  throw new CodegraphProjectSyncError("status", projectRoot, detail)
}

export function findCodegraphRoot(startPath: string): string | null {
  let current = resolve(startPath)
  while (true) {
    if (existsSync(join(current, ".codegraph", "codegraph.db"))) return current
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

async function runRequired(
  action: "init" | "sync",
  projectRoot: string,
  options: CreateProjectSynchronizerOptions,
  run: CodegraphCommandRunner,
): Promise<CodegraphCommandResult> {
  const result = await run(projectRoot, options.command, [action], options.env)
  if (result.exitCode === 0 && !result.timedOut) return result
  const detail = result.timedOut ? "command timed out" : result.stderr.trim() || `exit code ${result.exitCode}`
  throw new CodegraphProjectSyncError(action, projectRoot, detail)
}

function parseInitialized(stdout: string, stderr: string): boolean | null {
  const text = `${stdout}\n${stderr}`.trim()
  try {
    const parsed: unknown = JSON.parse(stdout)
    if (isPlainRecord(parsed)) {
      const value = parsed["initialized"] ?? parsed["isInitialized"] ?? parsed["ready"]
      if (typeof value === "boolean") return value
    }
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error
  }
  const normalized = text.toLowerCase()
  if (normalized.includes("not initialized") || normalized.includes("uninitialized")) return false
  if (normalized.includes("initialized") || normalized.includes("ready")) return true
  return null
}
