export interface BashCommandFeatures {
  raw: string
  verb: string
  flags: string[]
  targets: string[]
  has_recursive_flag: boolean
  has_force_flag: boolean
  targets_root: boolean
  targets_absolute_path: boolean
  targets_device: boolean
  targets_system_path: boolean
  is_fork_bomb: boolean
  is_kill_init: boolean
  is_disk_format: boolean
  is_raw_disk_write: boolean
  is_system_shutdown: boolean
}

export interface WriteTargetFeatures {
  raw: string
  segments: string[]
  is_absolute: boolean
  is_hidden_dotfile: boolean
  is_dotenv: boolean
  is_ssh_dir: boolean
  is_credential_name: boolean
  is_etc: boolean
  is_usr: boolean
  is_bin: boolean
  is_sbin: boolean
  is_node_modules: boolean
  is_shell_rc: boolean
}

const SYSTEM_CRITICAL_TOP_LEVEL = new Set(["etc", "usr", "bin", "sbin", "boot", "sys", "proc"])
const SHELL_RC_NAMES = new Set([".bashrc", ".zshrc", ".profile", ".bash_profile", ".zprofile"])

function tokenizeCommand(command: string): string[] {
  const trimmed = command.trim()
  if (trimmed.length === 0) return []
  return trimmed.split(/\s+/).filter((token) => token.length > 0)
}

function isFlag(token: string): boolean {
  return token.startsWith("-") && token.length > 1
}

function expandShortFlags(flag: string): string[] {
  if (!flag.startsWith("-") || flag.startsWith("--")) return [flag]
  const chars = flag.slice(1)
  return chars.split("").map((c) => `-${c}`)
}

function detectForkBomb(command: string): boolean {
  return /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;\s*:/.test(command)
}

function detectKillInit(command: string): boolean {
  return /\bkill\s+-9\s+1\b/.test(command)
}

function detectDiskFormat(verb: string): boolean {
  return /^mkfs(\.|\b)/.test(verb)
}

function detectRawDiskWrite(verb: string, command: string): boolean {
  if (verb === "dd" && /\bif=/.test(command)) return true
  if (/>\s*\/dev\/(sd|nvme|disk)/.test(command)) return true
  return false
}

function detectSystemShutdown(verb: string): boolean {
  return ["shutdown", "reboot", "halt", "poweroff"].includes(verb)
}

function isAbsoluteUnixPath(token: string): boolean {
  return token.startsWith("/") && !token.startsWith("//")
}

function isDevicePath(token: string): boolean {
  return /^\/dev\/(sd|nvme|disk|hd)/.test(token)
}

function isSystemPath(token: string): boolean {
  if (!isAbsoluteUnixPath(token)) return false
  const firstSegment = token.split("/").filter((s) => s.length > 0)[0]
  return firstSegment !== undefined && SYSTEM_CRITICAL_TOP_LEVEL.has(firstSegment)
}

function isRootTarget(token: string): boolean {
  return token === "/" || /^\/\s*$/.test(token)
}

export function extractBashFeatures(command: string): BashCommandFeatures {
  const tokens = tokenizeCommand(command)
  const verb = tokens[0]?.toLowerCase() ?? ""
  const flags: string[] = []
  const targets: string[] = []

  for (const token of tokens.slice(1)) {
    if (isFlag(token)) {
      for (const expanded of expandShortFlags(token)) {
        flags.push(expanded.toLowerCase())
      }
    } else {
      targets.push(token)
    }
  }

  const hasRecursive = flags.some((f) => f === "-r" || f === "-rf" || f === "-fr" || f === "--recursive")
  const hasForce = flags.some((f) => f === "-f" || f === "-rf" || f === "-fr" || f === "--force")
  const targetsRoot = targets.some(isRootTarget)
  const targetsAbsolute = targets.some(isAbsoluteUnixPath)
  const targetsDevice = targets.some(isDevicePath) || isDevicePath(command)
  const targetsSystem = targets.some(isSystemPath)
  const targetsRWorld = /chmod\s+(.*\s+)?777\b/.test(command)
  const targetsRecursiveChmod = verb === "chmod" && hasRecursive

  return {
    raw: command,
    verb,
    flags,
    targets,
    has_recursive_flag: hasRecursive,
    has_force_flag: hasForce,
    targets_root: targetsRoot,
    targets_absolute_path: targetsAbsolute,
    targets_device: targetsDevice,
    targets_system_path: targetsSystem || targetsRWorld || targetsRecursiveChmod,
    is_fork_bomb: detectForkBomb(command),
    is_kill_init: detectKillInit(command),
    is_disk_format: detectDiskFormat(verb),
    is_raw_disk_write: detectRawDiskWrite(verb, command),
    is_system_shutdown: detectSystemShutdown(verb),
  }
}

function pathSegments(path: string): string[] {
  return path.split("/").filter((s) => s.length > 0)
}

export function extractWriteFeatures(filePath: string): WriteTargetFeatures {
  const trimmed = filePath.trim()
  const segments = pathSegments(trimmed)
  const lastSegment = segments[segments.length - 1] ?? ""
  const homeRcMatch = trimmed.match(/^~\/(\.[^\/]+)/)
  const homeRcName = homeRcMatch ? homeRcMatch[1] : ""

  const isAbsolute = trimmed.startsWith("/")
  const lowercaseLast = lastSegment.toLowerCase()
  const isDotenv = lastSegment === ".env" || /^\.env\./.test(lastSegment) || lastSegment.endsWith(".env")
  const isHidden = lastSegment.startsWith(".") && lastSegment.length > 1 && !isDotenv
  const isSshDir = segments.includes(".ssh") || trimmed.includes("/.ssh/")
  const isCredentialName = /\b(credentials|secrets|tokens|password|api[-_]?key)\b/i.test(lastSegment)
  const isEtc = isAbsolute && segments[0] === "etc"
  const isUsr = isAbsolute && segments[0] === "usr"
  const isBin = isAbsolute && segments[0] === "bin"
  const isSbin = isAbsolute && segments[0] === "sbin"
  const isNodeModules = segments.includes("node_modules")
  const isShellRc = SHELL_RC_NAMES.has(lowercaseLast) || SHELL_RC_NAMES.has(homeRcName.toLowerCase())

  return {
    raw: trimmed,
    segments,
    is_absolute: isAbsolute,
    is_hidden_dotfile: isHidden,
    is_dotenv: isDotenv,
    is_ssh_dir: isSshDir,
    is_credential_name: isCredentialName,
    is_etc: isEtc,
    is_usr: isUsr,
    is_bin: isBin,
    is_sbin: isSbin,
    is_node_modules: isNodeModules,
    is_shell_rc: isShellRc,
  }
}
