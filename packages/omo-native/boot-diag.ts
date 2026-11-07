// SCRATCH DIAGNOSTICS (memsync-coord/diag-12704-win, never merged): one stderr line per boot decision of the compiled
// entry, always on. Every line starts with `omo-boot-diag` so it can be grepped out of a host's stderr.log.
import { fstatSync, writeSync } from "node:fs"

const S_IFMT = 0o170000
const S_IFIFO = 0o010000

export function bootDiag(stage: string, fields: Record<string, unknown> = {}): void {
  try {
    writeSync(2, `omo-boot-diag pid=${process.pid} ppid=${process.ppid} t=${Math.round(performance.now())}ms ${stage} ${JSON.stringify(fields)}\n`)
  } catch {
    // A diagnostic line must never change the boot.
  }
}

/** What each candidate private slot is in this process, read without adopting anything. */
export function handleSnapshot(): Record<string, string> {
  const slots: Record<string, string> = {}
  for (let fd = 3; fd <= 8; fd += 1) {
    try {
      const stat = fstatSync(fd)
      slots[fd] = `mode=0o${stat.mode.toString(8)} fifoBits=${(stat.mode & S_IFMT) === S_IFIFO} isFIFO=${stat.isFIFO()} socket=${stat.isSocket()} file=${stat.isFile()} chr=${stat.isCharacterDevice()}`
    } catch (error) {
      slots[fd] = `closed(${error instanceof Error && "code" in error ? String(error.code) : "error"})`
    }
  }
  return slots
}

/** The launch as this process received it: argv, the private table env, the handoff markers and runtime facts. */
export function launchSnapshot(): Record<string, unknown> {
  const channel = Reflect.get(process, "channel") as { fd?: unknown } | undefined
  return {
    platform: process.platform,
    arch: process.arch,
    bun: process.versions.bun ?? null,
    execPath: process.execPath,
    argv: process.argv.slice(2).map(arg => arg.length > 160 ? `${arg.slice(0, 160)}...` : arg),
    SENPI_PRIVATE_FDS: process.env.SENPI_PRIVATE_FDS ?? "<unset>",
    SENPI_PRIVATE_FDS_FINAL: process.env.SENPI_PRIVATE_FDS_FINAL ?? "<unset>",
    OMO_PROVISIONED_HANDOFF: process.env.OMO_PROVISIONED_HANDOFF ?? "<unset>",
    SENPI_RPC_HOST_STARTUP_EVENTS: process.env.SENPI_RPC_HOST_STARTUP_EVENTS ? "set" : "<unset>",
    ipcChannel: channel === undefined ? "none" : typeof channel.fd === "number" ? `fd ${channel.fd}` : "present-without-fd",
    privateFdsCaptured: Reflect.get(globalThis, Symbol.for("senpi.private-fds.v3")) !== undefined,
    handles: handleSnapshot(),
  }
}

/** senpi's captured private-descriptor state (after the claim imported it): what was declared, adopted, forwarded. */
export function privateFdState(): Record<string, unknown> {
  const state = Reflect.get(globalThis, Symbol.for("senpi.private-fds.v3")) as {
    present?: unknown; unparseable?: unknown; declared?: Set<string>; channels?: Map<string, unknown>; forward?: Map<string, unknown>
  } | undefined
  if (state === undefined) return { captured: false }
  return {
    captured: true,
    present: state.present,
    unparseable: state.unparseable,
    declared: state.declared === undefined ? null : [...state.declared],
    channelsRemaining: state.channels === undefined ? null : Object.fromEntries(state.channels),
    forward: state.forward === undefined ? null : Object.fromEntries(state.forward),
  }
}
