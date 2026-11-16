import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import { existsSync, rmSync } from "node:fs"
import { createConnection } from "node:net"
import type { Writable } from "node:stream"

import { connectDaemon, type DaemonLink } from "./daemon-link.ts"
import type { HostLatch } from "./host-latch.ts"

/** The daemon process as the launcher holds it: its stdin is the capability pipe and the launcher watch. */
export interface DaemonChild {
  readonly pid: number | undefined
  readonly stdin: Writable
  readonly exited: Promise<void>
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

export type LaunchFailure = "daemon_owned_elsewhere" | "daemon_never_listened"

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
  const exited = new Promise<void>((resolve) => child.once("exit", () => resolve()))
  return { pid: child.pid, stdin: child.stdin, exited, kill: () => child.kill("SIGTERM") }
}

function listening(endpoint: string): Promise<boolean> {
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
    child.stdin.write(`${capability.toString("hex")}\n`)
    this.#generation += 1
    const authority = await this.#dial(capability, child)
    return { generation: this.#generation, endpoint: config.endpoint, authority, child }
  }

  async #dial(capability: Buffer, child: DaemonChild): Promise<DaemonLink> {
    const connectAuthority = this.#config.connectAuthority ?? connectDaemon
    const deadline = Date.now() + (this.#config.listenTimeoutMs ?? 10_000)
    let exited = false
    void child.exited.then(() => {
      exited = true
    })
    for (;;) {
      try {
        return await connectAuthority(this.#config.endpoint, capability)
      } catch (error) {
        if (!(error instanceof Error) || !("code" in error)) throw error
        if (exited || Date.now() > deadline) {
          child.kill()
          throw new DaemonLaunchFailed(
            "daemon_never_listened",
            `${this.#config.endpoint}: ${String(Reflect.get(error, "code"))}${exited ? " (the daemon exited)" : ""}`,
          )
        }
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    }
  }
}
