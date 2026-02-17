import { delimiter, dirname, join } from "node:path"

const OPENCODE_COMMANDS = ["opencode", "opencode-desktop"] as const
const WINDOWS_SUFFIXES = ["", ".exe", ".cmd", ".bat", ".ps1"] as const

function getCommandCandidates(platform: NodeJS.Platform): string[] {
  if (platform !== "win32") return [...OPENCODE_COMMANDS]

  return OPENCODE_COMMANDS.flatMap((command) =>
    WINDOWS_SUFFIXES.map((suffix) => `${command}${suffix}`),
  )
}

export function collectCandidateBinaryPaths(
  pathEnv: string | undefined,
  which: (command: string) => string | null | undefined = Bun.which,
  platform: NodeJS.Platform = process.platform,
): string[] {
  const seen = new Set<string>()
  const candidates: string[] = []
  const commandCandidates = getCommandCandidates(platform)

  const addCandidate = (binaryPath: string | undefined | null): void => {
    if (!binaryPath || seen.has(binaryPath)) return
    seen.add(binaryPath)
    candidates.push(binaryPath)
  }

  for (const command of commandCandidates) {
    addCandidate(which(command))
  }

  for (const entry of (pathEnv ?? "").split(delimiter).filter(Boolean)) {
    for (const command of commandCandidates) {
      addCandidate(join(entry, command))
    }
  }

  return candidates
}

export async function canExecuteBinary(binaryPath: string): Promise<boolean> {
  try {
    const proc = Bun.spawn([binaryPath, "--version"], {
      stdout: "pipe",
      stderr: "pipe",
    })
    await proc.exited
    return proc.exitCode === 0
  } catch {
    return false
  }
}

export async function findWorkingOpencodeBinary(
  pathEnv: string | undefined = process.env.PATH,
  probe: (binaryPath: string) => Promise<boolean> = canExecuteBinary,
  which: (command: string) => string | null | undefined = Bun.which,
  platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
  const candidates = collectCandidateBinaryPaths(pathEnv, which, platform)
  for (const candidate of candidates) {
    if (await probe(candidate)) {
      return candidate
    }
  }
  return null
}

export function buildPathWithBinaryFirst(pathEnv: string | undefined, binaryPath: string): string {
  const preferredDir = dirname(binaryPath)
  const existing = (pathEnv ?? "").split(delimiter).filter(
    (entry) => entry.length > 0 && entry !== preferredDir,
  )
  return [preferredDir, ...existing].join(delimiter)
}

export async function withWorkingOpencodePath<T>(
  startServer: () => Promise<T>,
  finder: (pathEnv: string | undefined) => Promise<string | null> = findWorkingOpencodeBinary,
): Promise<T> {
  const originalPath = process.env.PATH
  const binaryPath = await finder(originalPath)

  if (!binaryPath) {
    return startServer()
  }

  process.env.PATH = buildPathWithBinaryFirst(originalPath, binaryPath)
  try {
    return await startServer()
  } finally {
    process.env.PATH = originalPath
  }
}
