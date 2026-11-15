import { existsSync, readdirSync, readFileSync } from "node:fs"
import { userInfo } from "node:os"

import { run } from "./xorg-session.ts"

export type TeardownFacts = {
  readonly user: string
  readonly xorgPids: readonly string[]
  readonly inputDevices: string
  readonly x11Sockets: readonly string[]
  readonly acl: { readonly code: number; readonly out: string } | "no-device"
}

const PROBE_SOCKET = /^X9\d$/

export function judgeTeardown(facts: TeardownFacts): { readonly lines: readonly string[]; readonly ok: boolean } {
  const lines: string[] = []
  let ok = true
  if (facts.xorgPids.length > 0) {
    lines.push(`Xorg LEFT ${facts.xorgPids.join(" ")}`)
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
  const pgrep = await run(["pgrep", "-x", "Xorg"])
  const sockets = existsSync("/tmp/.X11-unix") ? readdirSync("/tmp/.X11-unix") : []
  return {
    user: userInfo().username,
    xorgPids: pgrep.out.split("\n").filter((pid) => pid.trim() !== ""),
    inputDevices: readFileSync("/proc/bus/input/devices", "utf8"),
    x11Sockets: sockets,
    acl: existsSync("/dev/uinput") ? await run(["getfacl", "-p", "/dev/uinput"]) : "no-device",
  }
}
