export function createSystemTransformHandler(): (
  input: { sessionID?: string; model: unknown },
  output: { system: string[] },
) => Promise<void> {
  return async (): Promise<void> => {}
}
