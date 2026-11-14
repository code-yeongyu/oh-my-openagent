import { createConnection } from "node:net"

// Stands in for the engine CLI: it hands its argv to the test's control socket, prints the JSON line the test answers
// with, and exits with the code the test names.
const control = process.env.FAKE_ENGINE_CLI_CONTROL
if (control === undefined) process.exit(2)
const socket = createConnection(control)
socket.on("connect", () => socket.write(`${JSON.stringify(process.argv.slice(2))}\n`))
let buffer = ""
socket.on("data", (chunk: Buffer) => {
  buffer += chunk.toString("utf8")
  const newline = buffer.indexOf("\n")
  if (newline < 0) return
  const reply = JSON.parse(buffer.slice(0, newline)) as { readonly line: unknown; readonly exit: number }
  process.stdout.write(`${JSON.stringify(reply.line)}\n`)
  process.exitCode = reply.exit
  socket.end()
})
