import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import type { VirtualKeyboard } from "./uinput-keyboard.ts"
import { XORG_CONF } from "./xorg-dummy-conf.ts"

export async function run(cmd: readonly string[], env: Readonly<Record<string, string>> = {}) {
  const p = Bun.spawn([...cmd], { stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env } })
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
  return { code, out, err }
}

export async function until(
  deadlineMs: number,
  check: () => Promise<boolean> | boolean,
  stepMs = 100,
): Promise<boolean> {
  const end = performance.now() + deadlineMs
  for (;;) {
    if (await check()) return true
    if (performance.now() >= end) return false
    await Bun.sleep(stepMs)
  }
}

function freeDisplay(): number {
  for (let n = 90; n < 100; n++) {
    if (!existsSync(`/tmp/.X11-unix/X${n}`) && !existsSync(`/tmp/.X${n}-lock`)) return n
  }
  throw new Error("no free display between :90 and :99")
}

export const tail = (s: string, n = 3) => s.trim().split("\n").slice(-n).join(" | ")

export type Xorg = {
  readonly proc: Bun.Subprocess
  readonly dpy: string
  readonly display: number
  readonly log: string
  exited: boolean
}

export function startXorg(workdir: string, runIndex: number): Xorg {
  const display = freeDisplay()
  const dpy = `:${display}`
  const conf = join(workdir, `xorg-${runIndex}.conf`)
  const confDir = join(workdir, `xorg-${runIndex}.d`)
  const log = join(workdir, `xorg-${runIndex}.log`)
  writeFileSync(conf, XORG_CONF)
  mkdirSync(confDir, { recursive: true })
  const argv = [
    "sudo",
    "-n",
    "Xorg",
    dpy,
    "-config",
    conf,
    "-configdir",
    confDir,
    "-noreset",
    "-nolisten",
    "tcp",
    "-logfile",
    log,
  ]
  const proc = Bun.spawn(argv, { stdout: "ignore", stderr: "pipe" })
  const xorg: Xorg = { proc, dpy, display, log, exited: false }
  void proc.exited.then(() => {
    xorg.exited = true
  })
  return xorg
}

export const readLog = (path: string) => (existsSync(path) ? readFileSync(path, "utf8") : "")

export async function teardown(
  x: Xorg,
  kb: VirtualKeyboard | null,
  readers: readonly Bun.Subprocess[],
  receipts: string[],
) {
  let ok = true
  for (const p of readers) {
    if (p.exitCode === null && p.signalCode === null) p.kill("SIGKILL")
    await p.exited
  }
  if (kb) {
    try {
      kb.destroy()
    } catch (error) {
      receipts.push(`uinput device DESTROY-FAILED ${kb.name}: ${String(error)}`)
      ok = false
    }
    const gone = await until(2_000, () => !readFileSync("/proc/bus/input/devices", "utf8").includes(`"${kb.name}"`))
    receipts.push(gone ? `uinput device REMOVED ${kb.name}` : `uinput device LEFT ${kb.name}`)
    ok &&= gone
  }
  if (!x.exited) {
    x.proc.kill("SIGTERM")
    if (!(await until(10_000, () => x.exited))) {
      await run(["sudo", "-n", "pkill", "-KILL", "-x", "Xorg"])
      await until(5_000, () => x.exited)
    }
  }
  const socketGone = await until(
    2_000,
    () => !existsSync(`/tmp/.X11-unix/X${x.display}`) && !existsSync(`/tmp/.X${x.display}-lock`),
  )
  receipts.push(socketGone ? `X socket REMOVED ${x.dpy}` : `X socket LEFT ${x.dpy}`)
  const left = [x.proc, ...readers].filter((p) => p.exitCode === null && p.signalCode === null).length
  receipts.push(`procs ${left}`)
  return ok && socketGone && left === 0
}

export async function revokeUinputGrant(user: string): Promise<string> {
  if (!existsSync("/dev/uinput")) return `uinput ACL REMOVED ${user} (no device)`
  await run(["sudo", "-n", "setfacl", "-x", `u:${user}`, "/dev/uinput"])
  const acl = await run(["getfacl", "-p", "/dev/uinput"])
  if (acl.code !== 0) return `uinput ACL UNREAD ${user}: ${tail(acl.err, 1)}`
  return acl.out.split("\n").some((line) => line.startsWith(`user:${user}:`))
    ? `uinput ACL LEFT ${user}`
    : `uinput ACL REMOVED ${user}`
}
