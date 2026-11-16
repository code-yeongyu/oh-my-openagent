import { spawn } from "node:child_process"

// The one spawn helper of the TUI `/remote` command (design v8-core r2 B5, guard G4b): each action runs ONE
// `omo remote ... --json` process, so the person client never enters the engine bundle.

export type OmoRun = { readonly code: number | null; readonly stdout: string; readonly stderr: string }

export type OmoRunner = (args: readonly string[]) => Promise<OmoRun>

const STREAM_MAX_BYTES = 4 * 1024 * 1024

/**
 * Runs `<omo> <args>`: an npm launcher (`bin/omo.js`) under this runtime, a compiled omo directly, as the device
 * service bootstrap worker does. Rejects only when the binary cannot be started.
 */
export function omoRunner(omoBin: string, execPath: string = process.execPath): OmoRunner {
  return (args) => {
    const [command, ...argv] = omoBin.endsWith(".js") ? [execPath, omoBin, ...args] : [omoBin, ...args]
    return new Promise((resolve, reject) => {
      const child = spawn(command ?? omoBin, argv, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
      const stdout = collect(child.stdout)
      const stderr = collect(child.stderr)
      child.once("error", reject)
      child.once("close", (code) => resolve({ code, stdout: stdout(), stderr: stderr() }))
    })
  }
}

function collect(stream: NodeJS.ReadableStream): () => string {
  const chunks: Buffer[] = []
  let bytes = 0
  stream.on("data", (chunk: Buffer) => {
    if (bytes >= STREAM_MAX_BYTES) return
    bytes += chunk.length
    chunks.push(chunk)
  })
  return () => Buffer.concat(chunks).toString("utf8")
}
