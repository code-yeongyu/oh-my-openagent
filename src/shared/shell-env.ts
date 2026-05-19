export type ShellType = "unix" | "powershell" | "cmd" | "csh"

/**
 * Detect the current shell type based on environment variables.
 * 
 * Detection priority:
 * 1. SHELL env var → Unix shell (explicit user choice takes precedence)
 * 2. Unix shell indicators on Windows → Git Bash, WSL, MSYS2
 * 3. PSModulePath → PowerShell
 * 4. Platform fallback → win32: cmd, others: unix
 * 
 * Note: Step 2 is scoped to Windows only because PSModulePath is always set
 * on Windows regardless of the active shell. BASH_VERSION is deliberately NOT
 * used — it is set by all bash shells, not just Git Bash. Instead we use MSYSTEM
 * (Git Bash / MSYS2) and WSL_DISTRO_NAME (WSL). The PATH-based fallback
 * detects Windows-specific Unix tool installation directories.
 */
export function detectShellType(): ShellType {
  if (process.env.SHELL) {
    const shell = process.env.SHELL
    if (shell.includes("csh") || shell.includes("tcsh")) {
      return "csh"
    }
    return "unix"
  }

  // On Windows, detect Unix-compatible shells (Git Bash, WSL, MSYS2).
  // PSModulePath is always set on Windows, so we must check these BEFORE it.
  // Indicators are shell-specific — we use MSYSTEM (MSYS2/Git Bash) and
  // WSL_DISTRO_NAME (WSL). BASH_VERSION is NOT used because it is set by
  // ALL bash shells, not just Git Bash.
  if (
    process.platform === "win32" &&
    (process.env.MSYSTEM || process.env.WSL_DISTRO_NAME)
  ) {
    return "unix"
  }

  if (process.platform === "win32" && detectUnixPathInPATH()) {
    return "unix"
  }

  if (process.env.PSModulePath) {
    return "powershell"
  }

  return process.platform === "win32" ? "cmd" : "unix"
}

function detectUnixPathInPATH(): boolean {
  const path = (process.env.PATH || process.env.Path || "").toLowerCase()
  // Check for Windows-specific Unix tool installation directories.
  // These contain backslash separators (Windows-only) and known
  // subdirectory names used by Git Bash, MSYS2, and Cygwin.
  // Generic paths like /usr/bin are NOT checked — they exist on every
  // Linux system and produce false positives when platform is mocked.
  // Use \git\usr\bin not just \git\: C:\Program Files\Git\bin is on PATH for
  // any shell on a machine with Git installed (PowerShell, cmd, etc.), but
  // C:\Program Files\Git\usr\bin is only added by Git Bash itself.
  if (path.includes("\\git\\usr\\bin") || path.includes("/git/usr/bin")) return true
  // Likewise \msys64\usr\bin not just \msys64\: \msys64\mingw64\bin may be
  // on system PATH without an active MSYS2 shell.
  if (path.includes("\\msys64\\usr\\bin") || path.includes("/msys64/usr/bin")) return true
  // Cygwin's \cygwin64\bin contains only Unix tools, so a broader match is
  // acceptable. \cygwin64 and \cygwin are both valid install directories.
  if (path.includes("\\cygwin")) return true
  return false
}

/**
 * Shell-escape a value for use in environment variable assignment.
 * 
 * @param value - The value to escape
 * @param shellType - The target shell type
 * @returns Escaped value appropriate for the shell
 */
export function shellEscape(value: string, shellType: ShellType): string {
  if (value === "") {
    return shellType === "cmd" ? '""' : "''"
  }

  switch (shellType) {
    case "unix":
    case "csh":
      if (/[^a-zA-Z0-9_\-.:\/]/.test(value)) {
        return `'${value.replace(/'/g, "'\\''")}'`
      }
      return value

    case "powershell":
      return `'${value.replace(/'/g, "''")}'`

    case "cmd":
      // Escape % first (for environment variable expansion), then " (for quoting)
      return `"${value.replace(/%/g, '%%').replace(/"/g, '""')}"`

    default:
      return value
  }
}

