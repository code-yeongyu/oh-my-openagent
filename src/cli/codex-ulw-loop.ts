import { spawn } from "node:child_process"
import { existsSync, readdirSync, realpathSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

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

  const componentCli = resolveNewestCachedUlwLoopCli(env.CODEX_HOME ?? join(homeDir, ".codex"))
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
  const candidates = [
    env.CODEX_LOCAL_BIN_DIR ? join(env.CODEX_LOCAL_BIN_DIR, "omo-ulw-loop") : undefined,
    join(homeDir, ".local", "bin", "omo-ulw-loop"),
    join(homeDir, ".codex", "bin", "omo-ulw-loop"),
  ].filter((value): value is string => typeof value === "string")

  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function resolveLegacyLocalOmoBin(env: NodeJS.ProcessEnv, homeDir: string, currentExecutablePaths: readonly string[]): string | null {
  const candidates = [
    env.CODEX_LOCAL_BIN_DIR ? join(env.CODEX_LOCAL_BIN_DIR, "omo") : undefined,
    join(homeDir, ".local", "bin", "omo"),
    join(homeDir, ".codex", "bin", "omo"),
  ].filter((value): value is string => typeof value === "string")

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

function resolveNewestCachedUlwLoopCli(codexHome: string): string | null {
  const versionsRoot = join(codexHome, "plugins", "cache", "sisyphuslabs", "omo")
  if (!existsSync(versionsRoot)) return null

  const versions = readdirSync(versionsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort(compareVersionNames)
    .reverse()

  for (const version of versions) {
    const candidate = join(versionsRoot, version, "components", "ulw-loop", "dist", "cli.js")
    if (existsSync(candidate)) return candidate
  }
  return null
}

function compareVersionNames(left: string, right: string): number {
  const leftParts = left.split(".").map((part) => Number.parseInt(part, 10))
  const rightParts = right.split(".").map((part) => Number.parseInt(part, 10))
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const leftValue = Number.isFinite(leftParts[index] ?? Number.NaN) ? leftParts[index] ?? 0 : 0
    const rightValue = Number.isFinite(rightParts[index] ?? Number.NaN) ? rightParts[index] ?? 0 : 0
    if (leftValue !== rightValue) return leftValue - rightValue
  }
  return left.localeCompare(right)
}
