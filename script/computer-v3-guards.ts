// Guards of the computer-use v3 clean reimplementation (plan row 2). Signature stub for the RED commit.

export type GuardResult = {
  readonly exitCode: number
  readonly findings: readonly string[]
}

export type GuardOptions = {
  readonly cwd: string
  readonly env?: Readonly<Record<string, string | undefined>>
}

export function parseWriteScope(_line: string): readonly string[] {
  return []
}

export function runGuard(_args: readonly string[], _options: GuardOptions): GuardResult {
  return { exitCode: 1, findings: [] }
}
