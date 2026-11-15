import { afterEach, describe, expect, test } from "bun:test"

import { FAKE_DEVICES, FAKE_SELF_DEVICE, startFakeDeviceService, type FakeDeviceService } from "../../../scripts/qa/bunshin-ts-fake-service"
import { DeviceUnavailableError, execOnDevice, localDeviceRunner, type DeviceCommandRunner } from "./device-machine"

let fake: FakeDeviceService | undefined
afterEach(async () => {
  await fake?.stop()
  fake = undefined
})

const execOps = (service: FakeDeviceService) =>
  service.requests
    .filter((request) => request["type"] === "machine.batch")
    .flatMap((request) => (Array.isArray(request["ops"]) ? (request["ops"] as Array<Record<string, unknown>>) : []).map((op) => ({ device: request["device"], op: op["op"] })))
    .filter((entry) => entry.op === "exec_command")

describe("#given this device's service on its local API socket", () => {
  test("#when bash runs a command #then exactly one exec_command goes to this device, output streams, the exit code returns", async () => {
    fake = await startFakeDeviceService({
      devices: [...FAKE_DEVICES, FAKE_SELF_DEVICE],
      commands: { "echo hello": { chunks: ["hel", "lo\n"], exitCode: 3 } },
    })
    const chunks: string[] = []
    const result = await execOnDevice(
      localDeviceRunner({ OMO_DEVICE_SERVICE_STATE_DIR: fake.stateDir }),
      { command: "echo hello", onOutput: (chunk) => chunks.push(chunk.toString()) },
      new AbortController().signal,
    )
    expect(chunks.join("")).toBe("hello\n")
    expect(result.exitCode).toBe(3)
    expect(result.timedOut).toBe(false)
    expect(execOps(fake)).toEqual([{ device: FAKE_SELF_DEVICE.device, op: "exec_command" }])
  })

  test("#when the service is not there #then a typed DeviceUnavailableError and nothing runs", async () => {
    fake = await startFakeDeviceService({ devices: [...FAKE_DEVICES, FAKE_SELF_DEVICE] })
    const stateDir = fake.stateDir
    await fake.stop()
    fake = undefined
    const chunks: string[] = []
    const error = await execOnDevice(
      localDeviceRunner({ OMO_DEVICE_SERVICE_STATE_DIR: stateDir }),
      { command: "echo must-not-run", onOutput: (chunk) => chunks.push(chunk.toString()) },
      new AbortController().signal,
    ).then(
      () => undefined,
      (caught: unknown) => caught,
    )
    expect(error).toBeInstanceOf(DeviceUnavailableError)
    expect((error as DeviceUnavailableError).code).toBe("device_unavailable")
    expect(chunks).toEqual([])
  })
})

// A command that produces nothing until it is killed, then ends its output.
const hangingRunner = () => {
  let kills = 0
  let release: () => void = () => {}
  const ended = new Promise<void>((resolve) => {
    release = resolve
  })
  const runner: DeviceCommandRunner = {
    spawn: async () =>
      ({
        handleId: "h-hang",
        output: async function* () {
          await ended
        },
        wait: async () => ({ exitCode: 0, output: "", durationMs: 0, truncated: false, omittedBytes: 0 }),
        kill: async () => {
          kills += 1
          release()
        },
      }) as unknown as Awaited<ReturnType<DeviceCommandRunner["spawn"]>>,
  }
  return { runner, kills: () => kills }
}

describe("#given a running device command", () => {
  test("#when the caller aborts #then the command is killed once and the result says aborted", async () => {
    const hang = hangingRunner()
    const controller = new AbortController()
    const pending = execOnDevice(async () => hang.runner, { command: "sleep" }, controller.signal)
    await Promise.resolve()
    controller.abort()
    const result = await pending
    expect(hang.kills()).toBe(1)
    expect(result.aborted).toBe(true)
    expect(result.exitCode).toBeNull()
  })

  test("#when its timeout passes #then the command is killed once and the result says timedOut", async () => {
    const hang = hangingRunner()
    const result = await execOnDevice(async () => hang.runner, { command: "sleep", timeoutMs: 1 }, new AbortController().signal)
    expect(hang.kills()).toBe(1)
    expect(result.timedOut).toBe(true)
    expect(result.exitCode).toBeNull()
  })
})
