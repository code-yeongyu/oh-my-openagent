import { afterEach, describe, expect, test } from "bun:test"

import { DISPLAY_UNSAFE, unsafeCodeUnits } from "@oh-my-opencode/utils/testing/display-unsafe"
import { startFakeOwner } from "../../device-service-core/test/local-api/conformance/fake-owner.ts"
import { localRemoteDependencies } from "../remote-local"
import {
  owners,
  privateDir,
  run as runRemote,
  SIGNED_IN,
  testBootstrap,
  useRemoteCliCleanup,
} from "./remote-cli-harness"
import { PEER, personWorld } from "./remote-person-world"

useRemoteCliCleanup()

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
    try {
      // The person client over the conformance owner (#13414 4c-2), written through this device's real stdio writers.
      const owner = await startFakeOwner({ stateDir: privateDir(), world: personWorld() })
      owners.push(owner)
      const local = localRemoteDependencies()
      await runRemote(["interrupt", target, ...(json ? ["--json"] : [])], owner.stateDir, SIGNED_IN, testBootstrap(), {
        output: local.output,
        write: local.write,
        error: local.error,
      })
    } finally {
      process.stdout.write = write
      process.stderr.write = writeErr
    }
    return { out: out.join(""), err: err.join("") }
  }

  test("#given a target holding each fixture #when interrupt runs with --json and without #then every JSON line parses and keeps the value raw, and every human line holds no unsafe unit", async () => {
    for (const fixture of DISPLAY_UNSAFE) {
      const target = `${PEER}/${fixture}`
      const machine = await run(target, true)
      for (const line of machine.out.split("\n").filter((each) => each !== ""))
        expect(() => JSON.parse(line)).not.toThrow()
      const human = await run(target, false)
      expect(human.err).not.toBe("")
      for (const line of `${human.out}${human.err}`.split("\n"))
        expect({ fixture, units: unsafeCodeUnits(line) }).toEqual({ fixture, units: [] })
    }
  })
})
