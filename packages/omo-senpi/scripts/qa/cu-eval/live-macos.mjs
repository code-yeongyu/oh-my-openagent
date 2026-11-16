// macOS-only helpers of the live surface: scratch files, app launch, and the teardown ops that leave the shared
// Mac as found. Launch and teardown go through `open` and AppleScript (`saving no`), outside the engine, so a
// restore never depends on the behavior under test; every task step and every oracle read goes through the SDK.
import { spawnSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", timeout: 30_000 })
  if (result.status !== 0)
    throw new Error(`${command} ${args.join(" ")} exited ${result.status}: ${(result.stderr ?? "").trim()}`)
  return result.stdout
}

function osascript(script) {
  return run("osascript", ["-e", script])
}

const quoted = (text) => `"${String(text).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`

/** Apps that were already running before a task launched them: `quit` leaves those running. */
const runningBefore = new Set()

function isRunning(app) {
  return spawnSync("pgrep", ["-x", app], { encoding: "utf8" }).status === 0
}

/** Writes the task's scratch files under `dir/files` and runs its setup commands with `{dir}` filled in. */
export function prepare(surface, dir) {
  for (const step of surface.restore ?? []) if (step.op === "quit" && isRunning(step.app)) runningBefore.add(step.app)
  const filesDir = join(dir, "files")
  mkdirSync(filesDir, { recursive: true })
  for (const [name, content] of Object.entries(surface.files ?? {})) writeFileSync(join(filesDir, name), content)
  for (const [command, ...args] of surface.setup ?? [])
    run(
      command,
      args.map((arg) => arg.replaceAll("{dir}", filesDir)),
    )
}

/** Each scratch file's content now, `null` when it is gone: the "never saved" oracle. */
export function files(surface, dir) {
  return Object.fromEntries(
    Object.keys(surface.files ?? {}).map((name) => {
      const path = join(dir, "files", name)
      return [name, existsSync(path) ? readFileSync(path, "utf8") : null]
    }),
  )
}

/** Closes one window by title through its app's own scripting, discarding edits; never the user's other windows. */
function closeTitled(app, title) {
  if (app === "TextEdit")
    osascript(`tell application "TextEdit" to close (every document whose name is ${quoted(title)}) saving no`)
  else if (app === "Safari")
    osascript(`tell application "Safari" to close (every tab of every window whose name contains ${quoted(title)})`)
  else if (app === "Finder")
    osascript(`tell application "Finder" to close (every window whose name is ${quoted(title)})`)
  else throw new Error(`no close recipe for ${app}`)
}

/** Teardown ops a live plan may name after its oracle reads. */
export const ops = {
  async quit(_computer, _win, step) {
    if (!runningBefore.has(step.app)) osascript(`quit app ${quoted(step.app)}`)
    return []
  },
  async closeWindow(computer, win, step) {
    const target = step.window === undefined ? win : await computer.window(step.window)
    // The title may have moved (Finder navigated): close what the window is called now.
    const [now] = await computer.windows({ id: target.id })
    if (now !== undefined) closeTitled(now.app, now.title)
    return []
  },
}

/** Ops that run after the post-check readback: they close what the readback still needs. */
export const TEARDOWN_OPS = new Set(["quit", "closeWindow"])

/** Waits (READ polling, no fixed sleep) until the task's window exists. */
export async function waitForWindow(computer, filter, timeoutMs = 20_000) {
  const verdict = await computer.verify({ kind: "windowExists", window: filter }, { timeoutMs, intervalMs: 200 })
  if (verdict.status !== "satisfied")
    throw new Error(`window ${JSON.stringify(filter)} did not appear within ${timeoutMs} ms (${verdict.status})`)
}

let benchDocument

/** The bench's own TextEdit document. */
export function openBenchDocument(dir) {
  benchDocument = join(dir, "cu-bench.txt")
  writeFileSync(benchDocument, "")
  run("open", ["-a", "TextEdit", benchDocument])
}

export function closeBenchDocument() {
  if (benchDocument !== undefined) closeTitled("TextEdit", "cu-bench.txt")
  benchDocument = undefined
}
