/**
 * The environment a sandboxed child engine is spawned with: a sandbox replaces the child's PROFILE,
 * not its PLATFORM. Dropping `SystemRoot`/`windir`/`ComSpec`/`PATHEXT`/`TEMP`/`TMP`/`USERPROFILE`/
 * `APPDATA`/`LOCALAPPDATA` blocks a cold source-graph Bun child for 5-20 s with flat CPU before it
 * reaches its RPC read loop (#9029, residue tracked in #12099); every profile-shaped key is instead
 * pointed INTO the sandbox, so isolation is unchanged. Built from an allowlist, never by inheriting
 * `process.env`: a caller's unrelated secrets must not reach the child.
 */

/** Keys the OS and the runtime resolve their own paths through. Carried over verbatim. */
export const SANDBOX_PLATFORM_KEYS = [
  "PATH",
  "SystemRoot",
  "windir",
  "ComSpec",
  "PATHEXT",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "PROCESSOR_IDENTIFIER",
  "OS",
] as const

/** Keys that name the user's profile, temp dir, or caches. Every one of them is redirected. */
export const SANDBOX_PROFILE_KEYS = [
  "HOME",
  "USERPROFILE",
  "TMPDIR",
  "TMP",
  "TEMP",
  "APPDATA",
  "LOCALAPPDATA",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
] as const

export type SandboxChildEnvOptions = {
  /** Where the platform keys come from. */
  readonly parent: NodeJS.ProcessEnv
  /** Every profile-shaped key points here. It must exist before the spawn. */
  readonly home: string
}

/**
 * Platform keys from the parent, every profile-shaped key redirected to `home`. A key the parent does
 * not carry (or carries empty) stays absent rather than being invented.
 */
export function buildSandboxChildEnv(options: SandboxChildEnvOptions): Record<string, string> {
  const env: Record<string, string> = {}
  for (const key of SANDBOX_PLATFORM_KEYS) {
    const value = options.parent[key]
    if (value !== undefined && value.length > 0) env[key] = value
  }
  for (const key of SANDBOX_PROFILE_KEYS) env[key] = options.home
  return env
}
