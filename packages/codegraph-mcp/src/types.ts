import type { Readable, Writable } from "node:stream"

export interface CodegraphCommandSpec {
  readonly argsPrefix: readonly string[]
  readonly command: string
}

export interface CodegraphCommandResult {
  readonly exitCode: number
  readonly stderr: string
  readonly stdout: string
  readonly timedOut: boolean
}

export type CodegraphCommandRunner = (
  cwd: string,
  command: CodegraphCommandSpec,
  args: readonly string[],
  env: Record<string, string | undefined>,
) => Promise<CodegraphCommandResult>

export interface CodegraphProjectSynchronizer {
  readonly initialize: (projectRoot: string, autoInit: boolean) => Promise<void>
  readonly refresh: (projectPath: string, autoInit: boolean) => Promise<boolean>
}

export interface CodegraphServerHandle {
  readonly input: Writable
  readonly output: Readable
  readonly error: Readable
  readonly wait: () => Promise<number>
  readonly terminate: () => void
}

export type CodegraphServerSpawner = (
  cwd: string,
  command: CodegraphCommandSpec,
  env: Record<string, string | undefined>,
) => CodegraphServerHandle
