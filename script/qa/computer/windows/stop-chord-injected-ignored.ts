// Row 57 failure path: the stop chord (ctrl+alt+shift+escape) injected by another process never
// stops the engine. The driver starts the OS stop path, an independent PowerShell process injects
// the whole chord with keybd_event (LLKHF_INJECTED, no engine tag), and the stop path still reads
// live and not suspended; the RegisterHotKey backstop's WM_HOTKEY for that chord is judged against
// the hook's sighting of an injected chord and ignored. No input is sent by the engine.
import type { Engine } from "./engine.ts"
import { sessionId } from "./host.ts"
import { register, type Outcome } from "./scenario.ts"

type StopPathStatus = {
  readonly suspended: boolean
  readonly globalLive: boolean
  readonly stopPath: string
  readonly reason: string | null
}

const LATCH_WINDOW_MS = 750

// ctrl, alt, shift down, escape down/up, then the modifiers up: the chord as one injector types it.
const INJECT = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class StopChordInjector {
  [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
}
"@
$up = 2
$sent = 0
foreach ($vk in 0x11, 0x12, 0x10, 0x1B) { [StopChordInjector]::keybd_event($vk, 0, 0, [UIntPtr]::Zero); $sent++ }
foreach ($vk in 0x1B, 0x10, 0x12, 0x11) { [StopChordInjector]::keybd_event($vk, 0, $up, [UIntPtr]::Zero); $sent++ }
Write-Output "injected $sent"
`

async function injectChord(): Promise<number> {
  const child = Bun.spawn(["powershell", "-NoProfile", "-Command", INJECT], { stdout: "pipe", stderr: "pipe" })
  const text = await new Response(child.stdout).text()
  await child.exited
  return Number(/injected (\d+)/.exec(text)?.[1] ?? "0")
}

async function status(engine: Engine): Promise<StopPathStatus | { error: unknown }> {
  const reply = await engine.call("stopPath.status")
  return reply.error === undefined ? (reply.result as StopPathStatus) : { error: reply.error }
}

function live(read: StopPathStatus | { error: unknown }): boolean {
  return !("error" in read) && read.globalLive && !read.suspended
}

async function run(engine: Engine): Promise<Outcome> {
  const started = await engine.call("stopPath.start", {})
  if (started.error !== undefined) return { pass: false, facts: { stopPathStart: started.error }, receipts: [] }
  const before = await status(engine)
  const injected = await injectChord()
  await Bun.sleep(LATCH_WINDOW_MS)
  const after = await status(engine)
  const facts = { injected, before, after }
  return { pass: injected === 8 && live(before) && live(after), facts, receipts: [] }
}

async function precondition(): Promise<string | undefined> {
  return (await sessionId()) === 0 ? "session 0 has no input desktop" : undefined
}

register({ name: "stop-chord-injected-ignored", admit: "os", precondition, run })
