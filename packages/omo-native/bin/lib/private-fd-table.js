import { fstatSync } from "node:fs"

// senpi#4749: SENPI_PRIVATE_FDS maps each channel name to an inherited descriptor or null. Measured on
// Node 24/26 and Bun 1.4: process.execve does not keep inherited descriptors in the new image (all four
// hop/target pairs), and Node on Linux leaks descriptors from 24 up into every child while every runtime
// marks 5..21 close-on-exec at startup. So a launch that carries a table always reaches the engine as a
// child whose stdio lists the descriptors it forwards, and only an unshared socket in 5..15 that is not
// the runtime's own IPC channel is forwarded. Every other entry still travels as null, so the engine
// keeps the name declared (never a CLI fallback). Windows forwards declarations only.
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
  for (const fd of Object.values(value)) counts.set(fd, (counts.get(fd) ?? 0) + 1)
  const forwarded = {}
  const fds = []
  const discard = []
  for (const [name, fd] of Object.entries(value)) {
    forwarded[name] = null
    const inRange = Number.isSafeInteger(fd) && fd >= 5 && fd <= 64
    if (!inRange || platform === "win32" || ipc === undefined || fd === ipc || !isSocket(fd)) continue
    if (counts.get(fd) > 1 || fd > ADOPTABLE_MAX) discard.push(fd)
    else {
      forwarded[name] = fd
      fds.push(fd)
    }
  }
  return { table: JSON.stringify(forwarded), fds, discard: [...new Set(discard)] }
}

/** Child-spawn options that carry this launch's table and descriptors, or undefined when it has no table. */
export function privateFdHandoffFor(env, table, platform = process.platform) {
  if (!table) return undefined
  const inspected = inspectPrivateFdTable(table, platform)
  const stdio = ["inherit", "inherit", "inherit"]
  for (const fd of inspected.fds) {
    while (stdio.length <= fd) stdio.push("ignore")
    stdio[fd] = fd
  }
  return { env: { ...env, [PRIVATE_FDS_ENV]: inspected.table }, stdio }
}
