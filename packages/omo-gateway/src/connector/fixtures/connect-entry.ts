// Subprocess entry for connector tests: runs `runConnectCommand` the way
// packages/omo-native/bin/lib/gateway.js does, with the gateway section and agent dir taken from
// the environment instead of the staged config runtime. It is also its own detached relaunch
// command, so ensure() spawns this same file.

import { runConnectCommand } from "../cli"

const gateway: unknown = JSON.parse(process.env["OMO_GATEWAY_TEST_SECTION"] ?? "null")
const agentDir = process.env["OMO_GATEWAY_TEST_AGENT_DIR"]
if (agentDir === undefined) throw new Error("OMO_GATEWAY_TEST_AGENT_DIR is not set")

process.exitCode = await runConnectCommand(process.argv.slice(2), {
  gateway,
  agentDir,
  env: process.env,
  home: process.env["HOME"] ?? "",
  stdout: process.stdout,
  stderr: process.stderr,
  launch: [process.execPath, import.meta.path],
})
