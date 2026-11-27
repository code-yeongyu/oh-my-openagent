import { afterEach } from "bun:test"
import { existsSync, lstatSync, readFileSync, readlinkSync, realpathSync } from "node:fs"
import net from "node:net"
import { basename, dirname, join, resolve, sep } from "node:path"

// A test never dials this machine's own device service (credential safety): the service answers for the signed-in user,
// so a test that reaches it reads, and through a refresh can write, the developer's real account state. The real state
// dir is fixed at preload, before the hermetic home replaces HOME, and every socket connect is checked against it: its
// Unix socket path on POSIX, its loopback port (endpoint.json) on Windows. A violation throws at the connect and fails the
// test that made it even when the caller turns the throw into a typed refusal. Fakes live under tmpdir, never there.
// Covered dials: node:net sockets (createConnection, connect, new Socket().connect, http's socketPath), Bun.connect's
// unix option and fetch's unix option; paths compare after realpath, so a symlink to the state dir is caught. RESIDUAL:
// a spawned child process is not covered; it is protected by the environment it is given, not by this guard.

export type DeviceServiceGuard = {
  /** Throws when the connect arguments name the guarded service; records the violation either way. */
  readonly check: (args: readonly unknown[]) => void
  readonly takeViolations: () => string[]
}

const portOf = (stateDir: string): number | undefined => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(stateDir, "endpoint.json"), "utf8"))
    if (typeof parsed !== "object" || parsed === null || !("port" in parsed)) return undefined
    return typeof parsed.port === "number" ? parsed.port : undefined
  } catch {
    return undefined
  }
}

const LOOPBACK: ReadonlySet<unknown> = new Set([undefined, "127.0.0.1", "localhost", "::1"])

// The real path when it exists (the socket, else its directory), so a symlinked route to the state dir compares equal.
const canonical = (path: string): string => {
  const absolute = resolve(path)
  if (existsSync(absolute)) {
    const entry = lstatSync(absolute)
    // Bun on macOS cannot realpath a Unix socket. Resolve its directory, following a leaf link first.
    if (entry.isSymbolicLink()) return canonical(resolve(realpathSync(dirname(absolute)), readlinkSync(absolute)))
    if (entry.isSocket()) return join(realpathSync(dirname(absolute)), basename(absolute))
  }
  for (const candidate of [absolute, dirname(absolute)])
    if (existsSync(candidate)) {
      const real = realpathSync(candidate)
      return candidate === absolute ? real : join(real, absolute.slice(candidate.length + 1))
    }
  return absolute
}

const field = (value: unknown, key: string): unknown =>
  typeof value === "object" && value !== null ? Reflect.get(value, key) : undefined

export function createDeviceServiceGuard(realStateDir: string): DeviceServiceGuard {
  const root = canonical(realStateDir)
  const port = existsSync(root) ? portOf(root) : undefined
  const violations: string[] = []
  const target = (args: readonly unknown[]): string | undefined => {
    // net.createConnection hands Socket#connect its normalized arguments as one array: [options, callback].
    const [first, second]: readonly unknown[] = Array.isArray(args[0]) ? args[0] : args
    const optionPath = field(first, "path") ?? field(first, "unix")
    const path = typeof first === "string" ? first : typeof optionPath === "string" ? optionPath : undefined
    if (path !== undefined) {
      const real = canonical(path)
      return real === root || real.startsWith(root + sep) ? real : undefined
    }
    const dialed = typeof first === "number" ? first : field(first, "port")
    const host = typeof first === "number" ? second : field(first, "host")
    return port !== undefined && dialed === port && LOOPBACK.has(host) ? `loopback port ${port}` : undefined
  }
  return {
    check(args) {
      const reached = target(args)
      if (reached === undefined) return
      const message = `a test dialed this machine's real device service (${reached}); use a fake under tmpdir`
      violations.push(message)
      throw new Error(message)
    },
    takeViolations: () => violations.splice(0),
  }
}

/** Installs the guard on every socket connect of this test process and fails the test that tripped it. */
export function installDeviceServiceTestGuard(realStateDir: string): DeviceServiceGuard {
  const guard = createDeviceServiceGuard(realStateDir)
  const connect = net.Socket.prototype.connect
  Object.defineProperty(net.Socket.prototype, "connect", {
    configurable: true,
    writable: true,
    value: function guardedConnect(this: net.Socket, ...args: unknown[]) {
      guard.check(args)
      return Reflect.apply(connect, this, args)
    },
  })
  // Bun's own socket API and fetch's unix option bypass node:net; both are value-only properties, replaced in place.
  const bunConnect = Bun.connect
  Object.defineProperty(Bun, "connect", {
    value: (options: Parameters<typeof Bun.connect>[0]) => {
      guard.check([options])
      return bunConnect(options)
    },
  })
  const realFetch = globalThis.fetch
  const guardedFetch = (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const unix = field(init, "unix")
    if (typeof unix === "string") guard.check([{ path: unix }])
    return realFetch(input, init)
  }
  globalThis.fetch = Object.assign(guardedFetch, realFetch)
  afterEach(() => {
    const violations = guard.takeViolations()
    if (violations.length > 0) throw new Error(violations.join("\n"))
  })
  return guard
}
