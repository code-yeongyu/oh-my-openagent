import { readFile } from "node:fs/promises"
import { join } from "node:path"
import { stripVTControlCharacters } from "node:util"
import { z } from "zod"
import { AuditError } from "./contracts"
import type { Runtime } from "./runtime"

function plain(value: string): string {
  return stripVTControlCharacters(value).replace(/\[([^\]]+)\]\([^)]*\)/g, "$1").replace(/[`*_]/g, "").replace(/\s+/g, " ").trim()
}
async function terminalCapture(runtime: Runtime, expected: readonly string[]) {
  let output = ""
  const decoder = new TextDecoder()
  const pending = new Set<{ readonly matches: (value: string) => boolean; readonly resolve: () => void }>()
  const command = [runtime.binary, "--no-session", "--no-skills", "--no-context-files", "--no-extensions", "--extension", join(runtime.root, "fixtures/extension.ts"), "--provider", "audit-local", "--model", "audit-v1"]
  const child = Bun.spawn(command, { cwd: runtime.cwd, env: { ...runtime.env },
    terminal: { cols: 240, rows: 100, data(_terminal, bytes) {
      output += decoder.decode(bytes, { stream: true })
      for (const waiter of pending) if (waiter.matches(output)) { pending.delete(waiter); waiter.resolve() }
    } },
  })
  const waitFor = async (matches: (value: string) => boolean): Promise<void> => {
    if (matches(output)) return
    const completion = Promise.withResolvers<void>()
    const waiter = { matches, resolve: () => completion.resolve() }
    pending.add(waiter)
    const timer = setTimeout(() => completion.reject(new AuditError("changelog", `PTY deadline: ${plain(output).slice(-1800)}`)), 30000)
    try { await completion.promise } finally { clearTimeout(timer); pending.delete(waiter) }
  }
  try {
    await waitFor((value) => value.includes("audit-pty-ready"))
    const startup = output
    const start = output.length
    const matched = new Set<string>()
    const entries = waitFor((value) => {
      const tail = plain(value.slice(Math.max(start, value.length - 32768)))
      for (const entry of expected) if (tail.includes(entry)) matched.add(entry)
      return matched.size === expected.length
    })
    const terminal = child.terminal
    if (!terminal) throw new AuditError("changelog", "Bun did not allocate a PTY")
    terminal.write("/changelog\r")
    await entries
    return { startup, changelog: output.slice(start), command }
  } finally {
    child.kill("SIGTERM")
    const timer = setTimeout(() => child.kill("SIGKILL"), 10000)
    try { await child.exited } finally {
      clearTimeout(timer)
      child.terminal?.close()
      await Bun.write(join(runtime.out, "changelog-pty.ansi.txt"), output)
    }
  }
}
export async function captureChangelog(runtime: Runtime) {
  const shipped = await readFile(join(runtime.payload, "plugin/CHANGELOG.md"), "utf8")
  const entries = [...shipped.matchAll(/^##\s+\[?([\d]+\.[\d]+\.[\d]+[^\]\s]*)\]?[^\n]*\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)]
  const current = entries[0]
  const previous = entries[1]
  if (!current?.[1] || !current[2] || !previous?.[1]) throw new AuditError("changelog", "shipped changelog has fewer than two versions")
  const expected = current[2].split("\n").filter((line) => line.trim() && !line.startsWith("#")).slice(0, 2).map((line) => plain(line.replace(/^- /, "")))
  if (expected.length === 0) throw new AuditError("changelog", "no shipped entries to compare")
  const settingsPath = join(runtime.agent, "settings.json")
  const settings = z.record(z.string(), z.json()).parse(await Bun.file(settingsPath).json())
  await Bun.write(settingsPath, JSON.stringify({ ...settings, changelogSeen: { omo: previous[1] } }))
  const captured = await terminalCapture(runtime, expected)
  const entriesMatchShipped = expected.every((entry) => plain(captured.changelog).includes(entry))
  const whatsNew = expected.every((entry) => plain(captured.startup).includes(entry))
  await Bun.write(join(runtime.out, "changelog.ansi.txt"), captured.changelog)
  await Bun.write(join(runtime.out, "changelog-startup.ansi.txt"), captured.startup)
  return { pass: entriesMatchShipped && whatsNew, entriesMatchShipped, whatsNew, seededPreviousVersion: previous[1], version: current[1], expectedEntries: expected,
    command: captured.command, pty: { api: "Bun.spawn(command, { terminal: { cols, rows, data(terminal, bytes) } })", byteType: "Buffer (Uint8Array)", cols: 240, rows: 100 },
    ...(whatsNew ? {} : { failure: "The audited dev launcher omits brand.changelog.version; the engine suppresses startup changelog without that version." }) }
}
