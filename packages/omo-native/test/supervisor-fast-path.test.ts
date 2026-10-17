import { afterEach, describe, expect, test } from "bun:test"
import { INTERNAL_SUPERVISOR_ROUTE_FLAG } from "../../../node_modules/@code-yeongyu/senpi/dist/modes/rpc/supervisor-route.js"
import { INTERNAL_SUPERVISOR_FLAG, isInternalSupervisorLaunch, runInternalSupervisor } from "../supervisor-fast-path"

const processTitle = process.title
const processEnv = { PI_CODING_AGENT: process.env.PI_CODING_AGENT, AI_AGENT: process.env.AI_AGENT }
const emitWarning = process.emitWarning

afterEach(() => {
  process.title = processTitle
  for (const [name, value] of Object.entries(processEnv)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
  process.emitWarning = emitWarning
})

describe("supervisor fast path", () => {
  test("routes on the engine's own supervisor sentinel", () => {
    expect(INTERNAL_SUPERVISOR_FLAG).toBe(INTERNAL_SUPERVISOR_ROUTE_FLAG)
  })

  test("selects the argv the compiled entry hands a shard supervisor", () => {
    expect(isInternalSupervisorLaunch(["--extension", "/runtime/plugin", INTERNAL_SUPERVISOR_FLAG, "--socket", "/tmp/p.sock"])).toBe(true)
    expect(isInternalSupervisorLaunch(["--extension", "/runtime/plugin", "--mode", "rpc", "--multi-session"])).toBe(false)
  })

  test("falls through when the engine declines an argv that only mentions the sentinel", async () => {
    // given a prompt whose text equals the sentinel, which the engine's strict shape rejects
    const args = ["--extension", "/runtime/plugin", "-p", INTERNAL_SUPERVISOR_FLAG]

    // when
    const handled = await runInternalSupervisor(args)

    // then the compiled entry continues into the full CLI
    expect(handled).toBe(false)
  })
})
