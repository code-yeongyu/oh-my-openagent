import { isAbsolute, join } from "node:path"

/**
 * Where the engine dials the authority host (crates/omo-computer-core/src/host_paths.rs, the one
 * resolver): on every Unix a socket file in the owner-only runtime root, whose directory keeps
 * every other uid out (no abstract name: it has no permissions).
 */
export type HostAddress =
  { readonly kind: "socket"; readonly path: string } | { readonly kind: "endpoint"; readonly path: string }

export interface HandPaths {
  /** The STATE root: the `global-stop` marker, audit, artifacts. */
  readonly stateRoot: string
  /** The RUNTIME root: sockets, locks, the per-session lock files. */
  readonly runtimeRoot: string
  /** `<config>/computer/`: consent, its sidecar, the host latch. */
  readonly computerDir: string
  readonly hostLatch: string
  readonly consent: string
  readonly stopMarker: string
  readonly sessionLockDir: string
  readonly daemonEndpoint: string
  readonly daemonLock: string
  readonly hostAddress: HostAddress
}

export type HandPathsResult =
  | { readonly kind: "resolved"; readonly paths: HandPaths }
  | { readonly kind: "unavailable"; readonly reason: "seam_with_real_backend" | "no_config_root" | "no_runtime_dir" }

export interface HandPathsInput {
  readonly env: Readonly<Record<string, string | undefined>>
  /** The fake backend: only then is the runtime-dir seam read. */
  readonly fake: boolean
  readonly uid: number
  readonly platform: string
  /** The user database's home directory, never `$HOME`. */
  readonly home: string | undefined
  /** The per-user temp directory (macOS runtime root). */
  readonly tmp: string
}

const SEAM = "OMO_COMPUTER_RUNTIME_DIR"

function absolute(env: HandPathsInput["env"], name: string): string | undefined {
  const value = env[name]
  return value !== undefined && isAbsolute(value) ? value : undefined
}

function paths(stateRoot: string, runtimeRoot: string, config: string, hostAddress: HostAddress): HandPaths {
  const computerDir = join(config, "computer")
  return {
    stateRoot,
    runtimeRoot,
    computerDir,
    hostLatch: join(computerDir, "host-latch"),
    consent: join(computerDir, "consent.json"),
    stopMarker: join(stateRoot, "global-stop"),
    sessionLockDir: join(runtimeRoot, "sessions"),
    daemonEndpoint: join(runtimeRoot, "engine.sock"),
    daemonLock: join(runtimeRoot, "engine.lock"),
    hostAddress,
  }
}

/** The same roots and host address the engine resolves (paths.rs + host_paths.rs), so the two cannot diverge. */
export function resolveHandPaths(input: HandPathsInput): HandPathsResult {
  const seam = input.env[SEAM]
  if (seam !== undefined && seam !== "") {
    if (!input.fake) return { kind: "unavailable", reason: "seam_with_real_backend" }
    const address: HostAddress =
      input.platform === "win32"
        ? { kind: "endpoint", path: join(seam, "host-endpoint") }
        : { kind: "socket", path: join(seam, "host-api.sock") }
    return { kind: "resolved", paths: paths(seam, seam, seam, address) }
  }
  switch (input.platform) {
    case "darwin": {
      if (input.home === undefined) return { kind: "unavailable", reason: "no_config_root" }
      const support = join(input.home, "Library", "Application Support", "OmO")
      const runtime = join(input.tmp, "omo-computer", String(input.uid))
      return {
        kind: "resolved",
        paths: paths(join(support, "ComputerControl", "1"), runtime, support, {
          kind: "socket",
          path: join(runtime, "host-api.sock"),
        }),
      }
    }
    case "win32": {
      const local = absolute(input.env, "LOCALAPPDATA")
      const roaming = absolute(input.env, "APPDATA")
      if (local === undefined || roaming === undefined) return { kind: "unavailable", reason: "no_config_root" }
      const state = join(local, "OmO", "ComputerControl")
      const config = join(roaming, "OmO")
      return {
        kind: "resolved",
        paths: paths(state, join(state, "run"), config, {
          kind: "endpoint",
          path: join(config, "computer", "host-endpoint"),
        }),
      }
    }
    default: {
      const configBase =
        absolute(input.env, "XDG_CONFIG_HOME") ?? (input.home === undefined ? undefined : join(input.home, ".config"))
      const stateBase =
        absolute(input.env, "XDG_STATE_HOME") ??
        (input.home === undefined ? undefined : join(input.home, ".local", "state"))
      if (configBase === undefined || stateBase === undefined) return { kind: "unavailable", reason: "no_config_root" }
      const runtimeBase = absolute(input.env, "XDG_RUNTIME_DIR") ?? `/run/user/${input.uid}`
      const runtime = join(runtimeBase, "omo-computer", String(input.uid))
      return {
        kind: "resolved",
        paths: paths(join(stateBase, "omo", "computer-control"), runtime, join(configBase, "omo"), {
          kind: "socket",
          path: join(runtime, "host-api.sock"),
        }),
      }
    }
  }
}
