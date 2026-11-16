// Starts the four-colour marker window and reads the facts its own process reports.
import { resolve } from "node:path"

import { spawn } from "bun"

type Marker = {
  readonly title: string
  readonly hwnd: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
  readonly dpi: number
  readonly colours: readonly (readonly [number, number, number])[]
  readonly close: () => Promise<string>
}

export async function openMarker(): Promise<Marker> {
  const child = spawn(
    ["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-File", resolve(import.meta.dir, "marker-window.ps1")],
    { stdin: "pipe", stdout: "pipe", stderr: "inherit" },
  )
  const reader = child.stdout.getReader()
  let text = ""
  while (!text.includes("\n")) {
    const { done, value } = await reader.read()
    if (done) throw new Error("the marker window exited before it was shown")
    text += new TextDecoder().decode(value)
  }
  reader.releaseLock()
  const facts: Omit<Marker, "close"> = JSON.parse(text.slice(0, text.indexOf("\n")))
  const close = async (): Promise<string> => {
    child.stdin.write("close\n")
    child.stdin.end()
    await child.exited
    return `window CLOSED ${facts.title} exit=${child.exitCode}`
  }
  return { ...facts, close }
}
