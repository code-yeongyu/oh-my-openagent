// SP-W release question: hold shift through a virtual device, SIGKILL its owner, then read the seat's modifier
// state within 2 s through an independent wev client: a second injector types `a`, and the reader records the
// keysym it got and the depressed mask in force at that key. `a` with no shift = released; `A` or shift = held.
// The read runs twice, each in a fresh session: a CONTROL leg where the holder stays alive (the read must come out
// shifted, or it cannot see a held modifier and the row is UNMEASURED), and the KILL leg. Only that pair decides.
//   gnome, kde: holder = libei keyboard of a portal RemoteDesktop session (ei-probe hold-shift owns the EIS socket);
//               second injector = a second RemoteDesktop session's libei keyboard, armed BEFORE the kill
//               (ei-probe armed-a) and fired by SIGUSR1 300 ms after it, so no dialog sits inside the 2 s window
//   sway:       holder and second injector = zwp_virtual_keyboard_v1 clients (wtype), the virtual_protocols route;
//               the injector's keyboard exists before the kill and types 400 ms after it
import {
  type Answer,
  type Compositor,
  COMMON,
  type WevEvent,
  freshSession,
  run,
  startWev,
  until,
} from "./session-kit.ts"
import { releaseVerdict, shiftedAtRead } from "./verdicts.ts"

const SHIFT = 1
const KILL_TO_READ_MS = 2000

type Proc = ReturnType<typeof Bun.spawn>

// Starts portal.py with an ei-probe mode and resolves once the helper printed `marker`; returns the helper pid.
async function portalHelper(mode: string, marker: string, procs: Proc[]): Promise<{ pid: number; log: string }> {
  procs.push(Bun.spawn(["python3", `${COMMON}/atspi.py`, "approve", "40"], { stdout: "ignore", stderr: "ignore" }))
  const p = Bun.spawn(
    ["python3", `${COMMON}/portal.py`, "remote", "--eis-helper", mode, "--hold-seconds", "60", "--timeout", "30"],
    { stdout: "pipe", stderr: "pipe" },
  )
  procs.push(p)
  const reader = p.stdout.getReader()
  let buf = ""
  let pid = 0
  const deadline = performance.now() + 45_000
  while (performance.now() < deadline && !(pid && buf.includes(marker))) {
    const { value, done } = await reader.read()
    if (done) break
    buf += new TextDecoder().decode(value)
    const m = /"eis_helper_pid": (\d+)/.exec(buf)
    if (m) pid = Number(m[1])
  }
  reader.releaseLock()
  return { pid: buf.includes(marker) ? pid : 0, log: buf.slice(-400) }
}

const fmt = (e: WevEvent, t0: number) =>
  `${e.kind}${e.sym ? `:${e.sym}` : ""}${e.depressed !== undefined ? `:${e.depressed}` : ""}@${Math.round(e.t - t0)}ms`

type Leg = { shifted: boolean | null; trace: string; reason?: string }

async function leg(c: Compositor, killHolder: boolean): Promise<Leg> {
  const name = killHolder ? "kill" : "control"
  await freshSession(c, `release-on-close-${name}`)
  // gnome-shell opens the overview at startup and a window mapped under it gets no focus: leave it first
  // (one Escape through Mutter's own API, before the reader exists and before any measured device)
  const setup = c === "gnome" ? (await run(["python3", `${COMMON}/portal.py`, "mutter-key", "65307"])).out.trim() : ""
  const wev = startWev()
  const procs: Proc[] = []
  const route = c === "sway" ? "zwp_virtual_keyboard_v1 (wtype)" : "portal RemoteDesktop + ConnectToEIS, libei keyboard"
  const fail = (trace: string, reason: string): Leg => ({
    shifted: null,
    trace: `${name}: route=${route}; ${trace}`,
    reason: `${name} leg: ${reason}`,
  })
  try {
    await Bun.sleep(1500) // the wev window maps and takes focus
    let kill: () => void
    // sway: the second injector's virtual keyboard is created just before t0 and types `a` 400 ms after it;
    // a keyboard created after t0 can press and release before the seat focuses the reader
    let fire: () => void = () => undefined
    if (c !== "sway") {
      const inj = await portalHelper("armed-a", '"armed": true', procs)
      if (!inj.pid) return fail(inj.log, "the second injector's libei keyboard never resumed")
      fire = () => process.kill(inj.pid, "SIGUSR1")
    }
    if (c === "sway") {
      const holder = Bun.spawn(["wtype", "-M", "shift", "-s", "60000"], { stdout: "ignore", stderr: "ignore" })
      procs.push(holder)
      kill = () => holder.kill(9)
    } else {
      const h = await portalHelper("hold-shift", '"held": true', procs)
      if (!h.pid) return fail(h.log, "the libei keyboard never pressed shift (no grant or no resumed keyboard)")
      kill = () => process.kill(h.pid, 9)
    }
    const heldSeen = await until(
      () => wev.events.some((e) => e.kind === "mods" && ((e.depressed ?? 0) & SHIFT) !== 0),
      5000,
    )
    if (!heldSeen)
      return fail(`wev events=[${wev.events.map((e) => e.kind).join(",")}]`, "the reader never observed shift held")
    if (c === "sway") {
      procs.push(Bun.spawn(["wtype", "-s", "500", "a"], { stdout: "ignore", stderr: "ignore" }))
      await Bun.sleep(100)
    }
    const t0 = performance.now()
    if (killHolder) kill()
    await Bun.sleep(300)
    fire()
    await until(() => shiftedAtRead(wev.events, t0) !== null, KILL_TO_READ_MS - (performance.now() - t0))
    const shifted = shiftedAtRead(wev.events, t0)
    const after = wev.events.filter((e) => e.t > t0)
    const trace = `${name}: route=${route};${setup ? ` setup=${setup};` : ""} reader=wev; shift seen held; holder ${killHolder ? "SIGKILLed" : "kept alive"} at t0; events after t0: [${after.map((e) => fmt(e, t0)).join(" ")}]; read=${shifted === null ? "none" : shifted ? "shifted" : "unshifted"}`
    if (shifted === null)
      return {
        shifted,
        trace,
        reason: `${name} leg: the second injector's key did not reach the reader within ${KILL_TO_READ_MS} ms of t0`,
      }
    return { shifted, trace }
  } finally {
    wev.proc.kill()
    for (const p of procs) p.kill(9)
  }
}

// the ledger note maps the verdict to the release state: CONFIRMS = proven, CONTRADICTS = contradicted, else unproven
export async function releaseOnClose(c: Compositor): Promise<Answer> {
  const control = await leg(c, false)
  const kill = await leg(c, true)
  const v = releaseVerdict(control.shifted, kill.shifted)
  const reason = [v.reason, control.reason, kill.reason].filter(Boolean).join("; ")
  return { answer: v.answer, observed: `${control.trace} || ${kill.trace}`, ...(v.answer === null ? { reason } : {}) }
}
