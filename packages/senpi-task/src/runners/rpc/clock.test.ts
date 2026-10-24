import { expect, test } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { createLogger } from "@oh-my-opencode/utils"
import { fakeClock } from "./__fixtures__/clock"
import { silentChild } from "./__fixtures__/silent-child"
import { RpcProtocolClient } from "./protocol-client"

function scheduleLeakedTimeout() {
  return setTimeout(() => {}, 37)
}

function scheduleLeakedInterval() {
  return setInterval(() => {}, 53)
}

test("a pending timer assertion fails with each timer's delay and creation frame", () => {
  const clock = fakeClock()
  try {
    const timeout = scheduleLeakedTimeout()
    const interval = scheduleLeakedInterval()
    expect(clock.pending()).toBe(2)
    expect(() => clock.assertNoPendingTimers()).toThrow(/at .+clock\.test\.ts:\d+:\d+/)
    expect(() => clock.assertNoPendingTimers()).toThrow(/at setTimeout/)
    expect(() => clock.assertNoPendingTimers()).toThrow(/at setInterval/)
    expect(() => clock.assertNoPendingTimers()).toThrow(/delay=37ms/)
    expect(() => clock.assertNoPendingTimers()).toThrow(/delay=53ms/)
    clearTimeout(timeout)
    clearInterval(interval)
    clock.assertNoPendingTimers()
  } finally {
    clock.restore()
  }
})

test("the RPC error logger's buffered flush stays outside the global fake clock", () => {
  const root = mkdtempSync(join(tmpdir(), "rpc-clock-logger-"))
  const logFile = join(root, "rpc.log")
  const logger = createLogger({ logFileName: "rpc.log", resolveLogFilePath: () => logFile })
  const clock = fakeClock()
  const fake = silentChild()
  const client = new RpcProtocolClient({
    child: fake.child,
    onMalformedLine: (line, error) => logger.log("senpi-task rpc malformed line", { line, error: String(error) }),
  })
  try {
    fake.child.stdout?.emit("data", "not-json\n")
    clock.assertNoPendingTimers()
    logger._flushForTesting()
    expect(readFileSync(logFile, "utf8")).toContain("not-json")
    clock.assertNoPendingTimers()
  } finally {
    client.detach()
    logger._resetLoggerForTesting()
    clock.restore()
    rmSync(root, { recursive: true, force: true })
  }
})
