// The one git call site of the ideal-state gate checker. A git failure becomes an InputError, which the CLI
// prints as a failure line: a checker that could not read the repository never reports a pass.

export type RunOptions = {
  readonly cwd: string
  readonly env?: Readonly<Record<string, string | undefined>>
}

export type CheckResult = {
  readonly exitCode: number
  readonly lines: readonly string[]
}

export class InputError extends Error {}

export type Git = (args: readonly string[], allowedExitCodes?: readonly number[]) => readonly string[]

export function gitIn(options: RunOptions): Git {
  return (args, allowedExitCodes = [0]) => {
    const result = Bun.spawnSync(["git", "-c", "core.quotePath=false", ...args], {
      cwd: options.cwd,
      env: { ...(options.env ?? process.env) },
      stdout: "pipe",
      stderr: "pipe",
    })
    if (!allowedExitCodes.includes(result.exitCode))
      throw new InputError(`git ${args.join(" ")} failed (${result.exitCode}): ${result.stderr.toString().trim()}`)
    return result.stdout
      .toString()
      .split("\n")
      .filter((line) => line.length > 0)
  }
}
