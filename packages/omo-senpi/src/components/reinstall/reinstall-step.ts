type Env = Readonly<Record<string, string | undefined>>

/** The reinstall clause for a missing plugin file: the omo-ai launcher's exact command (`OMO_REINSTALL_COMMAND`) when it set one. */
export function reinstallStep(env: Env = process.env): string {
  const command = env.OMO_REINSTALL_COMMAND?.trim()
  return command ? `reinstall omo with: ${command}` : "reinstall omo"
}
