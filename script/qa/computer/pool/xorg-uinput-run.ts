import { closeSync, constants, existsSync, openSync } from "node:fs"
import { userInfo } from "node:os"

import { VirtualKeyboard } from "./uinput-keyboard.ts"
import {
  hasRawKeyPress,
  parseXiServerVersion,
  QUESTIONS,
  type QuestionId,
  type Reading,
  type Verdict,
  xiAtLeast21,
} from "./xorg-uinput-ledger.ts"
import { readLog, revokeUinputGrant, run, startXorg, tail, teardown, until, type Xorg } from "./xorg-session.ts"

const KEY_F13 = 183
const X_KEYCODE_OFFSET = 8
const MAX_SENDS = 10

type RunResult = {
  readonly readings: ReadonlyMap<QuestionId, Reading>
  readonly receipts: readonly string[]
  readonly teardownOk: boolean
}

class Readings {
  readonly map = new Map<QuestionId, Reading>()
  set(id: QuestionId, verdict: Verdict, observed: string): void {
    this.map.set(id, { verdict, observed })
  }
  confirms(id: QuestionId): boolean {
    return this.map.get(id)?.verdict === "CONFIRMS"
  }
  skipFrom(from: QuestionId, why: QuestionId): void {
    const start = QUESTIONS.findIndex((q) => q.id === from)
    for (const q of QUESTIONS.slice(start)) {
      if (!this.map.has(q.id)) this.set(q.id, "UNMEASURED", `precondition absent: ${why}`)
    }
  }
}

async function measureUinput(r: Readings): Promise<boolean> {
  const mod = await run(["sudo", "-n", "modprobe", "uinput"])
  if (existsSync("/dev/uinput")) r.set("uinput-module", "CONFIRMS", `modprobe exit ${mod.code}; /dev/uinput present`)
  else r.set("uinput-module", "CONTRADICTS", `modprobe exit ${mod.code}; /dev/uinput absent ${tail(mod.err)}`)
  if (!r.confirms("uinput-module")) return false
  const user = userInfo().username
  const acl = await run(["sudo", "-n", "setfacl", "-m", `u:${user}:rw`, "/dev/uinput"])
  try {
    closeSync(openSync("/dev/uinput", constants.O_WRONLY | constants.O_NONBLOCK))
    r.set("uinput-writable", "CONFIRMS", `setfacl exit ${acl.code}; open by ${user} ok`)
    return true
  } catch (error) {
    const code = error instanceof Error && "code" in error ? String(error.code) : String(error)
    const denied = code === "EACCES" || code === "EPERM"
    r.set(
      "uinput-writable",
      denied ? "CONTRADICTS" : "UNMEASURED",
      `setfacl exit ${acl.code} ${tail(acl.err, 1)}; open by ${user}: ${code}`,
    )
    return false
  }
}

async function measureXorg(r: Readings, x: Xorg): Promise<void> {
  const env = { DISPLAY: x.dpy }
  const up = await until(15_000, async () => x.exited || (await run(["xdpyinfo"], env)).code === 0, 200)
  const log = readLog(x.log)
  const dummy = /LoadModule: "dummy"/.test(log) && /\(II\) DUMMY/.test(log)
  if (x.exited) {
    const fatal = log
      .split("\n")
      .filter((l) => l.startsWith("(EE)"))
      .slice(-3)
      .join(" | ")
    r.set("xorg-dummy", "CONTRADICTS", `Xorg exited ${x.proc.exitCode}: ${fatal || "no (EE) line in the log"}`)
  } else if (up && dummy) r.set("xorg-dummy", "CONFIRMS", `${x.dpy} answered xdpyinfo; dummy driver loaded`)
  else if (up) r.set("xorg-dummy", "CONTRADICTS", `${x.dpy} answered but the log shows no dummy driver`)
  else r.set("xorg-dummy", "UNMEASURED", `${x.dpy} did not answer within 15 s while Xorg kept running`)
}

async function measureHotplug(r: Readings, x: Xorg, name: string): Promise<void> {
  const env = { DISPLAY: x.dpy }
  let controlListed = false
  const listed = await until(5_000, async () => {
    const l = await run(["xinput", "list", "--name-only"], env)
    const names = l.code === 0 ? l.out.split("\n") : []
    controlListed ||= names.includes("Virtual core XTEST keyboard")
    return names.includes(name)
  })
  const viaLibinput = readLog(x.log).includes(`Using input driver 'libinput' for '${name}'`)
  if (listed && viaLibinput) r.set("libinput-hotplug", "CONFIRMS", `${name} listed by xinput; driver libinput`)
  else if (listed) r.set("libinput-hotplug", "CONTRADICTS", `${name} listed but not through libinput`)
  else if (controlListed)
    r.set("libinput-hotplug", "CONTRADICTS", `${name} not in xinput list after 5 s (control device listed)`)
  else r.set("libinput-hotplug", "UNMEASURED", "xinput list never listed the XTEST control device")
  const ver = await run(["xinput", "--version"], env)
  const v = parseXiServerVersion(ver.out)
  if (!v) r.set("xi-version", "UNMEASURED", `no server version in: ${tail(ver.out + ver.err)}`)
  else r.set("xi-version", xiAtLeast21(v) ? "CONFIRMS" : "CONTRADICTS", `XI ${v.major}.${v.minor}`)
}

