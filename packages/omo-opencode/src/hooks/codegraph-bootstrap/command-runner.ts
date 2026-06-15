export interface CodegraphCommandResult {
  readonly exitCode: number
  readonly stderr?: string
  readonly stdout: string
  readonly timedOut: boolean
}

export interface RunCodegraphCommandOptions {
  readonly env: Record<string, string>
  readonly timeoutMs: number
}

function toOutputText(value: string | Buffer): string {
  return Buffer.isBuffer(value) ? value.toString("utf8") : value
}

function resolveExitCode(error: Error): number {
  if ("code" in error) {
    const code = error.code
    if (typeof code === "number") return code
  }
  return 1
}

export async function runCodegraphCommand(
  projectRoot: string,
  command: string,
  args: readonly string[],
  options: RunCodegraphCommandOptions,
): Promise<CodegraphCommandResult> {
  const { execFile } = await import("node:child_process")

  return new Promise((resolve) => {
    execFile(
      command,
      [...args],
      {
        cwd: projectRoot,
        encoding: "utf8",
        env: { ...process.env, ...options.env },
        maxBuffer: 1024 * 1024,
        timeout: options.timeoutMs,
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ exitCode: 0, stderr: toOutputText(stderr), stdout: toOutputText(stdout), timedOut: false })
          return
        }

        resolve({
          exitCode: resolveExitCode(error),
          stderr: toOutputText(stderr),
          stdout: toOutputText(stdout),
          timedOut: error.killed === true,
        })
      },
    )
  })
}
