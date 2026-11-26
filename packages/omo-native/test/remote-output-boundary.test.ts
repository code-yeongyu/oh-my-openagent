import { afterEach, describe, expect, test } from "bun:test"

import { DISPLAY_UNSAFE } from "@oh-my-opencode/utils/testing/display-unsafe"
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { deviceServiceEndpointPath, type DeviceService } from "../../device-service-core/src/index.ts"
import { unsafeCodeUnits } from "@oh-my-opencode/utils/testing/display-unsafe"
import { createRemoteThreadFixture } from "../../omo-senpi/src/components/thread/thread-remote-fixture"
import type { RemoteCommandDependencies } from "../remote-cli"
import { localRemoteDependencies } from "../remote-local"
import { parseSession } from "../remote-session-args"
import { runSession } from "../remote-session-verbs"
import { useIsolatedAgentDir } from "./remote-cli-harness"

useIsolatedAgentDir()

const write = process.stdout.write.bind(process.stdout)
const writeErr = process.stderr.write.bind(process.stderr)
afterEach(() => {
  process.stdout.write = write
  process.stderr.write = writeErr
})

describe("the remote command's machine-readable output", () => {
  test("#given a JSON line holding each fixture #when written through the local output writer #then its bytes are unchanged and it parses to the same value", () => {
    const written: string[] = []
    process.stdout.write = ((chunk: string) => {
      written.push(chunk)
      return true
    }) as typeof process.stdout.write
    const dependencies = localRemoteDependencies()
    for (const fixture of DISPLAY_UNSAFE) {
      const value = { name: fixture, rows: [{ title: fixture }] }
      const line = JSON.stringify(value)
      written.length = 0
      dependencies.output(line)
      expect(written).toEqual([`${line}\n`])
      expect(JSON.parse(written[0] ?? "")).toEqual(value)
    }
  })
})

describe("one session verb end to end through the local writers", () => {
  const remoteFixture = createRemoteThreadFixture()

  async function run(target: string, json: boolean) {
    const out: string[] = []
    const err: string[] = []
    process.stdout.write = ((chunk: string) => {
      out.push(chunk)
      return true
    }) as typeof process.stdout.write
    process.stderr.write = ((chunk: string) => {
      err.push(chunk)
      return true
    }) as typeof process.stderr.write
    const account = remoteFixture.account()
    const stateDir = mkdtempSync(join(tmpdir(), "omo-remote-boundary-"))
    mkdirSync(dirname(deviceServiceEndpointPath(stateDir)), { recursive: true })
    writeFileSync(deviceServiceEndpointPath(stateDir), "")
    const local = localRemoteDependencies()
    const dependencies = { ...local, stateDir, remote: () => account.remote } as unknown as RemoteCommandDependencies
    try {
      await runSession({} as DeviceService, parseSession("interrupt", [target]).session, json, dependencies)
    } finally {
      process.stdout.write = write
      process.stderr.write = writeErr
      rmSync(stateDir, { recursive: true, force: true })
      await remoteFixture.cleanup()
    }
    return { out: out.join(""), err: err.join("") }
  }

  test("#given a target holding each fixture #when interrupt runs with --json and without #then every JSON line parses and keeps the value raw, and every human line holds no unsafe unit", async () => {
    for (const fixture of DISPLAY_UNSAFE) {
      const target = `b/${fixture}`
      const machine = await run(target, true)
      for (const line of machine.out.split("\n").filter((each) => each !== ""))
        expect(() => JSON.parse(line)).not.toThrow()
      const human = await run(target, false)
      for (const line of `${human.out}${human.err}`.split("\n"))
        expect({ fixture, units: unsafeCodeUnits(line) }).toEqual({ fixture, units: [] })
    }
  })
})
