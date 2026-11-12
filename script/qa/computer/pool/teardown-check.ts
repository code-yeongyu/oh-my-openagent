import { existsSync, readdirSync, readFileSync } from "node:fs"
import { userInfo } from "node:os"

import { run } from "./xorg-session.ts"

export type TeardownFacts = {
  readonly user: string
  readonly xorg: { readonly code: number; readonly out: string }
  readonly inputDevices: string
  readonly x11Sockets: readonly string[]
  readonly xLocks: readonly string[]
  readonly acl: { readonly code: number; readonly out: string } | "no-device"
}

const PROBE_SOCKET = /^X9\d$/
const PROBE_LOCK = /^\.X9\d-lock$/
const PGREP_NO_MATCH = 1

export function judgeTeardown(facts: TeardownFacts): { readonly lines: readonly string[]; readonly ok: boolean } {
  const lines: string[] = []
  let ok = true
  const xorgPids = facts.xorg.out.split("\n").filter((pid) => pid.trim() !== "")
  if (facts.xorg.code !== 0 && facts.xorg.code !== PGREP_NO_MATCH) {
    lines.push(`Xorg UNREAD: pgrep exit ${facts.xorg.code}`)
    ok = false
  } else if (xorgPids.length > 0) {
    lines.push(`Xorg LEFT ${xorgPids.join(" ")}`)
    ok = false
  } else lines.push("Xorg procs 0")
  if (facts.inputDevices.includes('"omo-qa-')) {
    lines.push("uinput devices LEFT")
    ok = false
  } else lines.push("uinput devices REMOVED")
  const probeSockets = facts.x11Sockets.filter((name) => PROBE_SOCKET.test(name))
  if (probeSockets.length > 0) {
    lines.push(`X sockets LEFT ${probeSockets.join(" ")}`)
    ok = false
  } else lines.push("X sockets REMOVED (displays :90-:99)")
  const probeLocks = facts.xLocks.filter((name) => PROBE_LOCK.test(name))
  if (probeLocks.length > 0) {
    lines.push(`X locks LEFT ${probeLocks.join(" ")}`)
    ok = false
  } else lines.push("X locks REMOVED (displays :90-:99)")
  if (facts.acl === "no-device") lines.push(`uinput ACL REMOVED ${facts.user} (no device)`)
  else if (facts.acl.code !== 0) {
    lines.push(`uinput ACL UNREAD ${facts.user}: getfacl exit ${facts.acl.code}`)
    ok = false
  } else if (facts.acl.out.split("\n").some((line) => line.startsWith(`user:${facts.user}:`))) {
    lines.push(`uinput ACL LEFT ${facts.user}`)
    ok = false
  } else lines.push(`uinput ACL REMOVED ${facts.user}`)
  return { lines, ok }
}

export async function collectTeardownFacts(): Promise<TeardownFacts> {
  const sockets = existsSync("/tmp/.X11-unix") ? readdirSync("/tmp/.X11-unix") : []
  return {
    user: userInfo().username,
    xorg: await run(["pgrep", "-x", "Xorg"]),
    inputDevices: readFileSync("/proc/bus/input/devices", "utf8"),
    x11Sockets: sockets,
    xLocks: readdirSync("/tmp").filter((name) => PROBE_LOCK.test(name)),
    acl: existsSync("/dev/uinput") ? await run(["getfacl", "-p", "/dev/uinput"]) : "no-device",
  }
}
