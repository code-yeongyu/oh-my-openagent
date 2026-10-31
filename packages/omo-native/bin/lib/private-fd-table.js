import { closeSync, fstatSync } from "node:fs"

// senpi#4749: SENPI_PRIVATE_FDS maps each channel name to an inherited descriptor or null. Measured on
// Node 24/26 and Bun 1.4: process.execve does not keep inherited descriptors in the new image (all four
// hop/target pairs), and Node on Linux leaks descriptors from 24 up into every child while every runtime
// marks 5..21 close-on-exec at startup. So a launch that carries a table always reaches the engine as a
// child whose stdio lists the descriptors it forwards, and only an unshared socket in 5..15 that is not
// the runtime's own IPC channel is forwarded. Every other entry still travels as null, so the engine
// keeps the name declared (never a CLI fallback). Windows instead carries two distinct pipe halves
// in 5..64, atomically, on their original stdio slots (#11955). senpi owns receipt-side inherit clearing.
export const PRIVATE_FDS_ENV = "SENPI_PRIVATE_FDS"
const ADOPTABLE_MAX = 15

function ipcDescriptor() {
  const channel = process.channel
  if (typeof channel !== "object" || channel === null) return null
  return typeof channel.fd === "number" ? channel.fd : undefined
}

function isSocket(fd) {
  try {
    return fstatSync(fd).isSocket()
  } catch {
    return false
  }
}

function inRange(fd) {
  return Number.isSafeInteger(fd) && fd >= 5 && fd <= 64
}

// Node and Bun on Windows report an anonymous pipe with mode S_IFIFO (0o010000), but Stats.isFIFO()
// returns false there because the platform defines no S_IFIFO constant. Compare the file-type bits directly.
const S_IFMT = 0o170000
const S_IFIFO = 0o010000

function isPipe(fd) {
  try {
    return (fstatSync(fd).mode & S_IFMT) === S_IFIFO
  } catch {
    return false
  }
}

/** The table to hand on, the descriptors it forwards, and named sockets this process must close. */
export function inspectPrivateFdTable(table, platform = process.platform) {
  let value
  try {
    value = JSON.parse(table)
  } catch {
    return { table, fds: [], discard: [] }
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { table, fds: [], discard: [] }
  const ipc = ipcDescriptor()
  const counts = new Map()
  for (const fd of Object.values(value)) {
    // Preserve #11786's POSIX alias behavior. On Windows even a malformed third half
    // participates, so it cannot alias another name's otherwise valid pair.
    const descriptors = platform === "win32" && Array.isArray(fd) ? fd : [fd]
    for (const descriptor of descriptors) counts.set(descriptor, (counts.get(descriptor) ?? 0) + 1)
  }
  const forwarded = {}
  const fds = []
  const discard = []
  for (const [name, fd] of Object.entries(value)) {
    forwarded[name] = null
    if (platform === "win32") {
      const usable = Array.isArray(fd) && fd.length === 2 && fd.every(inRange) && fd[0] !== fd[1] &&
        ipc !== undefined && !fd.some(descriptor => descriptor === ipc || counts.get(descriptor) > 1) && fd.every(isPipe)
      if (usable) {
        forwarded[name] = fd
        fds.push(...fd)
      } else if (ipc !== undefined) {
        // Like POSIX, a refused entry's open pipes are closed so the hop never keeps them.
        for (const descriptor of Array.isArray(fd) ? fd : [fd]) {
          if (inRange(descriptor) && descriptor !== ipc && isPipe(descriptor)) discard.push(descriptor)
        }
      }
      continue
    }
    if (!inRange(fd) || ipc === undefined || fd === ipc || !isSocket(fd)) continue
    if (counts.get(fd) > 1 || fd > ADOPTABLE_MAX) discard.push(fd)
    else {
      forwarded[name] = fd
      fds.push(fd)
    }
  }
  return { table: JSON.stringify(forwarded), fds, discard: [...new Set(discard)] }
}

/** Child-spawn options that carry this launch's table and descriptors, or undefined when it has no table. */
export function privateFdHandoffFor(env, table, platform = process.platform, { shell = false } = {}) {
  if (!table) return undefined
  const inspected = inspectPrivateFdTable(table, platform)
  const stdio = ["inherit", "inherit", "inherit"]
  for (const fd of shell ? [] : inspected.fds) {
    while (stdio.length <= fd) stdio.push("ignore")
    stdio[fd] = fd
  }
  const forwarded = shell && inspected.fds.length > 0
    ? JSON.stringify(Object.fromEntries(Object.keys(JSON.parse(inspected.table)).map(name => [name, null])))
    : inspected.table
  return {
    env: { ...env, [PRIVATE_FDS_ENV]: forwarded },
    stdio,
    // Unlike POSIX's protected sockets, Windows pipes must not remain in the waiting parent.
    // runChild invokes this immediately after spawn, including a synchronous spawn failure.
    ...(platform === "win32" && inspected.fds.length > 0 ? {
      onSpawn() {
        for (const fd of inspected.fds) closeSync(fd)
      },
    } : {}),
  }
}
