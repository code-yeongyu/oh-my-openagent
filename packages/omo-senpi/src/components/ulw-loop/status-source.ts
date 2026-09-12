const SESSION_ID_FLAG = "--session-id"

// The component used to spawn the toolkit CLI for every status probe, which cost two node startups
// inside an awaited input hook. The SDK answers the same question in-process; the CLI-shaped
// {code, stdout} envelope is kept so the component's parser and its injected test seam are unchanged.
export async function readUlwLoopStatusInProcess(
  cwd: string,
  sessionId: string,
): Promise<{ code: number; stdout: string }> {
  const { createAgentToolkit } = await import("#omo-agent-toolkit-runtime")
  const response = await createAgentToolkit({ cwd, sessionId, surface: "omo-senpi" }).status()
  if (!response.ok) return { code: 1, stdout: JSON.stringify(response) }
  return { code: 0, stdout: JSON.stringify({ ok: true, ...response.result }) }
}

export function sessionIdFromStatusArgs(args: readonly string[]): string | undefined {
  const index = args.indexOf(SESSION_ID_FLAG)
  if (index < 0) return undefined
  const value = args[index + 1]
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}
