export function createSystemTransformHandler(): (
  input: { sessionID: string },
  output: { system: string[] },
) => Promise<void> {
  return async (): Promise<void> => {}
}
