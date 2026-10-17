import type { ChildProcess } from "node:child_process"
import { EventEmitter } from "node:events"
import { PassThrough } from "node:stream"

export function silentChild() {
  const commands: Array<{ type: string; id: string }> = []
  const stdin = new PassThrough()
  const stdout = new PassThrough()
  const child = Object.assign(new EventEmitter(), { stdin, stdout, stderr: new PassThrough() }) as unknown as ChildProcess
  stdin.on("data", (bytes: Buffer) => commands.push(JSON.parse(bytes.toString())))
  return {
    child,
    commands,
    emit(value: unknown) { stdout.write(`${JSON.stringify(value)}\n`) },
    respond(command = commands.at(-1)) {
      if (command === undefined) throw new Error("no command")
      stdout.write(`${JSON.stringify({ type: "response", id: command.id, command: command.type, success: true,
        ...(command.type === "get_state" ? { data: { sessionId: "durable-child" } } : {}) })}\n`)
    },
  }
}
