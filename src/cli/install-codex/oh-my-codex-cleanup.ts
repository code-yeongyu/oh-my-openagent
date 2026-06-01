import { delimiter, join } from "node:path"
import { readFile, readlink, rm, stat } from "node:fs/promises"
import { defaultRunCommand } from "./codex-process"
import type { CodexInstallPlatform, OhMyCodexCleanupPrompt } from "./types"

export async function removeOhMyCodexBeforeInstall(input: {
  readonly codexHome: string
  readonly confirmCleanup?: OhMyCodexCleanupPrompt
  readonly env: { readonly [key: string]: string | undefined }
  readonly platform: CodexInstallPlatform
  readonly repoRoot: string
  readonly runCommand: typeof defaultRunCommand
}): Promise<void> {
  const omxPath = await findCommand("omx", input.env, input.platform)
  let omxUninstallError: Error | null = null
  if (omxPath && await isOhMyCodexCommand(omxPath)) {
    if (input.confirmCleanup && !(await input.confirmCleanup({ omxPath }))) {
      throw new Error("Codex install cancelled: existing oh-my-codex cleanup was not approved.")
    }
    try {
      await input.runCommand(omxPath, ["uninstall", "--purge"], { cwd: input.repoRoot })
    } catch (error) {
      omxUninstallError = error instanceof Error ? error : new Error(String(error))
    }
  }

  await input.runCommand("npm", ["uninstall", "-g", "oh-my-codex"], { cwd: input.repoRoot })
  await removeOhMyCodexResidue(input.codexHome, input.repoRoot)

  const remainingOmxPath = await findCommand("omx", input.env, input.platform)
  if (remainingOmxPath && await isOhMyCodexCommand(remainingOmxPath)) {
    await rm(remainingOmxPath, { force: true })
  }

  const verifiedOmxPath = await findCommand("omx", input.env, input.platform)
  if (verifiedOmxPath && await isOhMyCodexCommand(verifiedOmxPath)) {
    throw new Error(ohMyCodexCleanupFailureMessage(verifiedOmxPath, omxUninstallError))
  }
}

function ohMyCodexCleanupFailureMessage(omxPath: string, uninstallError: Error | null): string {
  const base = `oh-my-codex cleanup failed: omx is still installed at ${omxPath}`
  return uninstallError ? `${base}; omx uninstall failed: ${uninstallError.message}` : base
}

async function isOhMyCodexCommand(path: string): Promise<boolean> {
  if (isOhMyCodexPackagePath(path)) return true

  try {
    const target = await readlink(path)
    if (isOhMyCodexPackagePath(target)) return true
  } catch (error) {
    if (!(error instanceof Error)) return false
  }

  try {
    const content = await readFile(path, "utf8")
    return isOhMyCodexShimContent(content)
  } catch (error) {
    if (error instanceof Error) return false
    return false
  }
}

function isOhMyCodexPackagePath(path: string): boolean {
  return /(?:^|[\\/])node_modules[\\/]oh-my-codex(?:[\\/]|$)/.test(path) ||
    /(?:^|[\\/])oh-my-codex[\\/]bin[\\/]omx(?:\.[^\\/]*)?$/.test(path)
}

function isOhMyCodexShimContent(content: string): boolean {
  return /(?:^|[\\/])node_modules[\\/]oh-my-codex(?:[\\/]|$)/.test(content) ||
    /_where=.*oh-my-codex/.test(content) ||
    /require\(["']oh-my-codex(?:[\\/][^"']*)?["']\)/.test(content)
}

async function removeOhMyCodexResidue(codexHome: string, repoRoot: string): Promise<void> {
  await rm(join(codexHome, "plugins", "cache", "oh-my-codex-local"), { recursive: true, force: true })
  await rm(join(repoRoot, ".omx"), { recursive: true, force: true })
}

async function findCommand(
  command: string,
  env: { readonly [key: string]: string | undefined },
  platform: CodexInstallPlatform,
): Promise<string> {
  const extensions = platform === "win32" ? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";") : [""]
  const names = extensions.map((extension) => {
    const normalizedExtension = extension.toLowerCase()
    const normalizedCommand = command.toLowerCase()
    return normalizedCommand.endsWith(normalizedExtension) ? command : `${command}${extension}`
  })

  for (const directory of (env.PATH ?? "").split(delimiter)) {
    if (directory.trim().length === 0) continue
    for (const name of names) {
      const path = join(directory, name)
      if (await isCommandFile(path, platform)) return path
    }
  }

  return ""
}

async function isCommandFile(path: string, platform: CodexInstallPlatform): Promise<boolean> {
  try {
    const fileStat = await stat(path)
    if (!fileStat.isFile()) return false
    if (platform === "win32") return true
    return (fileStat.mode & 0o111) !== 0
  } catch (error) {
    if (error instanceof Error) return false
    return false
  }
}
