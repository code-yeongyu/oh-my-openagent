/**
 * Parse the parent process's `-e` / `--extension` entries out of an argv so a detached rpc child can
 * be spawned with the SAME extensions the parent loaded. A separate OS process cannot inherit the
 * parent's in-memory extension registry; forwarding the entry paths reproduces them (a keyless local
 * provider in QA, or a production `-e` extension) in the child under `--no-extensions`.
 */
export function parseExtensionEntries(argv: readonly string[]): readonly string[] {
  const entries: string[] = []
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i]
    if (flag !== "-e" && flag !== "--extension") continue
    const value = argv[i + 1]
    if (value !== undefined && value.length > 0) {
      entries.push(value)
      i += 1
    }
  }
  return entries
}
