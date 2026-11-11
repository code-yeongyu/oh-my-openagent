// SP-W release question: hold shift through a virtual device, SIGKILL its owner, then read the seat's modifier
// state within 2 s through an independent wev client: a second injector types `a`, and the reader records the
// keysym it got and the depressed mask in force at that key. `a` with no shift = released; `A` or shift = held.
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

export async function releaseOnClose(c: Compositor): Promise<Answer> {
  await freshSession(c, "release-on-close")
  // gnome-shell opens the overview at startup and a window mapped under it gets no focus: leave it first
  // (one Escape through Mutter's own API, before the reader exists and before any measured device)
  const setup = c === "gnome" ? (await run(["python3", `${COMMON}/portal.py`, "mutter-key", "65307"])).out.trim() : ""
  const wev = startWev()
  const procs: Proc[] = []
  const route = c === "sway" ? "zwp_virtual_keyboard_v1 (wtype)" : "portal RemoteDesktop + ConnectToEIS, libei keyboard"
  try {
    await Bun.sleep(1500) // the wev window maps and takes focus
    let kill: () => void
    // sway: the second injector's virtual keyboard is created just before the kill and types `a` 400 ms after it;
    // a keyboard created after the kill can press and release before the seat focuses the reader
    let fire: () => void = () => undefined
    if (c !== "sway") {
      const inj = await portalHelper("armed-a", '"armed": true', procs)
      if (!inj.pid)
        return {
          answer: null,
          observed: `route=${route}; ${inj.log}`,
          reason:
            "the second injector's libei keyboard never resumed, so the seat state could not be read after the kill",
        }
      fire = () => process.kill(inj.pid, "SIGUSR1")
    }
    if (c === "sway") {
      const holder = Bun.spawn(["wtype", "-M", "shift", "-s", "60000"], { stdout: "ignore", stderr: "ignore" })
      procs.push(holder)
      kill = () => holder.kill(9)
    } else {
      const h = await portalHelper("hold-shift", '"held": true', procs)
      if (!h.pid)
        return {
          answer: null,
          observed: `route=${route}; ${h.log}`,
          reason:
            "the libei keyboard never pressed shift (no grant or no resumed keyboard), so release could not be measured",
        }
      kill = () => process.kill(h.pid, 9)
    }
    const heldSeen = await until(
      () => wev.events.some((e) => e.kind === "mods" && ((e.depressed ?? 0) & SHIFT) !== 0),
      5000,
    )
    if (!heldSeen)
      return {
        answer: null,
        observed: `route=${route}; wev events=[${wev.events.map((e) => e.kind).join(",")}]`,
        reason:
          "the independent wev reader never observed shift held, so a release could not be told apart from no hold",
      }
    if (c === "sway") {
      procs.push(Bun.spawn(["wtype", "-s", "500", "a"], { stdout: "ignore", stderr: "ignore" }))
      await Bun.sleep(100)
    }
    const t0 = performance.now()
    kill()
    await Bun.sleep(300)
    fire()
    const keyed = await until(
      () => wev.events.some((e) => e.t > t0 && e.kind === "key" && e.pressed && (e.sym === "a" || e.sym === "A")),
      KILL_TO_READ_MS - (performance.now() - t0),
    )
    const after = wev.events.filter((e) => e.t > t0)
    const trace = `route=${route};${setup ? ` setup=${setup};` : ""} reader=wev (independent client); shift seen held; holder SIGKILLed; events after kill: [${after.map((e) => fmt(e, t0)).join(" ")}]`
    if (!keyed)
      return {
        answer: null,
        observed: trace,
        reason: `the second injector's key did not reach the reader within ${KILL_TO_READ_MS} ms of the kill`,
      }
    const key = after.find((e) => e.kind === "key" && e.pressed && (e.sym === "a" || e.sym === "A"))
    const modsAtKey = [...wev.events].reverse().find((e) => e.kind === "mods" && key && e.t <= key.t)
    const shiftAtKey = ((modsAtKey?.depressed ?? 0) & SHIFT) !== 0 || key?.sym === "A"
    return {
      answer: !shiftAtKey,
      observed: `${trace}; second-injector key sym=${key?.sym} depressed=${modsAtKey?.depressed ?? "none"}`,
    }
  } finally {
    wev.proc.kill()
    for (const p of procs) p.kill(9)
  }
}
