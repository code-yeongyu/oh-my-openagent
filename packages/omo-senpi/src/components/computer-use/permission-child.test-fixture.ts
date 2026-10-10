import { createInterface } from "node:readline"
import { permissionOwner } from "./permission-child.test-support"
import { capture } from "./permission-event.test-support"

const root = process.argv[2] ?? ""
const depth = process.argv[3] ?? "1"
const send = (value: unknown) => process.stdout.write(`${JSON.stringify(value)}\n`)
const fixture = await permissionOwner({ role: "child", root_session_id: root, depth })
fixture.session.extensionRunner?.onRpcEvent((event) => {
  if (event.name === "computer.permission_required") send({ type: "extension_event", ...event })
})

for await (const line of createInterface({ input: process.stdin })) {
  const command = JSON.parse(line)
  if (command.type === "abort") {
    send({ type: "response", command: command.type, id: command.id, success: true })
    break
  }
  if (command.type === "get_state") {
    send({ type: "response", command: command.type, id: command.id, success: true,
      data: { sessionId: fixture.session.sessionId, isStreaming: false, isCompacting: false } })
    continue
  }
  if (command.type !== "prompt") {
    send({ type: "response", command: command.type, id: command.id, success: true })
    continue
  }
  // The response deliberately follows the denial: the owner must retain startup events.
  if (command.message === "nested") await fixture.child("process")
  else if (command.message === "invalid") {
    send({ type: "extension_event", name: "computer.permission_required",
      data: { type: "computer.permission_required", permission: "camera", app: "Test App" } })
  } else await fixture.execute("computer", capture)
  send({ type: "response", command: command.type, id: command.id, success: true })
  send({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "done" }], stopReason: "stop" } })
  send({ type: "agent_end", messages: [], willRetry: false })
  send({ type: "agent_idle" })
}
await fixture.close()
process.exit(0)
