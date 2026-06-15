import { spawn } from "node:child_process"
import { existsSync, realpathSync } from "node:fs"
import { homedir } from "node:os"
import { findNewestCachedCodexComponentCli, resolveCodexComponentBinCandidates, resolveDefaultCodexHome } from "@oh-my-opencode/omo-codex/install"

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

  return new Promise((resolve) => {
    const child = spawn(command.executable, [...command.argsPrefix, ...args], { stdio: "inherit" })
    child.on("error", (error) => {
      console.error(error.message)
      resolve(1)
    })
    child.on("close", (code) => resolve(code ?? 1))
  })
}

function resolveLocalUlwLoopBin(env: NodeJS.ProcessEnv, homeDir: string): string | null {
  const candidates = resolveCodexComponentBinCandidates({ executableName: "omo-ulw-loop", env, homeDir })
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function resolveLegacyLocalOmoBin(env: NodeJS.ProcessEnv, homeDir: string, currentExecutablePaths: readonly string[]): string | null {
  const candidates = resolveCodexComponentBinCandidates({ executableName: "omo", env, homeDir })
  return candidates.find((candidate) => existsSync(candidate) && !isCurrentExecutable(candidate, currentExecutablePaths)) ?? null
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
