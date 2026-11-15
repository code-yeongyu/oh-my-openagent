import { afterEach, describe, expect, test } from "bun:test"

import {
  FAKE_DEVICES,
  FAKE_SELF_DEVICE,
  startFakeDeviceService,
  type FakeCommand,
  type FakeDeviceService,
} from "../../../scripts/qa/bunshin-ts-fake-service"
import { DeviceUnavailableError, execOnDevice, localDeviceRunner } from "./device-machine"

const services: FakeDeviceService[] = []
afterEach(async () => {
  for (const service of services.splice(0)) await service.stop()
})

const start = async (options: { commands?: Record<string, FakeCommand>; killFails?: boolean; stateDir?: string } = {}) => {
  const service = await startFakeDeviceService({ devices: [...FAKE_DEVICES, FAKE_SELF_DEVICE], ...options })
  services.push(service)
  return service
}

// Every op the fake received, in order, with the device it was sent to.
const ops = (service: FakeDeviceService, name: string) =>
  service.requests
    .filter((request) => request["type"] === "machine.batch")
    .flatMap((request) =>
      (Array.isArray(request["ops"]) ? (request["ops"] as Array<Record<string, unknown>>) : []).map((op) => ({
        device: request["device"],
        op: op["op"],
      })),
    )
    .filter((entry) => entry.op === name)

const HANG: Record<string, FakeCommand> = { "sleep forever": { chunks: ["started\n"], exitCode: 0, hang: true } }
const live = () => new AbortController().signal

describe("#given this device's service on its local API socket", () => {
  test("#when bash runs a command #then exactly one exec_command goes to this device, output streams, the exit code returns", async () => {
    const service = await start({ commands: { "echo hello": { chunks: ["hel", "lo\n"], exitCode: 3 } } })
    const chunks: string[] = []
    const result = await execOnDevice(
      localDeviceRunner({ OMO_DEVICE_SERVICE_STATE_DIR: service.stateDir }),
      { command: "echo hello", onOutput: (chunk) => chunks.push(chunk.toString()) },
      live(),
    )
    expect(chunks.join("")).toBe("hello\n")
    expect(result.exitCode).toBe(3)
    expect(ops(service, "exec_command")).toEqual([{ device: FAKE_SELF_DEVICE.device, op: "exec_command" }])
  })

  test("#when the service restarts #then the call in between is a typed DeviceUnavailableError and the next call reconnects", async () => {
    const first = await start()
    const stateDir = first.stateDir
    const source = localDeviceRunner({ OMO_DEVICE_SERVICE_STATE_DIR: stateDir })
    expect((await execOnDevice(source, { command: "echo one" }, live())).exitCode).toBe(0)
    await first.stop()
    services.splice(services.indexOf(first), 1)
    const chunks: string[] = []
    const down = await execOnDevice(source, { command: "echo down", onOutput: (c) => chunks.push(c.toString()) }, live()).then(
      () => undefined,
      (error: unknown) => error,
    )
    expect(down).toBeInstanceOf(DeviceUnavailableError)
    expect(chunks).toEqual([])
    const second = await start({ stateDir })
    expect((await execOnDevice(source, { command: "echo two" }, live())).exitCode).toBe(0)
    expect(ops(second, "exec_command")).toHaveLength(1)
  })

  test("#when the signal is already aborted #then nothing is started on the device", async () => {
    const service = await start()
    const controller = new AbortController()
    controller.abort()
    const result = await execOnDevice(localDeviceRunner({ OMO_DEVICE_SERVICE_STATE_DIR: service.stateDir }), { command: "echo x" }, controller.signal)
    expect(result.aborted).toBe(true)
    expect(ops(service, "exec_command")).toHaveLength(0)
  })
})

describe("#given a running device command", () => {
  test("#when the caller aborts #then one kill_terminal reaches the device and the result says aborted", async () => {
    const service = await start({ commands: HANG })
    const controller = new AbortController()
    const result = await execOnDevice(
      localDeviceRunner({ OMO_DEVICE_SERVICE_STATE_DIR: service.stateDir }),
      { command: "sleep forever", onOutput: () => controller.abort() },
      controller.signal,
    )
    expect(result.aborted).toBe(true)
    expect(result.exitCode).toBeNull()
    expect(ops(service, "kill_terminal")).toEqual([{ device: FAKE_SELF_DEVICE.device, op: "kill_terminal" }])
  })

  test("#when its timeout passes #then one kill_terminal reaches the device and the result says timedOut", async () => {
    const service = await start({ commands: HANG })
    const result = await execOnDevice(
      localDeviceRunner({ OMO_DEVICE_SERVICE_STATE_DIR: service.stateDir }),
      { command: "sleep forever", timeoutMs: 50 },
      live(),
    )
    expect(result.timedOut).toBe(true)
    expect(ops(service, "kill_terminal")).toHaveLength(1)
  })

  test("#when the kill is refused #then the run ends with a typed DeviceUnavailableError instead of polling on", async () => {
    const service = await start({ commands: HANG, killFails: true })
    const error = await execOnDevice(
      localDeviceRunner({ OMO_DEVICE_SERVICE_STATE_DIR: service.stateDir }),
      { command: "sleep forever", timeoutMs: 50 },
      live(),
    ).then(
      () => undefined,
      (caught: unknown) => caught,
    )
    expect(error).toBeInstanceOf(DeviceUnavailableError)
    expect(ops(service, "kill_terminal")).toHaveLength(1)
  })

  test("#when the output consumer throws #then the device command is killed once and the consumer's error surfaces", async () => {
    const service = await start({ commands: HANG })
    const error = await execOnDevice(
      localDeviceRunner({ OMO_DEVICE_SERVICE_STATE_DIR: service.stateDir }),
      {
        command: "sleep forever",
        onOutput: () => {
          throw new Error("consumer boom")
        },
      },
      live(),
    ).then(
      () => undefined,
      (caught: unknown) => caught,
    )
    expect((error as Error).message).toBe("consumer boom")
    expect(ops(service, "kill_terminal")).toHaveLength(1)
  })
})
