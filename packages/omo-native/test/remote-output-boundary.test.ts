import { afterEach, describe, expect, test } from "bun:test"

import { DISPLAY_UNSAFE } from "@oh-my-opencode/utils/testing/display-unsafe"
import { localRemoteDependencies } from "../remote-local"

const write = process.stdout.write.bind(process.stdout)
afterEach(() => {
  process.stdout.write = write
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
      dependencies.write?.(line)
      expect(written).toEqual([`${line}\n`, line])
      expect(JSON.parse(written[0] ?? "")).toEqual(value)
    }
  })
})