async function measureRaw(r: Readings, x: Xorg, kb: VirtualKeyboard, readers: Bun.Subprocess[]): Promise<void> {
  const env = { ...process.env, DISPLAY: x.dpy }
  const idOf = async (device: string) =>
    Number((await run(["xinput", "list", "--id-only", device], { DISPLAY: x.dpy })).out.trim())
  const xiId = await idOf(kb.name)
  const controlId = await idOf("Virtual core XTEST keyboard")
  const reader = Bun.spawn(["xinput", "test-xi2", "--root"], { stdout: "pipe", stderr: "pipe", env })
  readers.push(reader)
  let seen = ""
  const pump = (async () => {
    const decoder = new TextDecoder()
    for await (const chunk of reader.stdout) seen += decoder.decode(chunk)
  })()
  const control = await until(
    4_000,
    async () => {
      if (hasRawKeyPress(seen, controlId, null)) return true
      await run(["xdotool", "key", "F13"], { DISPLAY: x.dpy })
      return false
    },
    300,
  )
  if (!control) {
    r.set(
      "xi-raw-delivery",
      "UNMEASURED",
      `positive control failed: no XTEST RawKeyPress from device ${controlId} reached the reader`,
    )
    reader.kill("SIGTERM")
    await reader.exited
    await pump.catch(() => undefined)
    return
  }
  const keycode = KEY_F13 + X_KEYCODE_OFFSET
  let sends = 0
  const got = await until(
    4_000,
    () => {
      if (hasRawKeyPress(seen, xiId, keycode)) return true
      if (sends < MAX_SENDS) {
        kb.tap(KEY_F13)
        sends += 1
      }
      return false
    },
    300,
  )
  if (got)
    r.set(
      "xi-raw-delivery",
      "CONFIRMS",
      `RawKeyPress detail ${keycode} from XI device ${xiId} after ${sends} send(s); XTEST control seen`,
    )
  else
    r.set(
      "xi-raw-delivery",
      "CONTRADICTS",
      `${sends} sends; no RawKeyPress from device ${xiId} while the XTEST control arrived`,
    )
  reader.kill("SIGTERM")
  await reader.exited
  await pump.catch(() => undefined)
}

export async function measureOnce(workdir: string, runIndex: number): Promise<RunResult> {
  const receipts: string[] = []
  try {
    return await measureGranted(workdir, runIndex, receipts)
  } finally {
    const revoked = await revokeUinputGrant(userInfo().username)
    receipts.push(revoked)
  }
}

async function measureGranted(workdir: string, runIndex: number, receipts: string[]): Promise<RunResult> {
  const r = new Readings()
  if (!(await measureUinput(r))) {
    r.skipFrom("uinput-writable", "uinput-module")
    r.skipFrom("xorg-dummy", "uinput-writable")
    return { readings: r.map, receipts, teardownOk: true }
  }
  const x = startXorg(workdir, runIndex)
  let kb: VirtualKeyboard | null = null
  const readers: Bun.Subprocess[] = []
  try {
    await measureXorg(r, x)
    if (!r.confirms("xorg-dummy")) {
      r.skipFrom("libinput-hotplug", "xorg-dummy")
      return { readings: r.map, receipts, teardownOk: true }
    }
    try {
      kb = VirtualKeyboard.create(`omo-qa-vkbd-${process.pid}-${runIndex}`)
    } catch (error) {
      r.set("libinput-hotplug", "UNMEASURED", `virtual keyboard not created: ${String(error)}`)
      r.skipFrom("xi-version", "libinput-hotplug")
      return { readings: r.map, receipts, teardownOk: true }
    }
    await measureHotplug(r, x, kb.name)
    if (r.confirms("libinput-hotplug")) await measureRaw(r, x, kb, readers)
    else r.skipFrom("xi-raw-delivery", "libinput-hotplug")
    return { readings: r.map, receipts, teardownOk: true }
  } finally {
    const ok = await teardown(x, kb, readers, receipts)
    if (!ok) receipts.push("TEARDOWN incomplete")
  }
}
