import { describe, expect, it } from "bun:test"

import { runProcessWithTreeTimeout } from "./process-tree"

describe("runProcessWithTreeTimeout output decoding", () => {
  it("#given a UTF-8 character split across child writes #when output is collected #then the character is preserved", async () => {
    // given
    const script = [
      'const { writeSync } = require("node:fs")',
      "writeSync(1, Buffer.from([0xe2]))",
      "setImmediate(() => writeSync(1, Buffer.from([0x82, 0xac])))",
    ].join(";")

    // when
    const result = await runProcessWithTreeTimeout({
      args: ["--eval", script],
      command: process.execPath,
      cwd: process.cwd(),
      env: { PATH: process.env["PATH"] ?? "" },
      maxBuffer: 1024,
      timeoutMs: 5_000,
    })

    // then
    expect(result.exitCode).toBe(0)
    expect(result.stdout).toBe("€")
  })

  it("#given multibyte output exceeds the byte limit #when output is collected #then the process fails without partial text", async () => {
    // given
    const script = 'process.stdout.write("€")'

    // when
    const result = await runProcessWithTreeTimeout({
      args: ["--eval", script],
      command: process.execPath,
      cwd: process.cwd(),
      env: { PATH: process.env["PATH"] ?? "" },
      maxBuffer: 2,
      timeoutMs: 5_000,
    })

    // then
    expect(result.exitCode).toBe(1)
    expect(result.stdout).toBe("")
  })
})
