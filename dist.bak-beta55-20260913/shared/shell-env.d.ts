export type ShellType = "unix" | "powershell" | "cmd" | "csh";
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
export declare function detectShellType(platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv): ShellType;
/**
 * Shell-escape a value for use in environment variable assignment.
 *
 * @param value - The value to escape
 * @param shellType - The target shell type
 * @returns Escaped value appropriate for the shell
 */
export declare function shellEscape(value: string, shellType: ShellType): string;
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
export declare function buildEnvPrefix(env: Record<string, string>, shellType: ShellType): string;
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
export { shellEscapeForDoubleQuotedCommand } from "@oh-my-opencode/utils";
export declare function shellSingleQuote(value: string): string;
