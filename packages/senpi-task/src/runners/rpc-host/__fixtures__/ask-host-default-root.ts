import { askHost } from "../host-request"
import { withContractHost } from "../testing/contract-host"

// Child entry: HOME and the agent-dir env come from the parent, so askHost resolves its key root with no options.
const keyRoot = process.argv[2]
if (keyRoot === undefined) throw new Error("usage: ask-host-default-root <keyRoot>")
await withContractHost({ auth: true, keyRoot }, async (host) => {
  const reply = await askHost(host.socket, { type: "warm", id: "warm-default", cwd: host.root, kind: "worker" }, 2000)
  process.stdout.write(`${JSON.stringify({ success: reply?.success, frames: host.frames.map(({ frame }) => frame.type) })}\n`)
})
