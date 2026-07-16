import { spawn } from "node:child_process"
import { existsSync, readFileSync, realpathSync } from "node:fs"
import { homedir } from "node:os"
import {
  findNewestCachedCodexComponentCli,
  resolveCodexComponentBinCandidates,
  resolveDefaultCodexHome,
  RUNTIME_WRAPPER_MARKER,
} from "@oh-my-opencode/omo-codex/install"

/**
 * Sentinel forwarded to every delegated ulw-loop child. A delegation chain is
 * expected to terminate in ONE hop (component bin or cached component CLI).
 * Without it, a broken install (missing component CLI) made the legacy `omo`
 * wrapper re-enter this resolver: wrapper -> omo CLI -> wrapper -> ... which
 * fork-bombed thousands of live processes and exhausted system RAM.
 */
export const ULW_LOOP_DELEGATION_SENTINEL = "OMO_ULW_LOOP_DELEGATED"

export type CodexUlwLoopCommand = {
  readonly executable: string
  readonly argsPrefix: readonly string[]
}

type ResolveCodexUlwLoopCommandInput = {
  readonly env?: NodeJS.ProcessEnv
  readonly homeDir?: string
  readonly currentExecutablePaths?: readonly string[]
}

export function resolveCodexUlwLoopCommand(input: ResolveCodexUlwLoopCommandInput = {}): CodexUlwLoopCommand | null {
  const env = input.env ?? process.env
  const homeDir = input.homeDir ?? homedir()
  const localComponentBin = resolveLocalUlwLoopBin(env, homeDir)
  if (localComponentBin !== null) return { executable: localComponentBin, argsPrefix: [] }

  const componentCli = findNewestCachedCodexComponentCli({
    codexHome: env.CODEX_HOME ?? resolveDefaultCodexHome(homeDir),
    componentName: "ulw-loop",
  })
  if (componentCli !== null) return { executable: process.execPath, argsPrefix: [componentCli] }

  if (env[ULW_LOOP_DELEGATION_SENTINEL] === "1") return null

  const legacyLocalBin = resolveLegacyLocalOmoBin(
    env,
    homeDir,
    input.currentExecutablePaths ?? [process.argv[1]].filter((value): value is string => typeof value === "string"),
  )
  if (legacyLocalBin !== null) return { executable: legacyLocalBin, argsPrefix: ["ulw-loop"] }

  return null
}

export async function codexUlwLoop(args: readonly string[]): Promise<number> {
  const command = resolveCodexUlwLoopCommand()
  if (command === null) {
    console.error("Codex ulw-loop is not installed. Run: npx lazycodex-ai@latest install --no-tui")
    return 1
  }

  const { promise, resolve } = Promise.withResolvers<number>()
  const child = spawn(command.executable, [...command.argsPrefix, ...args], {
    stdio: "inherit",
    env: { ...process.env, [ULW_LOOP_DELEGATION_SENTINEL]: "1" },
  })
  child.on("error", (error) => {
    console.error(error.message)
    resolve(1)
  })
  child.on("close", (code) => resolve(code ?? 1))
  return promise
}

function resolveLocalUlwLoopBin(env: NodeJS.ProcessEnv, homeDir: string): string | null {
  const candidates = resolveCodexComponentBinCandidates({ executableName: "omo-ulw-loop", env, homeDir })
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function resolveLegacyLocalOmoBin(env: NodeJS.ProcessEnv, homeDir: string, currentExecutablePaths: readonly string[]): string | null {
  const candidates = resolveCodexComponentBinCandidates({ executableName: "omo", env, homeDir })
  return (
    candidates.find(
      (candidate) =>
        existsSync(candidate) &&
        !isCurrentExecutable(candidate, currentExecutablePaths) &&
        !isGeneratedRuntimeWrapper(candidate),
    ) ?? null
  )
}

/**
 * A generated `omo` runtime wrapper just re-execs this same CLI, so treating
 * it as a legacy delegation target creates a spawn cycle. Never delegate to it.
 */
function isGeneratedRuntimeWrapper(candidate: string): boolean {
  try {
    return readFileSync(candidate, "utf8").includes(RUNTIME_WRAPPER_MARKER)
  } catch (error) {
    if (error instanceof Error) return false
    return false
  }
}

function isCurrentExecutable(candidate: string, currentExecutablePaths: readonly string[]): boolean {
  const candidateRealPath = realpathOrSelf(candidate)
  return currentExecutablePaths.some((currentPath) => realpathOrSelf(currentPath) === candidateRealPath)
}

function realpathOrSelf(path: string): string {
  try {
    return realpathSync(path)
  } catch (error) {
    if (error instanceof Error) return path
    return path
  }
}
