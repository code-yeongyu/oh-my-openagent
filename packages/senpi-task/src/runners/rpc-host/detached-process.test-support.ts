import { spawn } from "node:child_process"
import { once } from "node:events"
import type { RpcCommand, RpcResponse } from "@code-yeongyu/senpi"
import { configureSharedSubunitLogger } from "@oh-my-opencode/utils"

import { createRpcChildHandle } from "../rpc/handle"
import { RpcProtocolClient } from "../rpc/protocol-client"
import { createHostSessionHandle } from "./handle"
import { FAKE_SESSION, fakeSessionPort } from "./handle.test-support"
import { HostSessionClient, HostSessionDetachedError } from "./session-client"

/**
 * Run outside bun:test so its own exception handlers cannot hide the process-level failure.
 * beforeExit observes the final counters after Bun has drained every rejected promise.
 */
const scenario = process.argv[2]
const observed = Promise.withResolvers<void>()
const logs: Array<{ message: string; data: unknown }> = []
const errors: string[] = []
let uncaughtException = 0
let unhandledRejection = 0
let finished = false
let cleanup: (() => Promise<void>) | undefined

process.on("uncaughtException", (error) => {
  uncaughtException += 1
  errors.push(String(error))
  observed.resolve()
})
process.on("unhandledRejection", (error) => {
  unhandledRejection += 1
  errors.push(String(error))
  observed.resolve()
})
configureSharedSubunitLogger((message, data) => {
  logs.push({ message, data })
  observed.resolve()
})

const deadline = setTimeout(() => observed.reject(new Error(`no failure observation for ${scenario}`)), 5_000)

class DetachedProtocolClient extends RpcProtocolClient {
  detached = false
  override send(command: RpcCommand): Promise<RpcResponse> {
    if (scenario === "site-2-rejection") return Promise.reject(new HostSessionDetachedError(command.type))
    if (this.detached) throw new HostSessionDetachedError(command.type)
    return super.send(command)
  }
  override detach(): void {
    super.detach()
    this.detached = true
  }
}

class RejectingDetachClient extends RpcProtocolClient {
  readonly release = Promise.withResolvers<void>()
  override async detach(): Promise<void> {
    super.detach()
    await this.release.promise
  }
}

function startChild() {
  const child = spawn(process.execPath, ["-e", "process.stdin.resume()"], { stdio: ["pipe", "pipe", "pipe"] })
  const closed = once(child, "close")
  const stop = async (): Promise<void> => {
    child.kill()
    await closed
  }
  cleanup = stop
  return { child, stop }
}

async function drive(): Promise<void> {
  switch (scenario) {
    case "site-1":
    case "site-1-rejection":
    case "site-3":
    case "site-3-close": {
      const detachedClient = new HostSessionClient({ socketPath: "unused-detached-probe" })
      await detachedClient.detach()
      const port = {
        ...fakeSessionPort(),
        getState: () => scenario === "site-1-rejection"
          ? Promise.reject(new HostSessionDetachedError("get_state"))
          : detachedClient.getState(),
        send: detachedClient.send.bind(detachedClient),
        close: () => {
          if (scenario === "site-3-close") throw new HostSessionDetachedError("close_session")
          return detachedClient.close()
        },
      }
      const handle = createHostSessionHandle({
        client: port,
        session: FAKE_SESSION,
        taskId: "detached-probe",
        heartbeatIntervalMs: scenario?.startsWith("site-1") ? 1 : 60_000,
        now: () => 7,
        closeGraceMs: 100,
      })
      cleanup = () => handle.dispose()
      if (scenario === "site-3") void handle.terminate()
      if (scenario === "site-3-close") void handle.close()
      await observed.promise
      if (scenario?.startsWith("site-3") && uncaughtException === 0 && unhandledRejection === 0) {
        await handle.waitForExit()
        finished = handle.hasExited()
      } else {
        finished = true
      }
      break
    }
    case "site-2":
    case "site-2-rejection": {
      const { child, stop } = startChild()
      const client = new DetachedProtocolClient({ child })
      client.detach()
      const handle = createRpcChildHandle({
        client, child, taskId: "detached-probe", heartbeatIntervalMs: 1, now: () => 7,
      })
      cleanup = async () => {
        try {
          await handle.dispose()
        } finally {
          await stop()
        }
      }
      await observed.promise
      finished = true
      break
    }
    case "site-4": {
      const { child } = startChild()
      const client = new RejectingDetachClient({ child })
      const handle = createRpcChildHandle({
        client, child, taskId: "detached-probe", heartbeatIntervalMs: 60_000, now: () => 7,
      })
      const disposed = handle.dispose()
      client.release.reject(new HostSessionDetachedError("detach"))
      await observed.promise
      await disposed
      finished = true
      break
    }
    default:
      throw new Error(`unknown detached probe: ${scenario}`)
  }
}

try {
  await drive()
} catch (error) {
  errors.push(String(error))
  process.exitCode = 1
} finally {
  clearTimeout(deadline)
  await cleanup?.()
  configureSharedSubunitLogger(undefined)
}

process.once("beforeExit", () => {
  console.log(JSON.stringify({ scenario, uncaughtException, unhandledRejection, finished, logs, errors }))
  if (!finished || uncaughtException !== 0 || unhandledRejection !== 0 || logs.length === 0) process.exitCode = 1
})
