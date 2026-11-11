// SP-W in-session toolkit: runs INSIDE a probe container, under a session started by session.sh.
import { mkdirSync } from "node:fs"

export type Compositor = "gnome" | "kde" | "sway"
export type Answer = { answer: boolean | null; observed: string; reason?: string }

export const COMMON = "/probes/containers/common"

export async function run(cmd: string[], timeoutMs = 60_000): Promise<{ code: number; out: string; err: string }> {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", env: process.env })
  const timer = setTimeout(() => p.kill("SIGKILL"), timeoutMs)
  const [out, err] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()])
  clearTimeout(timer)
  return { code: await p.exited, out, err }
}

export function lastJson(text: string): Record<string, unknown> {
  const lines = text.split("\n").filter((l) => l.trim().startsWith("{"))
  const last = lines.at(-1)
  return last ? JSON.parse(last) : {}
}

// A new session over a new $HOME: no grant, no dconf value and no permission-store row leaks between questions.
export async function freshSession(
  c: Compositor,
  question: string,
  prepare?: (home: string) => Promise<void>,
): Promise<string> {
  const home = `/home/probe/q/${question}`
  mkdirSync(home, { recursive: true })
  process.env.HOME = home
  if (prepare) await prepare(home)
  await restartSession(c)
  return home
}

export async function restartSession(c: Compositor): Promise<void> {
  const r = await run(["bash", `${COMMON}/session.sh`, "restart", c], 90_000)
  if (r.code !== 0) throw new Error(`session restart failed: ${r.err.trim().split("\n").slice(-3).join(" | ")}`)
  process.env.WAYLAND_DISPLAY = (await Bun.file(`${process.env.XDG_RUNTIME_DIR}/spw-display`).text()).trim()
}

// Runs portal.py; with approve, a person-equivalent AT-SPI client accepts the portal dialog (first grant only).
export async function portal(c: Compositor, args: string[], approve: boolean) {
  const approver =
    approve && c !== "sway"
      ? Bun.spawn(["python3", `${COMMON}/atspi.py`, "approve", "40"], { stdout: "pipe", stderr: "pipe" })
      : null
  const r = await run(["python3", `${COMMON}/portal.py`, ...args], 90_000)
  let approverLog = ""
  if (approver) {
    approver.kill("SIGTERM")
    approverLog = await new Response(approver.stdout).text()
  }
  return { rec: lastJson(r.out), raw: r.out, err: r.err, approverLog }
}

export function brief(rec: Record<string, unknown>, keys: string[]): string {
  return keys
    .filter((k) => rec[k] !== undefined)
    .map((k) => `${k}=${JSON.stringify(rec[k])}`)
    .join(" ")
}

export type Rect = { x: number; y: number; w: number; h: number }
const bucket = (n: number) => Math.round(n / 8) * 8
export const rectKey = (r: Rect) => `${bucket(r.x)},${bucket(r.y)},${bucket(r.w)}x${bucket(r.h)}`

// Output rectangles in the compositor's logical space, read independently through xdg-output (wayland-info).
export async function outputRects(): Promise<Rect[]> {
  const r = await run(["wayland-info"], 20_000)
  const rects: Rect[] = []
  const re = /logical_x: (-?\d+), logical_y: (-?\d+)\s+logical_width: (\d+), logical_height: (\d+)/g
  for (const m of r.out.matchAll(re)) rects.push({ x: Number(m[1]), y: Number(m[2]), w: Number(m[3]), h: Number(m[4]) })
  return rects
}

export async function globals(): Promise<string[]> {
  const r = await run(["wayland-info"], 20_000)
  return [...r.out.matchAll(/interface: '([^']+)'/g)].map((m) => m[1] ?? "")
}

// Independent reader: a focused wev window logs the wl_keyboard events it receives (line-buffered through stdbuf).
export type WevEvent = {
  t: number
  kind: "enter" | "leave" | "mods" | "key"
  depressed?: number
  pressed?: boolean
  sym?: string
}
export function startWev() {
  const p = Bun.spawn(["timeout", "-s", "KILL", "120", "stdbuf", "-oL", "wev"], { stdout: "pipe", stderr: "pipe" })
  const events: WevEvent[] = []
  let pendingKey: WevEvent | null = null
  ;(async () => {
    let buf = ""
    const reader = p.stdout.getReader()
    for (let r = await reader.read(); !r.done; r = await reader.read()) {
      const chunk = r.value
      buf += new TextDecoder().decode(chunk)
      let i: number
      while ((i = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, i)
        buf = buf.slice(i + 1)
        const t = performance.now()
        if (/wl_keyboard\] enter:/.test(line)) {
          events.push({ t, kind: "enter" })
          // wev lists the keys already down at enter as sym lines: a key the injector pressed before the
          // seat focused this window arrives here, not as a separate key event
          pendingKey = { t, kind: "key", pressed: true }
        }
        if (/wl_keyboard\] leave:/.test(line)) events.push({ t, kind: "leave" })
        const m = /depressed: ([0-9a-f]{8})/.exec(line)
        if (m) events.push({ t, kind: "mods", depressed: parseInt(m[1] ?? "0", 16) })
        const kk = /wl_keyboard\] key: .*state: \d \((pressed|released)\)/.exec(line)
        if (kk) pendingKey = { t, kind: "key", pressed: kk[1] === "pressed" }
        const s = /^\s+sym: (\S+)/.exec(line)
        if (s && pendingKey) {
          events.push({ ...pendingKey, sym: s[1] ?? "" })
          pendingKey = null
        }
      }
    }
  })()
  return { proc: p, events }
}

export async function until(pred: () => boolean, ms: number): Promise<boolean> {
  const end = performance.now() + ms
  while (performance.now() < end) {
    if (pred()) return true
    await Bun.sleep(25)
  }
  return pred()
}
