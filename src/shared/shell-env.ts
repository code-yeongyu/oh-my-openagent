export type ShellType = "unix" | "powershell" | "cmd"

/**
 * Detect the current shell type based on environment variables.
 * 
 * Detection priority:
 * 1. PSModulePath → PowerShell
 * 2. SHELL env var → Unix shell
 * 3. Platform fallback → win32: cmd, others: unix
 */
export function detectShellType(): ShellType {
  if (process.env.PSModulePath) {
    return "powershell"
  }

  if (process.env.SHELL) {
    return "unix"
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
