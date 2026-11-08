// Preserve the status parser's response envelope while reading through the in-process SDK.
export async function readUlwLoopStatusInProcess(
  cwd: string,
  sessionId: string,
): Promise<{ code: number; stdout: string }> {
  const { createAgentToolkit } = await import("#omo-agent-toolkit-sdk")
  const response = await createAgentToolkit({ cwd, sessionId, surface: "omo-senpi" }).status()
  if (!response.ok) return { code: 1, stdout: JSON.stringify(response) }
  return { code: 0, stdout: JSON.stringify({ ok: true, ...response.result }) }
}
