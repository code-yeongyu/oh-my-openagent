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
 * on Windows regardless of the active shell. Indicators are deliberately
 * specific (BASH_VERSION, MSYSTEM, WSL_DISTRO_NAME) — TERM is excluded
 * because some PowerShell users set it manually.
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
  // Indicators are shell-specific — no broad signals like TERM.
  if (
    process.platform === "win32" &&
    (process.env.BASH_VERSION ||
      process.env.MSYSTEM ||
      process.env.WSL_DISTRO_NAME)
  ) {
    return "unix"
  }

  if (process.env.PSModulePath) {
    return "powershell"
  }

  return process.platform === "win32" ? "cmd" : "unix"
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
    .replace(/&/g, "\\&") // escape ampersand (command separator)
    .replace(/#/g, "\\#") // escape hash (comment)
    .replace(/\(/g, "\\(") // escape parentheses
    .replace(/\)/g, "\\)") // escape parentheses
}