/**
 * Build environment variable prefix command for the target shell.
 * 
 * @param env - Record of environment variables to set
 * @param shellType - The target shell type
 * @returns Command prefix string to prepend to the actual command
 * 
 * @example
 * ```ts
 * // Unix: "export VAR1=val1 VAR2=val2; command"
 * buildEnvPrefix({ VAR1: "val1", VAR2: "val2" }, "unix")
 * // => "export VAR1=val1 VAR2=val2;"
 * 
 * // PowerShell: "$env:VAR1='val1'; $env:VAR2='val2'; command"
 * buildEnvPrefix({ VAR1: "val1", VAR2: "val2" }, "powershell")
 * // => "$env:VAR1='val1'; $env:VAR2='val2';"
 * 
 * // cmd.exe: "set VAR1=val1 && set VAR2=val2 && command"
 * buildEnvPrefix({ VAR1: "val1", VAR2: "val2" }, "cmd")
 * // => "set VAR1=\"val1\" && set VAR2=\"val2\" &&"
 * ```
 */
export function buildEnvPrefix(
  env: Record<string, string>,
  shellType: ShellType
): string {
  const entries = Object.entries(env)
  
  if (entries.length === 0) {
    return ""
  }

  switch (shellType) {
    case "unix": {
      const assignments = entries
        .map(([key, value]) => `${key}=${shellEscape(value, shellType)}`)
        .join(" ")
      return `export ${assignments};`
    }

    case "csh": {
      const assignments = entries
        .map(([key, value]) => `setenv ${key} ${shellEscape(value, shellType)}`)
        .join("; ")
      return `${assignments};`
    }

    case "powershell": {
      const assignments = entries
        .map(([key, value]) => `$env:${key}=${shellEscape(value, shellType)}`)
        .join("; ")
      return `${assignments};`
    }

    case "cmd": {
      const assignments = entries
        .map(([key, value]) => `set ${key}=${shellEscape(value, shellType)}`)
        .join(" && ")
      return `${assignments} &&`
    }

    default:
      return ""
  }
}

/**
 * Escape a value for use in a double-quoted shell -c command argument.
 * 
 * In shell -c "..." strings, these characters have special meaning and must be escaped:
 * - $ - variable expansion, command substitution $(...)
 * - ` - command substitution `...`
 * - \\ - escape character
 * - " - end quote
 * - ; | & - command separators
 * - # - comment
 * - () - grouping operators
 * 
 * @param value - The value to escape
 * @returns Escaped value safe for double-quoted shell -c argument
 * 
 * @example
 * ```ts
 * // For malicious input
 * const url = "http://localhost:3000'; cat /etc/passwd; echo '"
 * const escaped = shellEscapeForDoubleQuotedCommand(url)
 * // => "http://localhost:3000'\''; cat /etc/passwd; echo '"
 * 
 * // Usage in command:
 * const cmd = `/bin/sh -c "opencode attach ${escaped} --session ${sessionId}"`
 * ```
 */
export function shellEscapeForDoubleQuotedCommand(value: string): string {
  // Order matters: escape backslash FIRST, then other characters
  return value
    .replace(/\\/g, "\\\\") // escape backslash first
    .replace(/\$/g, "\\$") // escape dollar sign
    .replace(/`/g, "\\`") // escape backticks
    .replace(/"/g, "\\\"") // escape double quotes
    .replace(/;/g, "\\;") // escape semicolon (command separator)
    .replace(/\|/g, "\\|") // escape pipe (command separator)
    .replace(/&/g, "\\&") // escape ampersand
    .replace(/#/g, "\\#") // escape hash
    .replace(/\(/g, "\\(") // escape parentheses
    .replace(/\)/g, "\\)") // escape parentheses
}

export function shellSingleQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`
}
