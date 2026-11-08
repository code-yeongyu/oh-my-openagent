// Run by Bun from a fixture git hook (`"$OMO_TEST_BUN" "$OMO_TEST_PARK" <role>`): it connects to the test's park
// server, announces `<role> <pid> <ppid>`, then blocks until the server sends `release` or closes the connection.
// The connection is the readiness signal, so the test subscribes before the git command starts.
import { connect } from "node:net"

const role = process.argv[2] ?? "park"
const port = Number(process.env.OMO_TEST_PARK_PORT)
const socket = connect(port, "127.0.0.1", () => {
  socket.write(`${role} ${process.pid} ${process.ppid}\n`)
})
socket.on("data", (chunk: Buffer) => {
  if (chunk.toString("utf8").includes("release")) process.exit(0)
})
socket.on("close", () => process.exit(0))
socket.on("error", () => process.exit(1))
