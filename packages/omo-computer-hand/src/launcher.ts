import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { existsSync, rmSync } from "node:fs"
import { createConnection } from "node:net"
import type { Writable } from "node:stream"

import { connectDaemon, type DaemonLink } from "./daemon-link.ts"
import type { HostLatch } from "./host-latch.ts"

/** How a daemon process ended: it ran and exited, or its binary never started. */
export type DaemonExit = { readonly kind: "exited" } | { readonly kind: "spawn_failed"; readonly detail: string }

/** The daemon process as the launcher holds it: its stdin is the capability pipe and the launcher watch. */
export interface DaemonChild {
  readonly pid: number | undefined
  readonly stdin: Writable
  readonly exited: Promise<DaemonExit>
  kill(): void
}

export type SpawnDaemon = (
  command: string,
  args: readonly string[],
  env: Readonly<Record<string, string>>,
) => DaemonChild

export interface LauncherConfig {
  readonly engine: string
  readonly endpoint: string
  readonly lock: string
  readonly env: Readonly<Record<string, string>>
  /** The host's latch at spawn time: a set latch starts the daemon stopped. */
  readonly latch: () => HostLatch
  readonly spawnDaemon?: SpawnDaemon
  readonly connectAuthority?: (endpoint: string, capability: Buffer) => Promise<DaemonLink>
  readonly isListening?: (endpoint: string) => Promise<boolean>
  /** How long a fresh daemon may take to listen. */
  readonly listenTimeoutMs?: number
}

/** One daemon generation this host spawned: its authority link carries the generation capability. */
export interface Generation {
  readonly generation: number
  readonly endpoint: string
  readonly authority: DaemonLink
  readonly child: DaemonChild
}

export type LaunchFailure = "daemon_owned_elsewhere" | "daemon_never_listened" | "engine_spawn_failed"

class DaemonLaunchFailed extends Error {
  readonly reason: LaunchFailure

  constructor(reason: LaunchFailure, detail: string) {
    super(`engine daemon launch failed (${reason}): ${detail}`)
    this.name = "DaemonLaunchFailed"
    this.reason = reason
  }
}

const spawnWithPipe: SpawnDaemon = (command, args, env) => {
  const child = spawn(command, [...args], { env: { ...env }, stdio: ["pipe", "ignore", "inherit"] })
  const exited = new Promise<DaemonExit>((resolve) => {
    child.once("exit", () => resolve({ kind: "exited" }))
    // A binary that cannot start emits `error` and no `exit`; a later `error` (a failed kill) settles nothing new.
    child.on("error", (error) => resolve({ kind: "spawn_failed", detail: error.message }))
  })
  return { pid: child.pid, stdin: child.stdin, exited, kill: () => child.kill("SIGTERM") }
}

/** Whether something accepts a connection at the socket `endpoint`. */
export function listening(endpoint: string): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createConnection(endpoint, () => {
      probe.destroy()
      resolve(true)
    })
    probe.once("error", () => resolve(false))
  })
}

/**
 * The spawning profile's launcher (X16 (a): the host is its own launcher). It mints a fresh 32-byte
 * capability per daemon generation, hands it to the daemon as the FIRST stdin line (never argv,
 * env or a file) and keeps that pipe open, so the daemon ends when this host dies. One generation
 * at a time: concurrent `ensure` calls share one spawn.
 */
export class DaemonLauncher {
  readonly #config: LauncherConfig
  #generation = 0
  #current: Promise<Generation> | undefined

  constructor(config: LauncherConfig) {
    this.#config = config
  }

  ensure(): Promise<Generation> {
    this.#current ??= this.#spawn().catch((error: unknown) => {
      this.#current = undefined
      throw error
    })
    return this.#current
  }

  /** Ends the current generation (the watchdog's kill); the next `ensure` spawns the next one. */
  kill(): void {
    const current = this.#current
    this.#current = undefined
    void current?.then((generation) => {
      generation.authority.close()
      generation.child.kill()
    })
  }

  async #spawn(): Promise<Generation> {
    const config = this.#config
    const isListening = config.isListening ?? listening
    if (existsSync(config.lock)) {
      // A lock with a live listener is a daemon this host did not start: its capability is not ours.
      if (await isListening(config.endpoint)) {
        throw new DaemonLaunchFailed("daemon_owned_elsewhere", `${config.endpoint} answers and ${config.lock} exists`)
      }
      // This host is the only spawner of the uid: a lock nobody listens behind is a dead generation's.
      rmSync(config.lock, { force: true })
      rmSync(config.endpoint, { force: true })
    }
    const capability = randomBytes(32)
    const args = ["--enable-daemon", "--serve", "--endpoint", config.endpoint, "--lock", config.lock]
    if (config.latch().suspended) args.push("--start-stopped")
    const child = (config.spawnDaemon ?? spawnWithPipe)(config.engine, args, config.env)
    // A daemon gone before it read the line (or never started) fails this write with EPIPE: `#dial`
    // reports that end through `exited` as a launch refusal, so the write error must not crash the host.
    child.stdin.on("error", () => undefined)
    child.stdin.write(`${capability.toString("hex")}\n`)
    this.#generation += 1
    const authority = await this.#dial(capability, child)
    return { generation: this.#generation, endpoint: config.endpoint, authority, child }
  }

  async #dial(capability: Buffer, child: DaemonChild): Promise<DaemonLink> {
    const connectAuthority = this.#config.connectAuthority ?? connectDaemon
    const deadline = Date.now() + (this.#config.listenTimeoutMs ?? 10_000)
    let exit: DaemonExit | undefined
    void child.exited.then((ended) => {
      exit = ended
    })
    for (;;) {
      try {
        return await connectAuthority(this.#config.endpoint, capability)
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error)) throw error
        if (exit !== undefined || Date.now() > deadline) {
          child.kill()
          if (exit?.kind === "spawn_failed") {
            throw new DaemonLaunchFailed("engine_spawn_failed", `${this.#config.engine}: ${exit.detail}`)
          }
          throw new DaemonLaunchFailed(
            "daemon_never_listened",
            `${this.#config.endpoint}: ${String(Reflect.get(error, "code"))}${exit === undefined ? "" : " (the daemon exited)"}`,
          )
        }
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    }
  }
}
