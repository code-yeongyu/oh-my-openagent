import { execFile } from "node:child_process"
import { readFile, realpath, stat } from "node:fs/promises"
import { join } from "node:path"
import { runtimeHome } from "./bin/lib/agent-dir.js"
import { launchOptions, shouldPrintCompiledBanner } from "./compile-args"

export type UpdateMode = "auto" | "notify" | "off"
export type Ownership = { kind: "standalone"; path: string }
  | { kind: "manager-owned"; manager: string; command: string }
  | { kind: "unknown"; reason: string }
type OwnerQuery = { status?: number; stdout?: string; missing?: boolean; error?: string }
type OwnershipOptions = {
  platform?: NodeJS.Platform
  run?: (command: string, args: string[]) => Promise<OwnerQuery>
}

/** Matches Senpi envValue: first DEFINED OMO/SENPI/PI value, then JS truthiness. */
export function updateFlag(suffix: string, env: NodeJS.ProcessEnv): boolean {
  for (const prefix of ["OMO", "SENPI", "PI"]) {
    const value = env[`${prefix}_${suffix}`]
    if (value !== undefined) return Boolean(value)
  }
  return false
}

export async function updatePolicy(env: NodeJS.ProcessEnv = process.env): Promise<{ mode: UpdateMode; reason?: string }> {
  if (updateFlag("OFFLINE", env) || updateFlag("SKIP_VERSION_CHECK", env)) return { mode: "off" }
  let mode: unknown = env.OMO_AUTO_UPDATE
  if (mode === undefined) {
    try {
      const value = JSON.parse(await readFile(join(runtimeHome(env), ".omo", "updates", "settings.json"), "utf8"))
      mode = value?.mode
      if (mode === undefined) return { mode: "off", reason: "updates/settings.json requires mode auto, notify or off" }
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        return { mode: "off", reason: "Cannot read valid updates/settings.json; automatic updates disabled" }
      }
      mode = "auto"
    }
  }
  return mode === "auto" || mode === "notify" || mode === "off"
    ? { mode }
    : { mode: "off", reason: "OMO_AUTO_UPDATE or updates/settings.json mode must be auto, notify or off" }
}

export function eligibleUpdateLaunch(args: readonly string[], env: NodeJS.ProcessEnv, tty: boolean, development = false): boolean {
  if (development || !tty || env.CI || env.GITHUB_ACTIONS || env.BUILD_NUMBER) return false
  if (env.OMO_PROVISIONED_HANDOFF || env.OMO_UPDATE_WORKER || env.OMO_UPDATE_GENERATION || env.SENPI_TASK_ID || env.PI_TASK_ID
    || env.SENPI_INTERNAL_SUPERVISOR || env.OMO_INTERNAL_SUPERVISOR) return false
  const options = launchOptions(args)
  if (options.includes("--mode") || options.includes("--no-extensions") || options.includes("--json")) return false
  if (["host", "daemon", "thread", "trust", "account", "sync", "login", "logout", "whoami", "remote"].includes(options[0] ?? "")) return false
  if (options.some((arg) => arg.startsWith("--omo-update-") || arg.startsWith("--internal-"))) return false
  return shouldPrintCompiledBanner([...args], tty) && !options.includes("--help") && !options.includes("-h")
}

const query: NonNullable<OwnershipOptions["run"]> = (command, args) => new Promise((resolve) => {
  execFile(command, args, { encoding: "utf8", timeout: 3000, windowsHide: true }, (error, stdout) => {
    if (!error) { resolve({ status: 0, stdout }); return }
    if (error.code === "ENOENT") { resolve({ missing: true }); return }
    if (!error.killed && typeof error.code === "number") { resolve({ status: error.code, stdout }); return }
    resolve({ error: "ownership query failed or timed out" })
  })
})

export async function classifyInstallOwnership(path: string, options: OwnershipOptions = {}): Promise<Ownership> {
  const platform = options.platform ?? process.platform
  const run = options.run ?? query
  let canonical = path
  try { canonical = await realpath(path) } catch { /* Query errors and absent paths remain unknown below. */ }
  const normalized = canonical.replaceAll("\\", "/")
  const managed = /(?:\/node_modules\/|\/Cellar\/|^\/nix\/store\/|\/scoop\/apps\/|\/chocolatey\/|\/Microsoft\/WinGet\/Packages\/)/i.exec(normalized)
  if (managed) {
    const manager = normalized.includes("/Cellar/") ? "brew" : normalized.startsWith("/nix/") ? "nix"
      : /\/scoop\//i.test(normalized) ? "scoop" : /\/chocolatey\//i.test(normalized) ? "chocolatey"
        : /\/Microsoft\/WinGet\//i.test(normalized) ? "winget" : "npm/bun/pnpm/yarn"
    return { kind: "manager-owned", manager, command: `Update omo with the ${manager} installation command` }
  }
  if (platform === "linux") {
    for (const [manager, command, args, advice] of [
      ["pacman", "pacman", ["-Qqo", canonical], "pacman -Syu"],
      ["dpkg", "dpkg-query", ["-S", canonical], "apt upgrade"],
      ["rpm", "rpm", ["-qf", "--qf", "%{NAME}", canonical], "dnf upgrade"],
    ] as const) {
      const result = await run(command, [...args])
      if (result.status === 0 && result.stdout?.trim()) return { kind: "manager-owned", manager, command: advice }
      if (!result.missing && result.status !== 1) return { kind: "unknown", reason: `${manager} ownership query was inconclusive` }
    }
  }
  if (platform === "win32") {
    const literal = `'${canonical.replaceAll("'", "''")}'`
    const result = await run("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command",
      `$ErrorActionPreference='Stop'; $acl=Get-Acl -LiteralPath ${literal}; ` +
      "$identity=[Security.Principal.WindowsIdentity]::GetCurrent(); $owner=$acl.GetOwner([Security.Principal.SecurityIdentifier]).Value; " +
      "$admin=([Security.Principal.WindowsPrincipal]::new($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator); " +
      "if($owner -ne $identity.User.Value -and -not ($owner -eq 'S-1-5-32-544' -and $admin)){exit 1}; " +
      "foreach($rule in $acl.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier])){" +
      "if($rule.AccessControlType -eq 'Allow' -and $rule.IdentityReference.Value -in @('S-1-1-0','S-1-5-11','S-1-5-32-545') " +
      "-and ([int]$rule.FileSystemRights -band 852246)){exit 1}}; Write-Output 'standalone'",
    ])
    if (result.status !== 0 || result.stdout?.trim() !== "standalone") {
      return { kind: "unknown", reason: "Windows launcher ownership could not be established" }
    }
  }
  try {
    const info = await stat(canonical)
    if (!info.isFile() || (platform !== "win32" && ((process.getuid && info.uid !== process.getuid()) || (info.mode & 0o022) !== 0))) {
      return { kind: "unknown", reason: "Launcher is not an exclusively user-owned executable" }
    }
    // Runtime paths are pins, never new installations, even if this user owns the files.
    if (/[\\/](?:binary-runtime|generations)[\\/]/.test(canonical)) return { kind: "unknown", reason: "Runtime copies cannot enroll an installation" }
    return { kind: "standalone", path: canonical }
  } catch {
    return { kind: "unknown", reason: "Launcher identity could not be established" }
  }
}
