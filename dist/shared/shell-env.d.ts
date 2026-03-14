export type ShellType = "unix" | "powershell" | "cmd";
/**
 * Detect the current shell type based on environment variables.
 *
 * Detection priority:
 * 1. PSModulePath → PowerShell
 * 2. SHELL env var → Unix shell
 * 3. Platform fallback → win32: cmd, others: unix
 */
export declare function detectShellType(): ShellType;
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
