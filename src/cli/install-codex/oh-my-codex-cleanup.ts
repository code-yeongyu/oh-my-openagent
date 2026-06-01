import { delimiter, dirname, isAbsolute, join, resolve } from "node:path"
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
  const ownedOmx = omxPath ? await resolveOhMyCodexCommand(omxPath) : null
  if (ownedOmx) {
    if (input.confirmCleanup && !(await input.confirmCleanup({ omxPath }))) {
      throw new Error("Codex install cancelled: existing oh-my-codex cleanup was not approved.")
    }
    if (ownedOmx.canExecute) {
      try {
        await input.runCommand(omxPath, ["uninstall", "--purge"], { cwd: input.repoRoot })
      } catch (error) {
        omxUninstallError = error instanceof Error ? error : new Error(String(error))
      }
    }
  }

  await input.runCommand("npm", ["uninstall", "-g", "oh-my-codex"], { cwd: input.repoRoot })
  await removeOhMyCodexResidue(input.codexHome)

  const remainingOmxPath = await findCommand("omx", input.env, input.platform)
  if (remainingOmxPath && await resolveOhMyCodexCommand(remainingOmxPath)) {
    await rm(remainingOmxPath, { force: true })
  }

  const verifiedOmxPath = await findCommand("omx", input.env, input.platform)
  if (verifiedOmxPath && await resolveOhMyCodexCommand(verifiedOmxPath)) {
    throw new Error(ohMyCodexCleanupFailureMessage(verifiedOmxPath, omxUninstallError))
  }
}

function ohMyCodexCleanupFailureMessage(omxPath: string, uninstallError: Error | null): string {
  const base = `oh-my-codex cleanup failed: omx is still installed at ${omxPath}`
  return uninstallError ? `${base}; omx uninstall failed: ${uninstallError.message}` : base
}

type OhMyCodexCommand = {
  readonly canExecute: boolean
}

async function resolveOhMyCodexCommand(path: string): Promise<OhMyCodexCommand | null> {
  if (isOhMyCodexPackagePath(path)) return { canExecute: true }

  try {
    const target = await readlink(path)
    if (isOhMyCodexPackagePath(target)) return { canExecute: true }
  } catch (error) {
    if (!(error instanceof Error)) return null
  }

  try {
    const content = await readFile(path, "utf8")
    const target = resolveOhMyCodexShimTarget(path, content)
    return target && await isCommandFile(target) ? { canExecute: false } : null
  } catch (error) {
    if (error instanceof Error) return null
    return null
  }
}

function isOhMyCodexPackagePath(path: string): boolean {
  return /(?:^|[\\/])node_modules[\\/]oh-my-codex(?:[\\/]|$)/.test(path) ||
    /(?:^|[\\/])oh-my-codex[\\/]bin[\\/]omx(?:\.[^\\/]*)?$/.test(path)
}

function resolveOhMyCodexShimTarget(path: string, content: string): string {
  const relativeMatch = /(?:^|\s)(?:exec\s+)?(?:node(?:\.exe)?\s+)?(?<target>(?:\.\.?[\\/])[^"'\s]*node_modules[\\/]oh-my-codex[\\/]bin[\\/]omx(?:\.[^"'\s]*)?)/m.exec(content)
  const relativeTarget = relativeMatch?.groups?.target
  if (relativeTarget) return resolveOhMyCodexPackageTarget(path, relativeTarget)

  const dp0Match = /(?:%~dp0|%dp0%)[\\/]*(?<target>(?:\.\.[\\/])?node_modules[\\/]oh-my-codex[\\/]bin[\\/]omx(?:\.[^"'\s]*)?)/i.exec(content)
  const dp0Target = dp0Match?.groups?.target
  return dp0Target ? resolveOhMyCodexPackageTarget(path, dp0Target) : ""
}

function resolveOhMyCodexPackageTarget(path: string, target: string): string {
  const resolvedTarget = resolve(dirname(path), target.replaceAll("\\", "/"))
  return isOhMyCodexPackagePath(resolvedTarget) ? resolvedTarget : ""
}

async function removeOhMyCodexResidue(codexHome: string): Promise<void> {
  await rm(join(codexHome, "plugins", "cache", "oh-my-codex-local"), { recursive: true, force: true })
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
    if (directory.trim().length === 0 || !isAbsolute(directory)) continue
    for (const name of names) {
      const path = join(directory, name)
      if (await isCommandFile(path, platform)) return path
    }
  }

  return ""
}

async function isCommandFile(path: string, platform?: CodexInstallPlatform): Promise<boolean> {
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
