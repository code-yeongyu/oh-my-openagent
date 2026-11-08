import { resolveWin32Git } from "./win32-executable"
import { win32SystemExecutable } from "./win32-system-tools"

export interface SpawnTarget {
  readonly file: string
  readonly args: readonly string[]
  readonly argv0?: string
  readonly windowsVerbatimArguments?: true
}

// cmd.exe reinterprets these even inside quotes and they cannot be escaped for it (BatBadBut,
// CVE-2024-24576 / CVE-2024-27980). The set is Bun's `batch_arg_has_cmd_metachars`, so a batch
// wrapper refuses exactly the arguments Bun refused when it spawned the wrapper itself.
const CMD_METACHARACTERS = /["%&|<>^\r\n]/

// Windows drops trailing spaces and dots from the last path component, so `git.cmd.` is still a
// batch file (CVE-2024-43402); the check matches Bun's `is_batch_file`.
function isBatchFile(path: string): boolean {
  return /\.(?:cmd|bat)$/i.test(path.replace(/[ .]+$/, ""))
}

function refuseCmdMetacharacters(values: readonly string[]): void {
  for (const [index, value] of values.entries()) {
    if (!CMD_METACHARACTERS.test(value)) continue
    const target = index === 0 ? "The command name" : `The argument 'args[${index}]'`
    throw Object.assign(new TypeError(`${target} contains a cmd.exe special character and cannot be safely passed to a .bat/.cmd file. Received ${JSON.stringify(value)}`), {
      code: "ERR_INVALID_ARG_VALUE",
    })
  }
}

// Every value is quoted. With no `"` left (refused above), only a trailing backslash run needs
// doubling so the closing quote is not escaped for the CRT parser of the program the wrapper starts.
function quoteForCmd(value: string): string {
  return `"${value.replace(/(\\+)$/, "$1$1")}"`
}

/**
 * How to start `executable` (already resolved) as `name`. The bare name is spawned unchanged (POSIX).
 * An absolute program keeps `name` as argv[0]. A batch wrapper is run explicitly through System32
 * cmd.exe: CreateProcessW would otherwise re-resolve the command line's bare first token through
 * cmd.exe, which searches the working directory first (#12146 gate condition 1).
 */
export function spawnTarget(executable: string, name: string, args: readonly string[], environment: NodeJS.ProcessEnv): SpawnTarget {
  if (executable === name) return { file: name, args }
  if (!isBatchFile(executable)) return { file: executable, args, argv0: name }
  refuseCmdMetacharacters([executable, ...args])
  const commandLine = [executable, ...args].map(quoteForCmd).join(" ")
  return {
    file: win32SystemExecutable("cmd.exe", environment),
    args: ["/d", "/s", "/c", `"${commandLine}"`],
    windowsVerbatimArguments: true,
  }
}

export function spawnTargetOptions(target: SpawnTarget): { argv0?: string; windowsVerbatimArguments?: true } {
  return {
    ...(target.argv0 === undefined ? {} : { argv0: target.argv0 }),
    ...(target.windowsVerbatimArguments === undefined ? {} : { windowsVerbatimArguments: target.windowsVerbatimArguments }),
  }
}

/** git for a synchronous spawn: bare `git` off Windows, the resolved absolute git on win32, undefined when none. */
export function gitSpawnTarget(args: readonly string[], environment: NodeJS.ProcessEnv): SpawnTarget | undefined {
  if (process.platform !== "win32") return { file: "git", args }
  const executable = resolveWin32Git(environment)
  return executable === undefined ? undefined : spawnTarget(executable, "git", args, environment)
}
