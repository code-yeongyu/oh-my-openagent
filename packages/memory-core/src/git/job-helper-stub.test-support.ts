// Compiled with `bun build --compile` into a stand-in for omo-git-job-helper.exe and injected through
// `jobHelper.path` (design v4.2 section 3, rows T7 and T14). `selftest` always passes, so the writer treats the host
// as claimed; `run --op <id>` then misbehaves the way OMO_TEST_STUB_MODE names:
//   exit         - exits at once, before connecting (T7(a))
//   silent       - never connects (T7(b))
//   joined-exit  - sends a well-formed `joined` and exits (T7(d))
//   assign-fails - reports `error assign 5` and exits 18, as the real helper does when AssignProcessToJobObject fails (T14)
import { connect } from "node:net"

const args = process.argv.slice(2)
if (args[0] === "selftest") {
  process.stdout.write("selftest ok elevated=0 integrity=0x2000\n")
  process.exit(0)
}
const op = args[0] === "run" && args[1] === "--op" ? args[2] : undefined
if (op === undefined) process.exit(2)

const mode = process.env.OMO_TEST_STUB_MODE
if (mode === "exit") process.exit(3)
if (mode === "silent") {
  setInterval(() => {}, 1 << 30)
} else {
  const socket = connect(`\\\\.\\pipe\\omo-git-op-${op}`, () => {
    const joined = mode === "joined-exit"
    socket.end(joined ? `joined ${process.pid} 0\n` : "error assign 5\n", () => process.exit(joined ? 0 : 18))
  })
  socket.on("error", () => process.exit(11))
}
