// Where the processes of a device write: the environment variables that name a write root. The run refuses to start when
// any of them points outside that device's scratch directory, so nothing the world runs writes outside it by default.
import { isAbsolute, relative, resolve } from "node:path"

const WRITE_ROOT_VARS = [
  "HOME",
  "USERPROFILE",
  "TMPDIR",
  "OMO_CODING_AGENT_DIR",
  "SENPI_CODING_AGENT_DIR",
  "OMO_DEVICE_SERVICE_STATE_DIR",
  "XDG_RUNTIME_DIR",
  "GOLDEN_STORE_FILE",
  "OMO_TEST_CREDENTIAL_LOCK_HOME",
] as const

const inside = (path: string, roots: readonly string[]): boolean =>
  roots.some((root) => {
    const rel = relative(resolve(root), resolve(path))
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel))
  })

/** Every write-root variable of `env` that is set and names a path outside all of `roots`, as `NAME=path`. */
export const outsideWriteRoots = (
  env: Readonly<Record<string, string | undefined>>,
  roots: readonly string[],
): string[] =>
  WRITE_ROOT_VARS.flatMap((name) => {
    const value = env[name]
    return value === undefined || value === "" || inside(value, roots) ? [] : [`${name}=${value}`]
  })

/** Throws naming every write root, of every environment the world runs processes with, outside its scratch directory. */
export function assertWriteRoots(
  envs: readonly {
    readonly name: string
    readonly env: Readonly<Record<string, string | undefined>>
    readonly root: string
  }[],
): void {
  const escaped = envs.flatMap(({ name, env, root }) =>
    outsideWriteRoots(env, [root]).map((entry) => `${name}: ${entry}`),
  )
  if (escaped.length > 0)
    throw new Error(`x1a world: a write root is outside the scratch directory: ${escaped.join("; ")}`)
}
