import { homedir } from "node:os"
import { join } from "node:path"

export const CODEGRAPH_INSTALL_DIR_ENV = "CODEGRAPH_INSTALL_DIR"
export const CODEGRAPH_NO_DAEMON_ENV = "CODEGRAPH_NO_DAEMON"
export const CODEGRAPH_NO_DOWNLOAD_ENV = "CODEGRAPH_NO_DOWNLOAD"
export const CODEGRAPH_TELEMETRY_ENV = "CODEGRAPH_TELEMETRY"
export const DO_NOT_TRACK_ENV = "DO_NOT_TRACK"

const SAFE_AMBIENT_ENV_KEYS = new Set([
  "APPDATA",
  "CI",
  "CODEX_HOME",
  "ComSpec",
  "HOME",
  "HOMEDRIVE",
  "HOMEPATH",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "LOCALAPPDATA",
  "PATH",
  "PATHEXT",
  "Path",
  "SystemRoot",
  "TEMP",
  "TMP",
  "TMPDIR",
  "USERPROFILE",
  "WINDIR",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME",
])

const SAFE_CODEGRAPH_RUNTIME_ENV_KEYS = new Set([
  "CODEGRAPH_ALLOW_UNSAFE_NODE",
  "CODEGRAPH_BIN",
  "CODEGRAPH_FAKE_LOG",
  "CODEGRAPH_NO_DAEMON",
  "CODEGRAPH_NODE_BIN",
  "OMO_CODEGRAPH_BIN",
  "OMO_CODEGRAPH_PROJECT_CWD",
  "OMO_CODEGRAPH_SESSION_START_CWD",
])

export interface BuildCodegraphEnvOptions {
  readonly homeDir?: string
  // When false (default), the child env pins CODEGRAPH_NO_DAEMON=1 so upstream
  // never spawns its daemon. When true, the key is OMITTED entirely (never set
  // to "0" — upstream treats any value except '0'/'false' as opt-out) so the
  // daemon may run and an ambient CODEGRAPH_NO_DAEMON=1 can still escape-hatch
  // back to daemon-off.
  readonly daemon?: boolean
}

export interface BuildCodegraphChildEnvOptions {
  readonly ambientEnv?: Record<string, string | undefined>
  readonly codegraphEnv?: Record<string, string | undefined>
  readonly runtimeEnv?: Record<string, string | undefined>
}

export type CodegraphEnv = {
  readonly [CODEGRAPH_INSTALL_DIR_ENV]: string
  readonly [CODEGRAPH_NO_DAEMON_ENV]?: "1"
  readonly [CODEGRAPH_NO_DOWNLOAD_ENV]: "1"
  readonly [CODEGRAPH_TELEMETRY_ENV]: "0"
  readonly [DO_NOT_TRACK_ENV]: "1"
}

export function buildCodegraphEnv(options: BuildCodegraphEnvOptions = {}): CodegraphEnv {
  const homeDir = options.homeDir ?? homedir()

  return {
    [CODEGRAPH_INSTALL_DIR_ENV]: join(homeDir, ".omo", "codegraph"),
    ...(options.daemon === true ? {} : { [CODEGRAPH_NO_DAEMON_ENV]: "1" as const }),
    [CODEGRAPH_NO_DOWNLOAD_ENV]: "1",
    [CODEGRAPH_TELEMETRY_ENV]: "0",
    [DO_NOT_TRACK_ENV]: "1",
  }
}

function copyDefinedEnvKeys(
  output: Record<string, string>,
  input: Record<string, string | undefined>,
  allowedKeys: ReadonlySet<string>,
): void {
  for (const key of allowedKeys) {
    const value = input[key]
    if (value !== undefined) output[key] = value
  }
}

function copyDefinedEnv(output: Record<string, string>, input: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(input)) {
    if (value !== undefined) output[key] = value
  }
}

export function buildCodegraphChildEnv(options: BuildCodegraphChildEnvOptions = {}): Record<string, string> {
  const env: Record<string, string> = {}
  copyDefinedEnvKeys(env, options.ambientEnv ?? {}, SAFE_AMBIENT_ENV_KEYS)
  copyDefinedEnvKeys(env, options.runtimeEnv ?? {}, SAFE_CODEGRAPH_RUNTIME_ENV_KEYS)
  // codegraphEnv is applied LAST so our daemon policy wins over ambient input:
  // with daemon disabled it pins CODEGRAPH_NO_DAEMON=1 over any ambient "0",
  // and with daemon enabled it omits the key so an ambient "1" escape hatch
  // (copied above) survives.
  copyDefinedEnv(env, options.codegraphEnv ?? {})
  return env
}
