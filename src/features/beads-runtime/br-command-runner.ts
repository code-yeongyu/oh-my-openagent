export interface BeadsRuntimeCommandOutput {
  exitCode: number
  stdout?: string
  stderr?: string
}

export interface BeadsRuntimeCommandInput {
  command: readonly string[]
  cwd: string
}

export type BeadsRuntimeCommandRunner = (
  input: BeadsRuntimeCommandInput,
) => Promise<BeadsRuntimeCommandOutput>

export async function runBeadsRuntimeCommand(
  input: BeadsRuntimeCommandInput,
): Promise<BeadsRuntimeCommandOutput> {
  const proc = Bun.spawn({
    cmd: [...input.command],
    cwd: input.cwd,
    stdout: "pipe",
    stderr: "pipe",
  })

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  return { exitCode, stdout, stderr }
}
